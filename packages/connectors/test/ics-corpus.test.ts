import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseIcs, preclean } from '../src/ics/parse.js'
import { resolveTzid } from '../src/ics/tz.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const DIR = path.resolve(here, '../../../fixtures/ics')
const NOW = new Date('2026-09-21T00:00:00Z')
const WINDOW = { from: new Date(NOW.getTime() - 86_400_000), to: new Date(NOW.getTime() + 90 * 86_400_000) }
const OPTS = { window: WINDOW, defaultTz: 'America/Denver', now: NOW }

function fixture(name: string) {
  return readFileSync(path.join(DIR, `${name}.ics`), 'utf8')
}
function parse(name: string) {
  return parseIcs(fixture(name), OPTS)
}
function expected(name: string) {
  return JSON.parse(readFileSync(path.join(DIR, 'expected', `${name}.json`), 'utf8')) as {
    meta: unknown
    complete: boolean
    dropped: number
    window: { from?: string; to?: string }
    events: unknown[]
  }
}

describe('golden corpus: every fixture matches its expected RawEvent[]', () => {
  const names = readdirSync(DIR).filter((f) => f.endsWith('.ics')).map((f) => f.replace(/\.ics$/, ''))
  it('has the full corpus', () => {
    expect(names.length).toBeGreaterThanOrEqual(13)
  })
  for (const name of names) {
    it(name, () => {
      const r = parse(name)
      const e = expected(name)
      expect(JSON.parse(JSON.stringify(r.events))).toEqual(e.events)
      expect(r.meta).toEqual(e.meta)
      expect(r.complete).toBe(e.complete)
      expect(r.dropped).toBe(e.dropped)
      expect(r.window.from?.toISOString()).toBe(e.window.from)
      expect(r.window.to?.toISOString()).toBe(e.window.to)
    })
  }
})

describe('recurrence (google-recurring-with-exceptions)', () => {
  const r = parse('google-recurring-with-exceptions')
  const series = r.events.filter((e) => e.externalId === 'seedswap-weekly@google.com')
  it('expands weekly occurrences inside the window only, honouring UNTIL', () => {
    expect(series.map((e) => e.occurrence)).toEqual([
      '2026-09-26T16:00:00.000Z',
      '2026-10-10T16:00:00.000Z',
      '2026-10-17T16:00:00.000Z',
      '2026-10-24T16:00:00.000Z',
      '2026-10-31T16:00:00.000Z',
      '2026-11-07T17:00:00.000Z',
    ])
  })
  it('removes the EXDATE instance', () => {
    expect(series.find((e) => e.occurrence === '2026-10-03T16:00:00.000Z')).toBeUndefined()
  })
  it('applies a RECURRENCE-ID override while keeping the original occurrence identity', () => {
    const moved = series.find((e) => e.occurrence === '2026-10-10T16:00:00.000Z')!
    expect(moved.name).toBe('Seed Swap (Sunday edition)')
    expect(moved.start).toBe('2026-10-11T14:00:00')
    expect(moved.end).toBe('2026-10-11T17:00:00')
    expect(moved.sequence).toBe(3)
    // Inherits fields the exception did not override.
    expect(moved.location).toContain('Boulder Public Library')
  })
  it('marks a cancelled instance cancelled rather than dropping it', () => {
    const cancelled = series.find((e) => e.occurrence === '2026-10-24T16:00:00.000Z')!
    expect(cancelled.status).toBe('cancelled')
  })
  it('carries the wall clock and zone so the fall-back offset resolves correctly', () => {
    const nov = series.find((e) => e.occurrence === '2026-11-07T17:00:00.000Z')!
    expect(nov.start).toBe('2026-11-07T10:00:00')
    expect(nov.tz).toBe('America/Denver')
    for (const e of series) expect(e.seriesKey).toBe('seedswap-weekly@google.com')
  })
  it('non-recurring events have no occurrence', () => {
    const once = r.events.find((e) => e.externalId === 'onceoff@google.com')!
    expect(once.occurrence).toBeUndefined()
    expect(once.seriesKey).toBeUndefined()
  })
})

