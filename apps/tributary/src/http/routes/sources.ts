/**
 * Sources: list, connect, inspect, patch, sync now, remove, rules.
 */
import { Hono } from 'hono'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { unpublishEvent } from '@tributary/publisher'
import { isWidening, VISIBILITY_RANK } from '@tributary/visibility'
import type { Visibility } from '@tributary/event-model'
import { getDb } from '../../db/index.js'
import { pendingConfirmation, source, sourceEvent, syncRun, visibilityRule } from '../../db/schema.js'
import { recordAudit } from '../../lib/audit.js'
import { writerFor } from '../../lib/hosts.js'
import { id } from '../../lib/ids.js'
import { enqueueSync } from '../../jobs/index.js'
import { describeError, log } from '../../lib/logging.js'
import { isPushPreview, loadPreview } from '../../lib/preview.js'
import { connectSource, publicSource, SourceError } from '../../lib/sources.js'
import { deletePermissioned } from '../../pipeline/gate.js'
import { ApiError, body, notFound, rateLimit, requireHost, str, type Vars } from '../context.js'
import { toCard, type NormalizedEvent } from '@tributary/event-model'

export const sourceRoutes = new Hono<{ Variables: Vars }>()

const VIS: Visibility[] = ['public', 'unlisted', 'gated', 'members', 'invite', 'held']

async function counts(sourceIds: string[]): Promise<Map<string, { live: number; cancelled: number; held: number }>> {
  const out = new Map<string, { live: number; cancelled: number; held: number }>()
  if (sourceIds.length === 0) return out
  const rows = await getDb()
    .select({ sourceId: sourceEvent.sourceId, state: sourceEvent.state, n: sql<number>`count(*)` })
    .from(sourceEvent)
    .where(and(inArray(sourceEvent.sourceId, sourceIds), sql`${sourceEvent.startsAt} > now() - interval '1 day'`))
    .groupBy(sourceEvent.sourceId, sourceEvent.state)
  for (const r of rows) {
    const c = out.get(r.sourceId) ?? { live: 0, cancelled: 0, held: 0 }
    if (r.state === 'live') c.live = Number(r.n)
    if (r.state === 'cancelled') c.cancelled = Number(r.n)
    if (r.state === 'held') c.held = Number(r.n)
    out.set(r.sourceId, c)
  }
  return out
}

async function ownSource(hostId: string, sourceId: string) {
  const rows = await getDb().select().from(source).where(and(eq(source.id, sourceId), eq(source.hostId, hostId))).limit(1)
  if (!rows[0]) throw notFound()
  return rows[0]
}

sourceRoutes.get('/', async (c) => {
  const h = requireHost(c)
  const rows = await getDb().select().from(source).where(eq(source.hostId, h.id)).orderBy(desc(source.createdAt))
  const cs = await counts(rows.map((r) => r.id))
  return c.json({ sources: rows.map((s) => publicSource(s, cs.get(s.id))) })
})

sourceRoutes.post('/', async (c) => {
  const h = requireHost(c)
  const b = await body(c)
  const visibility = (str(b.defaultVisibility, 'defaultVisibility', { optional: true }) || 'public') as Visibility
  if (!VIS.includes(visibility)) throw new ApiError(400, 'InvalidInput', 'Unknown visibility level.')
  const audience = typeof b.audience === 'object' && b.audience ? (b.audience as never) : undefined
  try {
    if (typeof b.previewId === 'string') {
      const p = await loadPreview(b.previewId)
      if (!p) throw new ApiError(404, 'NotFound', 'That preview has expired. Paste the link again.')
      if ((p.summary as { needsConfirmation?: boolean }).needsConfirmation) throw new ApiError(400, 'NeedsConfirmation', 'Extracted events go through the confirmation queue.')
      const m = p.match as { type: string; platform?: string }
      const r = await connectSource(h, { type: m.type as never, platform: m.platform ?? '', config: p.config, defaultVisibility: visibility, audience, tz: p.tz, rawEvents: isPushPreview(p) ? (p.rawEvents as never) : undefined })
      return c.json({ source: publicSource(r.source), created: r.created }, r.created ? 201 : 200)
    }
    if (typeof b.match === 'object' && b.match) {
      const m = b.match as { type: string; platform?: string }
      const r = await connectSource(h, { type: m.type as never, platform: m.platform ?? '', match: b.match as never, defaultVisibility: visibility, audience })
      return c.json({ source: publicSource(r.source), created: r.created }, r.created ? 201 : 200)
    }
  } catch (err) {
    if (err instanceof SourceError) throw new ApiError(err.status, err.code as never, err.message)
    throw err
  }
  throw new ApiError(400, 'InvalidInput', 'Send a previewId or a match.')
})

