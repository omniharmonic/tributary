/**
 * The confirmation queue (F10, F24): extracted events and widenings wait for a person.
 */
import { Hono } from 'hono'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { toCard, type RawEvent } from '@tributary/event-model'
import { getDb } from '../../db/index.js'
import { pendingConfirmation, sourceEvent } from '../../db/schema.js'
import { recordAudit } from '../../lib/audit.js'
import { expandConfirmed, type ExtractedEvent } from '../../lib/extract.js'
import { enqueueSync } from '../../jobs/index.js'
import { pushRawEvents, pushSourceFor } from '../../lib/sources.js'
import { loadPreview } from '../../lib/preview.js'
import { ApiError, body, notFound, requireHost, str, type Vars } from '../context.js'

export const confirmationRoutes = new Hono<{ Variables: Vars }>()

type Row = typeof pendingConfirmation.$inferSelect

function view(r: Row) {
  const p = r.payload as { extracted?: ExtractedEvent[]; card?: unknown; eventId?: string; from?: string; to?: string; notes?: string[] }
  const cards = p.extracted ? p.extracted.map((e) => ({ key: e.raw.externalId, ...cardFor(e.raw), confidence: e.confidence, evidence: e.evidence, flags: e.flags, nextDates: e.nextDates ?? null, needsConfirmation: true })) : p.card ? [p.card] : []
  return { id: r.id, kind: r.kind, createdAt: r.createdAt.toISOString(), expiresAt: r.expiresAt.toISOString(), channel: r.channel, sourceId: r.sourceId, cards, proposed: p.extracted ? { events: p.extracted.map((e) => e.raw) } : { eventId: p.eventId, from: p.from, to: p.to }, evidence: p.extracted?.[0]?.evidence ?? {}, notes: p.notes ?? [], resolvedAt: r.resolvedAt?.toISOString() ?? null, resolution: r.resolution }
}

function cardFor(raw: RawEvent) {
  const { normalize } = require_normalize()
  try {
    return toCard(normalize(raw, { sourceId: 'pending', sourceType: 'extract', platform: 'extract', defaultTz: raw.tz ?? 'America/Denver', fallbackUrl: raw.url ?? 'https://example.invalid', confidence: 'extracted-confirmed' }))
  } catch {
    return { name: raw.name, when: raw.start, startsAt: raw.start, timezone: raw.tz, missing: ['date'], complete: false }
  }
}

// Lazy import keeps this module light for the route table.
function require_normalize(): typeof import('@tributary/event-model') {
  return normalizeModule
}
import * as normalizeModule from '@tributary/event-model'

confirmationRoutes.get('/', async (c) => {
  const h = requireHost(c)
  const rows = await getDb().select().from(pendingConfirmation).where(and(eq(pendingConfirmation.hostId, h.id), isNull(pendingConfirmation.resolvedAt))).orderBy(desc(pendingConfirmation.createdAt)).limit(100)
  return c.json({ items: rows.map(view) })
})

/** An extract preview (flyer, text, page) becomes a confirmation item for the signed-in host. */
confirmationRoutes.post('/from-preview', async (c) => {
  const h = requireHost(c)
  const b = await body(c)
  const p = await loadPreview(str(b.previewId, 'previewId'))
  if (!p) throw new ApiError(404, 'NotFound', 'That preview has expired. Try again.')
  const summary = p.summary as { needsConfirmation?: boolean; extracted?: ExtractedEvent[]; notes?: string[] }
  if (!summary.needsConfirmation || !summary.extracted?.length) throw new ApiError(400, 'InvalidInput', 'This preview does not need confirmation; connect it as a source instead.')
  const pid = await queueExtraction(h.id, summary.extracted, summary.notes ?? [], 'console')
  return c.json({ id: pid }, 201)
})

confirmationRoutes.get('/:id', async (c) => {
  const h = requireHost(c)
  const rows = await getDb().select().from(pendingConfirmation).where(and(eq(pendingConfirmation.id, c.req.param('id')), eq(pendingConfirmation.hostId, h.id))).limit(1)
  if (!rows[0]) throw notFound()
  return c.json(view(rows[0]))
})

