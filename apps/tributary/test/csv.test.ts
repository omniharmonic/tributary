import { describe, expect, it } from 'vitest'
import { guessMapping, parseCsv, parseDateTime, rowsToRawEvents } from '../src/lib/csv.js'

const sample = `Title,Date,Start Time,End Time,Venue,Details,Link,Cost
Seed Swap,10/4/2026,10:00 AM,1:00 PM,Boulder Public Library,Bring seeds,https://x.org/seed,Free
Bad Row,,,,,,,
All Day Fair,2026-10-11,,,Central Park,,https://x.org/fair,$5
`

describe('csv', () => {
  it('guesses a mapping from headers', () => {
    const m = guessMapping(parseCsv(sample).headers)
    expect(m).toMatchObject({ name: 'Title', start: 'Date', startTime: 'Start Time', endTime: 'End Time', location: 'Venue', description: 'Details', url: 'Link', price: 'Cost' })
  })
  it('parses dates in common formats in the region zone', () => {
    expect(parseDateTime('10/4/2026', '10:00 AM', 'America/Denver')?.iso).toBe('2026-10-04T10:00:00.000-06:00')
    expect(parseDateTime('2026-10-11', undefined, 'America/Denver')).toEqual({ iso: '2026-10-11', allDay: true })
    expect(parseDateTime('October 4, 2026', '7 pm', 'America/Denver')?.iso).toBe('2026-10-04T19:00:00.000-06:00')
    expect(parseDateTime('nonsense', undefined, 'America/Denver')).toBeNull()
  })
  it('turns rows into raw events, dropping the unreadable ones', () => {
    const parsed = parseCsv(sample)
    const out = rowsToRawEvents(parsed, guessMapping(parsed.headers), 'America/Denver', 'h')
    expect(out.events).toHaveLength(2)
    expect(out.dropped).toBe(1)
    expect(out.events[0]).toMatchObject({ name: 'Seed Swap', location: 'Boulder Public Library', url: 'https://x.org/seed', priceText: 'Free', allDay: false })
    expect(out.events[0]!.end).toBe('2026-10-04T13:00:00.000-06:00')
    expect(out.events[1]).toMatchObject({ name: 'All Day Fair', allDay: true })
    // Stable ids across re-uploads of the same file.
    const again = rowsToRawEvents(parsed, guessMapping(parsed.headers), 'America/Denver', 'h')
    expect(again.events[0]!.externalId).toBe(out.events[0]!.externalId)
  })
})