sourceRoutes.get('/:id', async (c) => {
  const h = requireHost(c)
  const s = await ownSource(h.id, c.req.param('id'))
  const rules = await getDb().select().from(visibilityRule).where(eq(visibilityRule.sourceId, s.id)).orderBy(visibilityRule.position)
  const runs = await getDb().select().from(syncRun).where(eq(syncRun.sourceId, s.id)).orderBy(desc(syncRun.startedAt)).limit(10)
  const cs = await counts([s.id])
  return c.json({
    ...publicSource(s, cs.get(s.id)),
    interval: Math.round(s.intervalMs / 60_000),
    rules: rules.map((r) => ({ id: r.id, match: r.match, level: r.level, audience: r.audience, gatedFields: r.gatedFields })),
    syncRuns: runs.map((r) => ({ startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null, ok: r.ok, notModified: r.notModified, fetched: r.fetched, published: r.published, updated: r.updated, unchanged: r.unchanged, cancelled: r.cancelled, removed: r.removed, held: r.held, failed: r.failed, error: r.error })),
  })
})

sourceRoutes.patch('/:id', async (c) => {
  const h = requireHost(c)
  const s = await ownSource(h.id, c.req.param('id'))
  const b = await body(c)
  const patch: Partial<typeof source.$inferInsert> = {}
  if (typeof b.paused === 'boolean') patch.status = b.paused ? 'paused' : 'active'
  if (typeof b.interval === 'number' && b.interval >= 10 && b.interval <= 1440) patch.intervalMs = Math.round(b.interval) * 60_000
  if (typeof b.tz === 'string' && b.tz) patch.tz = b.tz
  if (typeof b.audience === 'object' && b.audience) patch.audience = b.audience as never
  let pending = 0
  if (typeof b.defaultVisibility === 'string') {
    const to = b.defaultVisibility as Visibility
    if (!VIS.includes(to)) throw new ApiError(400, 'InvalidInput', 'Unknown visibility level.')
    if (isWidening(s.defaultVisibility as Visibility, to)) {
      // Widening waits for a person, per event, through the confirmation queue.
      const rows = await getDb().select().from(sourceEvent).where(and(eq(sourceEvent.sourceId, s.id), inArray(sourceEvent.state, ['live', 'held']), sql`${sourceEvent.startsAt} > now()`))
      for (const r of rows) {
        if (VISIBILITY_RANK[r.visibility as Visibility] >= VISIBILITY_RANK[to]) continue
        await getDb().insert(pendingConfirmation).values({ id: id('pc'), hostId: h.id, sourceId: s.id, kind: 'widen', payload: { eventId: r.id, from: r.visibility, to, card: toCard(r.normalized as unknown as NormalizedEvent), sourceDefault: to }, expiresAt: new Date(Date.now() + 30 * 86_400_000) })
        pending++
      }
      await recordAudit({ hostId: h.id, actor: h.did, action: 'source.widen-requested', subject: s.id, detail: { from: s.defaultVisibility, to, pending } })
      patch.defaultVisibility = to
    } else {
      patch.defaultVisibility = to
      if (to !== s.defaultVisibility) await recordAudit({ hostId: h.id, actor: h.did, action: 'source.narrowed', subject: s.id, detail: { from: s.defaultVisibility, to } })
    }
  }
  if (Object.keys(patch).length) await getDb().update(source).set(patch).where(eq(source.id, s.id))
  if (patch.defaultVisibility || patch.status === 'active') await enqueueSync(s.id, 'manual')
  const [updated] = await getDb().select().from(source).where(eq(source.id, s.id))
  if (pending > 0) return c.json({ source: publicSource(updated!), pendingConfirmation: pending }, 202)
  return c.json({ source: publicSource(updated!) })
})

