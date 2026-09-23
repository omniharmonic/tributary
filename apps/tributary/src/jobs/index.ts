/**
 * pg-boss wiring (architecture §7).
 *
 *   sync-source     one job per source, singleton per source id (a source never runs
 *                   concurrently with itself); the scheduler tick enqueues due sources
 *   scheduler-tick  every minute: find sources whose next_run_at has passed
 *   host-notices    hourly: email hosts whose source has been failing for > 24 h
 *   retention       daily: expired previews, tokens, confirmations, sessions, sync runs
 *   monthly-digest  1st of the month: "here is what we published for you"
 */
import { PgBoss } from 'pg-boss'
import { and, eq, gt, isNull, lt, lte, sql } from 'drizzle-orm'
import { config } from '../config.js'
import { getDb } from '../db/index.js'
import { emailToken, host, pendingConfirmation, preview, session, source, sourceEvent, syncRun } from '../db/schema.js'
import { describeError, log } from '../lib/logging.js'
import { sendMail } from '../lib/mail.js'
import { purgeOauthState } from '../lib/oauth.js'
import { runSource } from '../pipeline/run.js'
import { leakCheck, privacyAudit, relayMonitor } from './checks.js'
import { reindexAll } from '../search/index.js'

export const QUEUES = { sync: 'sync-source', tick: 'scheduler-tick', notices: 'host-notices', retention: 'retention', digest: 'monthly-digest', checks: 'nightly-checks', relay: 'relay-monitor', reindex: 'search-reindex' } as const

let boss: PgBoss | undefined

export async function startJobs(): Promise<PgBoss> {
  const c = config()
  boss = new PgBoss({ connectionString: c.DATABASE_URL, schema: 'pgboss' })
  boss.on('error', (err: unknown) => log.error('pg-boss error', { detail: describeError(err) }))
  await boss.start()
  await boss.createQueue(QUEUES.sync, { policy: 'stately', retryLimit: 2, retryDelay: 60, expireInSeconds: 30 * 60 })
  for (const q of [QUEUES.tick, QUEUES.notices, QUEUES.retention, QUEUES.digest, QUEUES.checks, QUEUES.relay, QUEUES.reindex]) await boss.createQueue(q, { policy: 'singleton' })

  await boss.work<{ sourceId: string; trigger?: 'schedule' | 'manual' | 'push' | 'first' }>(QUEUES.sync, { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) {
      await runSource(job.data.sourceId, { trigger: job.data.trigger ?? 'schedule' })
    }
  })
  await boss.work(QUEUES.tick, async () => {
    const due = await getDb()
      .select({ id: source.id })
      .from(source)
      .where(and(lte(source.nextRunAt, new Date()), eq(source.status, 'active')))
      .limit(200)
    const failing = await getDb()
      .select({ id: source.id })
      .from(source)
      .where(and(lte(source.nextRunAt, new Date()), eq(source.status, 'failing')))
      .limit(50)
    for (const s of [...due, ...failing]) await enqueueSync(s.id, 'schedule')
  })
  await boss.work(QUEUES.notices, async () => {
    await sendOutageNotices()
  })
  await boss.work(QUEUES.retention, async () => {
    await runRetention()
  })
  await boss.work(QUEUES.digest, async () => {
    await sendMonthlyDigests()
  })
  await boss.work(QUEUES.checks, async () => {
    await privacyAudit()
    await leakCheck()
  })
  await boss.work(QUEUES.relay, async () => {
    await relayMonitor()
  })
  await boss.work(QUEUES.reindex, async () => {
    const r = await reindexAll()
    if (r.indexed + r.removed > 0) log.info('search reindexed', { ...r })
  })

  await boss.schedule(QUEUES.tick, '* * * * *')
  await boss.schedule(QUEUES.notices, '17 * * * *')
  await boss.schedule(QUEUES.retention, '30 3 * * *')
  await boss.schedule(QUEUES.digest, '0 15 1 * *')
  await boss.schedule(QUEUES.checks, '45 4 * * *')
  await boss.schedule(QUEUES.relay, '5 6 * * *')
  await boss.schedule(QUEUES.reindex, '20 5 * * *')
  log.info('jobs started')
  return boss
}

