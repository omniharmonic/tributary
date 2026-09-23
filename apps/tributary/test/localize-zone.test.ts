/**
 * Relabelling a wrong zone, and the line it must not cross.
 *
 * CU Boulder's Localist feeds declare `X-WR-TIMEZONE:Eastern Time (US & Canada)` while
 * writing every DTSTART in UTC. The instant is correct; the label is not, and the label
 * is what a card renders, so a December concert at Macky read "9:30 PM EST" in Boulder.
 */
import { describe, expect, it } from 'vitest'
import { localizeZone } from '../src/pipeline/enrich.js'
import type { NormalizedEvent } from '@tributary/event-model'

const MT = 'America/Denver'
const MACKY = { lat: 40.0111, lon: -105.2757, precision: 'exact' as const, private: false, name: 'Macky Auditorium' }

function ev(over: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    identity: { sourceId: 's', externalId: 'e1' },
    name: 'Concert',
    start: { instant: '2026-12-19T02:30:00.000Z', tz: 'America/New_York', allDay: false, tzInferred: false },
    status: 'scheduled',
    mode: 'inperson',
    locations: [MACKY],
    sourceUrl: 'https://example.org/e1',
    links: [],
    tags: [],
    provenance: { platform: 'localist', method: 'ics', fetchedAt: '2026-09-23T00:00:00Z', confidence: 'structured' },
    visibility: 'public',
    contentHash: 'h',
    ...over,
  } as NormalizedEvent
}

describe('localizeZone', () => {
  it('relabels an event pinned inside the region', () => {
    const out = localizeZone(ev(), MT)
    expect(out.start.tz).toBe(MT)
    expect(out.start.tzInferred).toBe(true)
  })

  it('never moves the event', () => {
    // The whole safety of this rests here. Relabelling must not reinterpret the instant,
    // or every CU event would jump two hours the first time it was enriched.
    const before = ev()
    const after = localizeZone(before, MT)
    expect(after.start.instant).toBe(before.start.instant)
    expect(new Date(after.start.instant).getTime()).toBe(new Date(before.start.instant).getTime())
  })

  it('leaves an event alone when we have not pinned it', () => {
    expect(localizeZone(ev({ locations: [{ precision: 'city', private: false, name: 'Boulder' }] }), MT).start.tz).toBe('America/New_York')
    expect(localizeZone(ev({ locations: [] }), MT).start.tz).toBe('America/New_York')
  })

  it('leaves an event alone when it is genuinely somewhere else', () => {
    // Carnegie Hall. A Boulder host may list a trip; its local time really is Eastern.
    const elsewhere = ev({ locations: [{ lat: 40.7651, lon: -73.9799, precision: 'exact', private: false, name: 'Carnegie Hall' }] })
    expect(localizeZone(elsewhere, MT).start.tz).toBe('America/New_York')
  })

  it('leaves all-day and virtual events alone', () => {
    // For an all-day event the zone decides which date is shown, so relabelling could
    // move it a day. A virtual event has no local time to be wrong about.
    expect(localizeZone(ev({ start: { ...ev().start, allDay: true } }), MT).start.tz).toBe('America/New_York')
    expect(localizeZone(ev({ mode: 'virtual' }), MT).start.tz).toBe('America/New_York')
  })

  it('is a no-op when the feed already agreed', () => {
    const already = ev({ start: { ...ev().start, tz: MT } })
    expect(localizeZone(already, MT)).toBe(already)
  })
})