sourceRoutes.post('/:id/sync', async (c) => {
  const h = requireHost(c)
  const s = await ownSource(h.id, c.req.param('id'))
  rateLimit(`sync:${s.id}`, 1, 60_000)
  const jobId = await enqueueSync(s.id, 'manual')
  return c.json({ jobId }, 202)
})

sourceRoutes.delete('/:id', async (c) => {
  const h = requireHost(c)
  const s = await ownSource(h.id, c.req.param('id'))
  const rows = await getDb().select().from(sourceEvent).where(eq(sourceEvent.sourceId, s.id))
  let removed = 0
  let writer: Awaited<ReturnType<typeof writerFor>> | undefined
  try {
    writer = await writerFor(h)
  } catch {
    writer = undefined
  }
  for (const r of rows) {
    try {
      if (r.atUri && r.rkey && writer) await unpublishEvent(writer, r.rkey)
      if (r.spaceUri) await deletePermissioned(h.did as `did:${string}`, r)
      removed++
    } catch (err) {
      log.warn('remove source: a record could not be deleted', { detail: describeError(err) })
    }
  }
  await getDb().delete(source).where(eq(source.id, s.id))
  await recordAudit({ hostId: h.id, actor: h.did, action: 'source.removed', subject: s.id, detail: { removed } })
  return c.json({ removed })
})

/* ── rules ──────────────────────────────────────────────────────────────────── */

sourceRoutes.get('/:id/rules', async (c) => {
  const h = requireHost(c)
  const s = await ownSource(h.id, c.req.param('id'))
  const rules = await getDb().select().from(visibilityRule).where(eq(visibilityRule.sourceId, s.id)).orderBy(visibilityRule.position)
  return c.json({ rules: rules.map((r) => ({ id: r.id, match: r.match, level: r.level, audience: r.audience, gatedFields: r.gatedFields })) })
})

sourceRoutes.put('/:id/rules', async (c) => {
  const h = requireHost(c)
  const s = await ownSource(h.id, c.req.param('id'))
  const b = await body(c)
  const rules = Array.isArray(b.rules) ? (b.rules as Array<Record<string, unknown>>) : null
  if (!rules) throw new ApiError(400, 'InvalidInput', 'rules must be an array.')
  if (rules.length > 50) throw new ApiError(400, 'InvalidInput', 'At most 50 rules.')
  for (const r of rules) {
    if (!VIS.includes(r.level as Visibility)) throw new ApiError(400, 'InvalidInput', 'Each rule needs a level.')
    if (typeof r.match !== 'object' || !r.match) throw new ApiError(400, 'InvalidInput', 'Each rule needs a match.')
  }
  await getDb().transaction(async (tx) => {
    await tx.delete(visibilityRule).where(eq(visibilityRule.sourceId, s.id))
    for (const [i, r] of rules.entries()) {
      await tx.insert(visibilityRule).values({ id: id('rule'), sourceId: s.id, position: i, match: r.match as Record<string, unknown>, level: r.level as string, audience: (r.audience as never) ?? null, gatedFields: Array.isArray(r.gatedFields) ? (r.gatedFields as string[]) : null })
    }
  })
  await recordAudit({ hostId: h.id, actor: h.did, action: 'source.rules', subject: s.id, detail: { count: rules.length } })
  await enqueueSync(s.id, 'manual')
  return c.json({ ok: true, count: rules.length })
})
