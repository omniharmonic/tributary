import { describe, expect, it } from 'vitest'
import { normalize, type NormalizedEvent } from '@tributary/event-model'
import { planReconcile, type LedgerRow } from '../src/pipeline/reconcile.js'

const now = new Date('2026-09-21T12:00:00Z')
const window = { from: new Date('2026-09-20T00:00:00Z'), to: new Date('2026-12-20T00:00:00Z') }

function ev(externalId: string, name = 'Event ' + externalId, start = '2026-10-04T10:00:00', extra: Partial<NormalizedEvent> = {}): NormalizedEvent {
  const e = normalize({ externalId, name, start, tz: 'America/Denver', url: `https://x.org/${externalId}` }, { sourceId: 's', sourceType: 'ics', platform: 'google', defaultTz: 'America/Denver', fallbackUrl: 'https://x.org' })
  return { ...e, ...extra }
}

function row(e: NormalizedEvent, over: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: 'r_' + e.identity.externalId,
    externalId: e.identity.externalId,
    occurrence: e.identity.occurrence ?? '',
    contentHash: e.contentHash,
    state: 'live',
    visibility: e.visibility,
    visibilitySource: 'host-default',
    atUri: 'at://did/coll/rkey',
    spaceUri: null,
    startsAt: new Date(e.start.instant),
    endsAt: e.end ? new Date(e.end.instant) : null,
    missingSince: null,
    missingRuns: 0,
    cancelledAt: null,
    override: null,
    normalized: e,
    ...over,
  }
}

describe('planReconcile', () => {
  it('creates new, touches unchanged, updates changed', () => {
    const a = ev('a')
    const b = ev('b')
    const plan = planReconcile({ rows: [row(a), row(b)], events: [a, { ...ev('b', 'Renamed'), identity: b.identity }, ev('c')], complete: true, window, now })
    const kinds = plan.actions.map((x) => x.kind).sort()
    expect(kinds).toEqual(['create', 'touch', 'update'])
  })
  it('does nothing on an incomplete fetch', () => {
    const a = ev('a')
    const plan = planReconcile({ rows: [row(a)], events: [], complete: false, window, now })
    expect(plan.actions[0]?.kind).toBe('leave')
  })
  it('marks missing, cancels after the grace period, removes after 7 days', () => {
    const a = ev('a')
    expect(planReconcile({ rows: [row(a)], events: [], complete: true, window, now }).actions[0]?.kind).toBe('missing')
    const later = new Date(now.getTime() + 7 * 3_600_000)
    expect(planReconcile({ rows: [row(a, { missingSince: now, missingRuns: 1 })], events: [], complete: true, window, now: later }).actions[0]?.kind).toBe('cancel')
    expect(planReconcile({ rows: [row(a, { missingSince: now, missingRuns: 1 })], events: [], complete: true, window, now: new Date(now.getTime() + 3_600_000) }).actions[0]?.kind).toBe('missing')
    const week = new Date(now.getTime() + 8 * 86_400_000)
    expect(planReconcile({ rows: [row(a, { state: 'cancelled', cancelledAt: now })], events: [], complete: true, window, now: week }).actions[0]?.kind).toBe('remove')
  })
  it('leaves past events and events outside the observed window alone', () => {
    const past = ev('p', 'Past', '2026-09-01T10:00:00')
    expect(planReconcile({ rows: [row(past)], events: [], complete: true, window, now }).actions[0]?.kind).toBe('leave')
    const far = ev('f', 'Far', '2027-03-01T10:00:00')
    expect(planReconcile({ rows: [row(far)], events: [], complete: true, window, now }).actions[0]?.kind).toBe('leave')
  })
  it('detects UID churn and rekeys instead of cancelling', () => {
    const olds = Array.from({ length: 6 }, (_, i) => ev(`old${i}`, `Title ${i}`, `2026-10-0${i + 1}T10:00:00`))
    const news = Array.from({ length: 6 }, (_, i) => ev(`new${i}`, `Title ${i}`, `2026-10-0${i + 1}T10:00:00`))
    const plan = planReconcile({ rows: olds.map((e) => row(e)), events: news, complete: true, window, now })
    expect(plan.uidChurn).toBe(true)
    expect(plan.actions.filter((a) => a.kind === 'rekey')).toHaveLength(6)
    expect(plan.actions.some((a) => a.kind === 'missing' || a.kind === 'cancel')).toBe(false)
  })
  it('narrows at once and queues widening for confirmation', () => {
    const a = ev('a')
    const narrowed = { ...a, visibility: 'unlisted' as const }
    expect(planReconcile({ rows: [row(a)], events: [narrowed], complete: true, window, now }).actions[0]).toMatchObject({ kind: 'update', levelChanged: true })
    const widened = { ...a, visibility: 'public' as const }
    const heldRow = row({ ...a, visibility: 'held' }, { state: 'held', atUri: null, visibilitySource: 'source-signal' })
    expect(planReconcile({ rows: [heldRow], events: [widened], complete: true, window, now }).actions[0]?.kind).toBe('widen-pending')
    const allowed = { ...heldRow, override: { allowWidenTo: 'public' } }
    expect(planReconcile({ rows: [allowed], events: [widened], complete: true, window, now }).actions[0]?.kind).toBe('update')
  })
})