confirmationRoutes.post('/:id', async (c) => {
  const h = requireHost(c)
  const rows = await getDb().select().from(pendingConfirmation).where(and(eq(pendingConfirmation.id, c.req.param('id')), eq(pendingConfirmation.hostId, h.id), isNull(pendingConfirmation.resolvedAt))).limit(1)
  const r = rows[0]
  if (!r) throw notFound()
  const b = await body(c)
  const action = str(b.action, 'action')
  if (action !== 'confirm' && action !== 'reject') throw new ApiError(400, 'InvalidInput', 'action must be confirm or reject.')
  const db = getDb()
  if (action === 'reject') {
    await db.update(pendingConfirmation).set({ resolvedAt: new Date(), resolution: 'rejected' }).where(eq(pendingConfirmation.id, r.id))
    await recordAudit({ hostId: h.id, actor: h.did, action: `confirmation.rejected`, subject: r.id, detail: { kind: r.kind } })
    return c.json({ ok: true, resolution: 'rejected' })
  }

  const p = r.payload as { extracted?: ExtractedEvent[]; eventId?: string; to?: string; sourceDefault?: string }
  if (r.kind === 'extracted' && p.extracted) {
    const edits = (typeof b.edits === 'object' && b.edits ? (b.edits as Record<string, Partial<RawEvent>>) : {})
    const src = await pushSourceFor(h, 'extract')
    const raws: RawEvent[] = []
    for (const e of p.extracted) {
      const merged: RawEvent = { ...e.raw, ...(edits[e.raw.externalId] ?? {}) }
      if (!merged.name?.trim()) continue
      raws.push(...expandConfirmed(merged))
    }
    await pushRawEvents(src.id, raws)
    await db.update(pendingConfirmation).set({ resolvedAt: new Date(), resolution: 'confirmed' }).where(eq(pendingConfirmation.id, r.id))
    await recordAudit({ hostId: h.id, actor: h.did, action: 'confirmation.confirmed', subject: r.id, detail: { kind: 'extracted', events: raws.length } })
    await enqueueSync(src.id, 'manual')
    return c.json({ ok: true, resolution: 'confirmed', published: raws.length })
  }
  if (r.kind === 'widen' && p.eventId && p.to) {
    const ev = await db.select().from(sourceEvent).where(and(eq(sourceEvent.id, p.eventId), eq(sourceEvent.hostId, h.id))).limit(1)
    if (ev[0]) {
      const override: Record<string, unknown> = { ...(ev[0].override ?? {}), allowWidenTo: p.to }
      if (!p.sourceDefault) override.visibility = p.to
      await db.update(sourceEvent).set({ override }).where(eq(sourceEvent.id, ev[0].id))
      await recordAudit({ hostId: h.id, actor: h.did, action: 'event.widened', subject: ev[0].id, detail: { to: p.to } })
      await enqueueSync(ev[0].sourceId, 'manual')
    }
    await db.update(pendingConfirmation).set({ resolvedAt: new Date(), resolution: 'confirmed' }).where(eq(pendingConfirmation.id, r.id))
    return c.json({ ok: true, resolution: 'confirmed' })
  }
  await db.update(pendingConfirmation).set({ resolvedAt: new Date(), resolution: 'confirmed' }).where(eq(pendingConfirmation.id, r.id))
  return c.json({ ok: true, resolution: 'confirmed' })
})

/** Queue an extraction for a signed-in host (from the one-box or the email/bot channels). */
export async function queueExtraction(hostId: string, extracted: ExtractedEvent[], notes: string[], channel: 'console' | 'email' | 'telegram' = 'console', sourceId?: string): Promise<string> {
  const pid = `pc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  await getDb().insert(pendingConfirmation).values({ id: pid, hostId, sourceId: sourceId ?? null, kind: 'extracted', payload: { extracted, notes }, channel, expiresAt: new Date(Date.now() + 14 * 86_400_000) })
  return pid
}