describe('timezones', () => {
  it('maps Windows and display names to IANA and lets per-event TZID win over the feed zone', () => {
    const r = parse('outlook-windows-tz')
    expect(r.meta.tz).toBe('America/Denver')
    const [council, planning] = r.events
    expect(council!.tz).toBe('America/Denver')
    expect(council!.start).toBe('2026-10-06T18:00:00')
    expect(planning!.tz).toBe('America/New_York')
    expect(planning!.start).toBe('2026-10-13T19:00:00')
  })
  it('resolveTzid handles the common spellings', () => {
    expect(resolveTzid('America/Denver')).toBe('America/Denver')
    expect(resolveTzid('Mountain Standard Time')).toBe('America/Denver')
    expect(resolveTzid('(UTC-07:00) Mountain Time (US & Canada)')).toBe('America/Denver')
    expect(resolveTzid('/mozilla.org/20050126_1/America/Denver')).toBe('America/Denver')
    expect(resolveTzid('Central Europe Standard Time')).toBe('Europe/Budapest')
    expect(resolveTzid('MST')).toBe('America/Denver')
    expect(resolveTzid('Nowhere/Zone')).toBeUndefined()
    expect(resolveTzid('')).toBeUndefined()
  })
  it('uses X-WR-TIMEZONE for UTC-stamped Google feeds and flags nothing when the feed said its zone', () => {
    const r = parse('google-basic')
    expect(r.events).toHaveLength(1)
    expect(r.events[0]!.start).toBe('2026-10-02T01:00:00Z')
    expect(r.events[0]!.tz).toBe('America/Denver')
  })
  it('reports floating and UTC times with no zone when the feed has none (so the normalizer flags them)', () => {
    const r = parse('floating-times')
    const floating = r.events.find((e) => e.externalId === 'floating-1@example.org')!
    expect(floating.start).toBe('2026-10-12T18:30:00')
    expect(floating.tz).toBeUndefined()
    const utc = r.events.find((e) => e.externalId === 'utc-1@example.org')!
    expect(utc.start).toBe('2026-10-13T01:00:00Z')
    expect(utc.tz).toBeUndefined()
  })
  it('takes the zone from VTIMEZONE/TZID when there is no X-WR-TIMEZONE', () => {
    const r = parse('icloud')
    expect(r.meta.tz).toBeUndefined()
    expect(r.events[0]!.tz).toBe('America/Denver')
    expect(r.events[0]!.url).toBe('https://repaircafeboulder.example.org')
    expect(r.events.map((e) => e.start)).toEqual(['2026-10-03T10:00:00', '2026-11-07T10:00:00', '2026-12-05T10:00:00'])
  })
})

describe('all-day', () => {
  const r = parse('all-day-multiday')
  it('publishes VALUE=DATE as date strings with allDay', () => {
    const fest = r.events.find((e) => e.externalId === 'festival-2026@example.org')!
    expect(fest).toMatchObject({ allDay: true, start: '2026-10-16', end: '2026-10-19', tz: 'America/Denver' })
    const parade = r.events.find((e) => e.externalId === 'single-day@example.org')!
    expect(parade).toMatchObject({ allDay: true, start: '2026-10-31', end: '2026-11-01' })
  })
  it('expands recurring all-day events with local-midnight occurrence ids', () => {
    const occ = r.events.filter((e) => e.externalId === 'all-day-recurring@example.org').map((e) => e.occurrence)
    expect(occ).toEqual(['2026-10-01T06:00:00.000Z', '2026-11-01T06:00:00.000Z', '2026-12-01T07:00:00.000Z'])
  })
})

