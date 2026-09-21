/**
 * Resolving a confirmation item, shared by the console route, the email link and the
 * Telegram bot. Confirm publishes (through the host's extract source); reject discards.
 */
import { and, eq, isNull } from 'drizzle-orm'
import type { RawEvent } from '@tributary/event-model'
import { getDb } from '../db/index.js'
import { pendingConfirmation, sourceEvent } from '../db/schema.js'
import { recordAudit } from './audit.js'
import { expandConfirmed, type ExtractedEvent } from './extract.js'
import { enqueueSync } from '../jobs/index.js'
import { getHost } from './hosts.js'
import { pushRawEvents, pushSourceFor } from './sources.js'

export type ConfirmOutcome = { ok: true; resolution: 'confirmed' | 'rejected'; published?: number } | { ok: false; reason: 'not-found' | 'already-resolved' }

export async function resolveConfirmation(hostId: string, confirmationId: string, action: 'confirm' | 'reject', edits: Record<string, Partial<RawEvent>> = {}, actorDid?: string): Promise<ConfirmOutcome> {
  const db = getDb()
  const rows = await db.select().from(pendingConfirmation).where(and(eq(pendingConfirmation.id, confirmationId), eq(pendingConfirmation.hostId, hostId))).limit(1)
  const r = rows[0]
  if (!r) return { ok: false, reason: 'not-found' }
  if (r.resolvedAt) return { ok: false, reason: 'already-resolved' }
  const h = await getHost(hostId)
  if (!h) return { ok: false, reason: 'not-found' }
  const actor = actorDid ?? h.did
  if (action === 'reject') {
    await db.update(pendingConfirmation).set({ resolvedAt: new Date(), resolution: 'rejected' }).where(eq(pendingConfirmation.id, r.id))
    await recordAudit({ hostId, actor, action: 'confirmation.rejected', subject: r.id, detail: { kind: r.kind } })
    return { ok: true, resolution: 'rejected' }
  }
  const p = r.payload as { extracted?: ExtractedEvent[]; eventId?: string; to?: string; sourceDefault?: string }
  if (r.kind === 'extracted' && p.extracted) {
    const src = await pushSourceFor(h, 'extract')
    const raws: RawEvent[] = []
    for (const e of p.extracted) {
      const merged: RawEvent = { ...e.raw, ...(edits[e.raw.externalId] ?? {}) }
      if (!merged.name?.trim()) continue
      raws.push(...expandConfirmed(merged))
    }
    await pushRawEvents(src.id, raws)
    await db.update(pendingConfirmation).set({ resolvedAt: new Date(), resolution: 'confirmed' }).where(eq(pendingConfirmation.id, r.id))
    await recordAudit({ hostId, actor, action: 'confirmation.confirmed', subject: r.id, detail: { kind: 'extracted', events: raws.length } })
    await enqueueSync(src.id, 'manual')
    return { ok: true, resolution: 'confirmed', published: raws.length }
  }
  if (r.kind === 'widen' && p.eventId && p.to) {
    const ev = await db.select().from(sourceEvent).where(and(eq(sourceEvent.id, p.eventId), eq(sourceEvent.hostId, hostId))).limit(1)
    if (ev[0]) {
      const override: Record<string, unknown> = { ...(ev[0].override ?? {}), allowWidenTo: p.to }
      if (!p.sourceDefault) override.visibility = p.to
      await db.update(sourceEvent).set({ override }).where(eq(sourceEvent.id, ev[0].id))
      await recordAudit({ hostId, actor, action: 'event.widened', subject: ev[0].id, detail: { to: p.to } })
      await enqueueSync(ev[0].sourceId, 'manual')
    }
  }
  await db.update(pendingConfirmation).set({ resolvedAt: new Date(), resolution: 'confirmed' }).where(and(eq(pendingConfirmation.id, r.id), isNull(pendingConfirmation.resolvedAt)))
  return { ok: true, resolution: 'confirmed' }
}