export async function enqueueSync(sourceId: string, trigger: 'schedule' | 'manual' | 'push' | 'first' = 'manual'): Promise<string | null> {
  if (!boss) {
    // Jobs disabled (tests, smoke): run inline.
    await runSource(sourceId, { trigger })
    return null
  }
  return boss.send(QUEUES.sync, { sourceId, trigger }, { singletonKey: sourceId })
}

export async function stopJobs(): Promise<void> {
  await boss?.stop({ graceful: true, timeout: 30_000 }).catch(() => {})
  boss = undefined
}

/** F22: email when a source breaks for more than 24 h, once per outage, in plain language. */
export async function sendOutageNotices(): Promise<number> {
  const c = config()
  const db = getDb()
  const cutoff = new Date(Date.now() - 24 * 3_600_000)
  const rows = await db
    .select({ s: source, h: host })
    .from(source)
    .innerJoin(host, eq(host.id, source.hostId))
    .where(and(eq(source.status, 'failing'), isNull(source.outageNotifiedAt), lt(source.lastSuccessAt, cutoff)))
  let sent = 0
  for (const { s, h } of rows) {
    if (!h.email) continue
    const msg = s.lastError?.message ?? 'We could not read it.'
    await sendMail({
      to: h.email,
      subject: `${c.BRAND_NAME}: we cannot read "${s.label}"`,
      text: `Hello ${h.displayName},\n\nFor the last day we have not been able to read ${s.label}.\n\n${msg}\n\nYour events that were already published stay up. Fix it at the source, or check the source in your dashboard:\n${c.WEB_PUBLIC_URL}/dashboard/sources/${s.id}\n\nIf you would rather we stop trying, remove the source there.\n`,
    })
    await db.update(source).set({ outageNotifiedAt: new Date() }).where(eq(source.id, s.id))
    sent++
  }
  return sent
}

export async function runRetention(): Promise<void> {
  const db = getDb()
  const now = new Date()
  await db.delete(preview).where(lt(preview.expiresAt, now))
  await db.delete(emailToken).where(lt(emailToken.expiresAt, now))
  await db.delete(session).where(lt(session.expiresAt, now))
  await db.update(pendingConfirmation).set({ resolvedAt: now, resolution: 'expired' }).where(and(lt(pendingConfirmation.expiresAt, now), isNull(pendingConfirmation.resolvedAt)))
  await db.delete(syncRun).where(lt(syncRun.startedAt, new Date(now.getTime() - 30 * 86_400_000)))
  // Removed ledger rows older than 90 days are gone for good; the repo no longer has them either.
  await db.delete(sourceEvent).where(and(eq(sourceEvent.state, 'removed'), lt(sourceEvent.lastSeen, new Date(now.getTime() - 90 * 86_400_000))))
  await purgeOauthState().catch(() => {})
}

export async function sendMonthlyDigests(): Promise<number> {
  const c = config()
  const db = getDb()
  const since = new Date(Date.now() - 31 * 86_400_000)
  const hosts = await db.select().from(host)
  let sent = 0
  for (const h of hosts) {
    if (!h.email || h.pausedReason) continue
    const [counts] = await db
      .select({ published: sql<number>`count(*) filter (where ${sourceEvent.firstSeen} > ${since})`, live: sql<number>`count(*) filter (where ${sourceEvent.state} = 'live' and ${sourceEvent.startsAt} > now())` })
      .from(sourceEvent)
      .where(and(eq(sourceEvent.hostId, h.id), gt(sourceEvent.lastSeen, since)))
    const published = Number(counts?.published ?? 0)
    const live = Number(counts?.live ?? 0)
    if (published === 0 && live === 0) continue
    await sendMail({
      to: h.email,
      subject: `${c.BRAND_NAME}: your month`,
      text: `Hello ${h.displayName},\n\nThis month we published ${published} new event${published === 1 ? '' : 's'} for @${h.handle}. ${live} upcoming event${live === 1 ? ' is' : 's are'} live right now.\n\nSee them: ${c.WEB_PUBLIC_URL}/h/${h.handle}\nManage sources: ${c.WEB_PUBLIC_URL}/dashboard\n\nYou can take full control of this account, move it to another server, or delete everything from ${c.WEB_PUBLIC_URL}/settings at any time.\n`,
    })
    sent++
  }
  return sent
}