describe('descriptions, images, organizer, categories', () => {
  it('prefers X-ALT-DESC html and reads ATTACH images', () => {
    const [e] = parse('wordpress-x-alt-desc').events
    expect(e!.descriptionIsHtml).toBe(true)
    expect(e!.description).toContain('<strong>6pm</strong>')
    expect(e!.imageUrl).toBe('https://etown.example.org/wp-content/uploads/2026/09/bluegrass.jpg')
    expect(e!.organizerName).toBe('eTown')
    expect(e!.tags).toEqual(['Music', 'Live Performance'])
    expect(e!.geo).toEqual({ lat: 40.0189, lon: -105.2795 })
    expect(e!.url).toBe('https://etown.example.org/event/bluegrass-collective/')
  })
  it('reads the Tockify featured image', () => {
    expect(parse('tockify-featured-image').events[0]!.imageUrl).toBe('https://cdn.tockify.com/images/market-hero.jpg')
  })
  it('unescapes DESCRIPTION text', () => {
    const [e] = parse('google-recurring-with-exceptions').events
    expect(e!.description).toBe('Bring seeds, take seeds. Details at https://frsl.example.org/seed-swap')
  })
})

describe('privacy and status', () => {
  const r = parse('class-private')
  it('maps CLASS to sourcePrivacy', () => {
    expect(r.events.map((e) => [e.externalId, e.sourcePrivacy])).toEqual([
      ['public-1@google.com', 'public'],
      ['private-1@google.com', 'private'],
      ['confidential-1@google.com', 'confidential'],
      ['unmarked-1@google.com', undefined],
    ])
  })
  it('never surfaces ATTENDEE data or organizer mailto addresses', () => {
    const json = JSON.stringify(r.events)
    expect(json).not.toMatch(/jane\.doe|bob@example|chair@example|mailto:|calendar@example/i)
    expect(r.events[0]!.organizerName).toBe('Front Range Seed Library')
  })
  it('does not take a conference link as the event URL', () => {
    expect(r.events[1]!.url).toBeUndefined()
    expect(r.events[1]!.description).toContain('zoom.us')
  })
  it('maps STATUS:CANCELLED and ignores TENTATIVE; carries SEQUENCE and LAST-MODIFIED', () => {
    const c = parse('cancelled-and-sequence')
    expect(c.events.map((e) => e.status)).toEqual([undefined, 'cancelled', undefined])
    expect(c.events[0]!.sequence).toBe(7)
    expect(c.events[0]!.lastModified).toBe('2026-09-20T10:10:10.000Z')
  })
})

describe('windows and robustness', () => {
  it('filters to the window but reports the observed range of the whole feed', () => {
    const r = parse('google-basic')
    expect(r.events.map((e) => e.externalId)).toEqual(['1a2b3c@google.com'])
    expect(r.window.from?.toISOString()).toBe('2026-07-01T01:00:00.000Z')
    expect(r.window.to?.toISOString()).toBe('2027-03-01T01:00:00.000Z')
    expect(r.complete).toBe(true)
  })
  it('drops only the malformed events and marks the fetch incomplete', () => {
    const r = parse('malformed-line')
    expect(r.events.map((e) => e.externalId)).toEqual(['good-1@example.org', 'bad-2@example.org', 'good-2@example.org'])
    expect(r.dropped).toBe(2)
    expect(r.complete).toBe(false)
    expect(r.events[1]!.end).toBeUndefined()
  })
  it('preclean unfolds and drops non-content lines', () => {
    expect(preclean('BEGIN:VCALENDAR\r\nDESCRIPTION:a\r\n b\r\nnonsense\r\nEND:VCALENDAR\r\n')).toBe('BEGIN:VCALENDAR\r\nDESCRIPTION:ab\r\nEND:VCALENDAR\r\n')
  })
  it('an empty or non-calendar body yields no events, not a throw', () => {
    expect(parseIcs('', OPTS).events).toEqual([])
    expect(parseIcs('<html>nope</html>', OPTS).events).toEqual([])
  })
  it('a feed with an open-ended RRULE extends the observed window to the requested horizon', () => {
    const r = parse('icloud')
    expect(r.window.to!.getTime()).toBeGreaterThanOrEqual(WINDOW.to.getTime())
  })
})
