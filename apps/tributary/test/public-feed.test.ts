/**
 * Paging the directory, and the feed people subscribe to.
 *
 * The pagination bug this covers was invisible from the API's shape: `/events` answered
 * 200 events and `cursor: null`, which looks like "that is all of them". The ledger held
 * eight months. Anyone browsing saw about three weeks.
 */
import { describe, expect, it } from 'vitest'
import { decodeCursor, encodeCursor, icsFor } from '../src/http/routes/public.js'
import type { NormalizedEvent } from '@tributary/event-model'

const MT = 'America/Denver'

/** RFC 5545 line folding: a continuation is CRLF followed by one space. */
const unfold = (ics: string) => ics.replace(/\r\n /g, '')

function ev(over: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    identity: { sourceId: 's', externalId: 'e1' },
    name: 'Seed swap',
    start: { instant: '2026-10-04T16:00:00.000Z', tz: MT, allDay: false, tzInferred: false },
    status: 'scheduled',
    mode: 'inperson',
    locations: [{ name: 'Growing Gardens', street: '1630 Hawthorn Ave', locality: 'Boulder', region: 'CO', precision: 'exact', private: false, lat: 40.0339, lon: -105.2611 }],
    links: [],
    tags: [],
    sourceUrl: 'https://example.org/seed-swap',
    visibility: 'public',
    contentHash: 'h',
    provenance: { platform: 'ics', method: 'ics', fetchedAt: '2026-09-25T00:00:00.000Z' },
    ...over,
  } as NormalizedEvent
}

describe('cursor', () => {
  it('round-trips the pair that orders the ledger', () => {
    const at = new Date('2026-10-04T16:00:00.000Z')
    const back = decodeCursor(encodeCursor(at, 'sev_abc'))
    expect(back?.startsAt.toISOString()).toBe(at.toISOString())
    expect(back?.id).toBe('sev_abc')
  })

  it('treats a cursor it cannot read as the start of the list, not an error', () => {
    expect(decodeCursor(undefined)).toBeUndefined()
    expect(decodeCursor('')).toBeUndefined()
    expect(decodeCursor('bm90LWEtY3Vyc29y')).toBeUndefined()
    expect(decodeCursor(Buffer.from('not-a-date|sev_abc').toString('base64url'))).toBeUndefined()
    expect(decodeCursor(Buffer.from('2026-10-04T16:00:00.000Z|').toString('base64url'))).toBeUndefined()
  })

  it('is url-safe, because it travels in a query string', () => {
    const c = encodeCursor(new Date('2026-10-04T16:00:00.000Z'), 'sev_abc')
    expect(c).toBe(encodeURIComponent(c))
  })
})

describe('subscribable feed', () => {
  it('writes an all-day event as a date, so it cannot slide a day east of us', () => {
    const allDay = ev({ start: { instant: '2026-10-04T06:00:00.000Z', tz: MT, allDay: true, tzInferred: false } })
    const ics = icsFor([{ n: allDay, uid: 'u1@example.org', cancelled: false }], 'Test')
    expect(ics).toContain('DTSTART;VALUE=DATE:20261004')
    // DTEND is exclusive for a date value: one day means the next morning.
    expect(ics).toContain('DTEND;VALUE=DATE:20261005')
    expect(ics).not.toMatch(/DTSTART:\d{8}T/)
  })

  it('never writes a zero-length all-day event, whatever the source said', () => {
    // Nissi's ships all-day events whose end instant is on the start date.
    const sameDayEnd = ev({
      start: { instant: '2026-09-27T06:00:00.000Z', tz: MT, allDay: true, tzInferred: false },
      end: { instant: '2026-09-27T06:00:00.000Z' },
    })
    const ics = icsFor([{ n: sameDayEnd, uid: 'u@x', cancelled: false }], 'Test')
    expect(ics).toContain('DTSTART;VALUE=DATE:20260927')
    expect(ics).toContain('DTEND;VALUE=DATE:20260928')
  })

  it('keeps a genuine multi-day all-day span', () => {
    const span = ev({
      start: { instant: '2026-10-03T06:00:00.000Z', tz: MT, allDay: true, tzInferred: false },
      end: { instant: '2026-10-05T06:00:00.000Z' },
    })
    const ics = icsFor([{ n: span, uid: 'u@x', cancelled: false }], 'Test')
    expect(ics).toContain('DTSTART;VALUE=DATE:20261003')
    expect(ics).toContain('DTEND;VALUE=DATE:20261005')
  })

  it('writes a timed event as an instant', () => {
    const ics = icsFor([{ n: ev(), uid: 'u1@example.org', cancelled: false }], 'Test')
    expect(ics).toContain('DTSTART:20261004T160000Z')
  })

  it('asks subscribers to come back, because their own default is measured in hours', () => {
    const url = 'https://boulderevents.directory/api/public/regions/boulder/calendar.ics'
    const ics = icsFor([], 'Test', { url })
    expect(ics).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT2H')
    // A line over 75 octets is folded, so the URL is read back the way a client reads it.
    expect(unfold(ics)).toContain(`SOURCE;VALUE=URI:${url}`)
  })

  it('gives a coordinate only for a place it would print in full', () => {
    expect(icsFor([{ n: ev(), uid: 'u@x', cancelled: false }], 'T')).toContain('GEO:40.0339;-105.2611')
    const gated = ev({ visibility: 'gated' })
    const ics = icsFor([{ n: gated, uid: 'u@x', cancelled: false }], 'T')
    expect(ics).not.toContain('GEO:')
    expect(ics).toContain('LOCATION:Boulder\\, CO')
  })
})
