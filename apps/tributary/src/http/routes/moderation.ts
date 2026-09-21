/**
 * Moderation (F19, architecture §8.5): a report link on every card, a steward queue,
 * and takedown. De-indexing hides the event from every public surface at once; for a
 * custodial host the record itself is withdrawn on the next reconcile (hidden override).
 * Records in other people's repos can only be de-indexed here.
 */
import { Hono } from 'hono'
import { createHash } from 'node:crypto'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { pdsAdmin } from '@tributary/identity'
import { config } from '../../config.js'
import { getDb } from '../../db/index.js'
import { host, report, sourceEvent } from '../../db/schema.js'
import { recordAudit } from '../../lib/audit.js'
import { pdsConfig } from '../../lib/custody.js'
import { id } from '../../lib/ids.js'
import { enqueueSync } from '../../jobs/index.js'
import { describeError, log } from '../../lib/logging.js'
import { ApiError, body, clientIp, notFound, rateLimit, str, type AppContext, type Vars } from '../context.js'

export const reportRoutes = new Hono<{ Variables: Vars }>()
export const stewardRoutes = new Hono<{ Variables: Vars }>()

const REASONS = new Set(['spam', 'not-an-event', 'wrong-details', 'private-information', 'harassment', 'copyright', 'other'])

reportRoutes.post('/', async (c) => {
  const ip = clientIp(c)
  rateLimit(`report:${ip}`, 10, 3_600_000)
  const b = await body(c)
  const atUri = str(b.atUri, 'atUri', { max: 300 })
  const reason = str(b.reason, 'reason', { max: 40 })
  if (!REASONS.has(reason)) throw new ApiError(400, 'InvalidInput', 'Unknown reason.')
  const details = str(b.details, 'details', { optional: true, max: 2000 })
  const exists = await getDb().select({ id: sourceEvent.id }).from(sourceEvent).where(eq(sourceEvent.atUri, atUri)).limit(1)
  if (!exists[0]) throw notFound()
  const reporterHash = createHash('sha256').update(`${ip}|${new Date().toISOString().slice(0, 10)}`).digest('base64url')
  await getDb().insert(report).values({ id: id('rep'), atUri, reason, details: details || null, reporterHash, reporterDid: c.get('host')?.did ?? null })
  log.info('report received', { reason })
  return c.json({ ok: true, message: 'Thank you. A steward will look at this.' }, 201)
})

function requireSteward(c: AppContext): void {
  const k = config()
  const h = c.get('host')
  if (h && k.STEWARD_DIDS.includes(h.did)) return
  if (k.STEWARD_KEY && c.req.header('x-steward-key') === k.STEWARD_KEY) return
  throw notFound()
}

stewardRoutes.get('/reports', async (c) => {
  requireSteward(c)
  const open = c.req.query('all') !== '1'
  const rows = await getDb()
    .select({ r: report, e: sourceEvent, h: host })
    .from(report)
    .leftJoin(sourceEvent, eq(sourceEvent.atUri, report.atUri))
    .leftJoin(host, eq(host.id, sourceEvent.hostId))
    .where(open ? isNull(report.resolvedAt) : sql`true`)
    .orderBy(desc(report.createdAt))
    .limit(200)
  return c.json({
    reports: rows.map(({ r, e, h }) => ({
      id: r.id,
      atUri: r.atUri,
      reason: r.reason,
      details: r.details,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      resolution: r.resolution,
      event: e ? { id: e.id, name: (e.normalized as { name?: string }).name ?? null, state: e.state, visibility: e.visibility, hidden: !!(e.override as { hidden?: boolean } | null)?.hidden } : null,
      host: h ? { handle: h.handle, displayName: h.displayName, door: h.door } : null,
    })),
  })
})

/** dismiss | deindex | takedown */
stewardRoutes.post('/reports/:id', async (c) => {
  requireSteward(c)
  const b = await body(c)
  const action = str(b.action, 'action')
  if (!['dismiss', 'deindex', 'takedown'].includes(action)) throw new ApiError(400, 'InvalidInput', 'action must be dismiss, deindex or takedown.')
  const rows = await getDb().select().from(report).where(eq(report.id, c.req.param('id'))).limit(1)
  const r = rows[0]
  if (!r) throw notFound()
  const actor = c.get('host')?.did ?? 'steward-key'
  if (action !== 'dismiss') {
    const ev = await getDb().select({ e: sourceEvent, h: host }).from(sourceEvent).innerJoin(host, eq(host.id, sourceEvent.hostId)).where(eq(sourceEvent.atUri, r.atUri)).limit(1)
    const found = ev[0]
    if (found) {
      // De-index: hidden override → the next reconcile withdraws the public record (the host can see why in the dashboard).
      await getDb().update(sourceEvent).set({ override: { ...(found.e.override ?? {}), hidden: true, hiddenBy: 'steward', hiddenReason: r.reason } }).where(eq(sourceEvent.id, found.e.id))
      await enqueueSync(found.e.sourceId, 'manual')
      if (action === 'takedown' && found.h.door === 'custodial' && found.e.atCid) {
        try {
          await pdsAdmin.takedown(pdsConfig(), { uri: r.atUri, cid: found.e.atCid })
        } catch (err) {
          log.warn('takedown at the PDS failed; the record is still de-indexed and withdrawn', { detail: describeError(err) })
        }
      }
    }
  }
  await getDb().update(report).set({ resolvedAt: new Date(), resolution: action }).where(and(eq(report.id, r.id), isNull(report.resolvedAt)))
  await recordAudit({ actor, action: `moderation.${action}`, subject: r.atUri, detail: { reason: r.reason } })
  return c.json({ ok: true, resolution: action })
})
