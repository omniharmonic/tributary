import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import { bucketFor, windowFor, type Bucket } from './dates'

const TZ = 'America/Denver'
const BUCKETS: Bucket[] = ['tonight', 'weekend', 'week', 'later']

/** fromISO can return an invalid DateTime; narrow it so the helpers take it. */
function at(iso: string): DateTime<true> {
  const d = DateTime.fromISO(iso, { zone: TZ })
  if (!d.isValid) throw new Error(`bad date in test: ${iso}`)
  return d
}

describe('windowFor', () => {
  // The page sorts a fetched page into buckets in the browser, so a bucket's server
  // window has to be a superset of what bucketFor will claim. If it is not, the section
  // asks for rows and then throws them away, and a reader sees an empty "Later" while
  // the events sit one page beyond the cap.
  it('contains every instant its own bucket claims', () => {
    for (const anchor of ['2026-09-23T14:00', '2026-09-26T09:00', '2026-09-27T20:00', '2026-09-28T06:00']) {
      const now = at(anchor)
      // Up to the directory's 120-day horizon, which is also the server's default `to`.
      // Past that the window deliberately stops and nothing is claimed for it.
      for (let minutes = 0; minutes < 119 * 24 * 60; minutes += 97) {
        const at = now.plus({ minutes })
        const iso = at.toUTC().toISO()!
        const bucket = bucketFor(iso, TZ, now)
        const w = windowFor(bucket, TZ, now)
        expect(
          iso >= w.from && iso <= w.to,
          `${iso} is bucketed ${bucket} from anchor ${anchor} but falls outside ${w.from}..${w.to}`,
        ).toBe(true)
      }
    }
  })

  it('never returns a backwards window', () => {
    const now = at('2026-09-23T14:00')
    for (const b of BUCKETS) {
      const w = windowFor(b, TZ, now)
      expect(w.from < w.to, `${b} window is backwards`).toBe(true)
    }
  })

  it('keeps an event that started in the last three hours in tonight', () => {
    const now = at('2026-09-23T20:00')
    const startedAnHourAgo = now.minus({ hours: 1 }).toUTC().toISO()!
    const w = windowFor('tonight', TZ, now)
    expect(startedAnHourAgo >= w.from).toBe(true)
  })

  it('stops at the 120-day horizon rather than asking for everything', () => {
    const now = at('2026-09-23T14:00')
    const later = windowFor('later', TZ, now)
    const span = at(later.to).diff(at(later.from), 'days').days
    expect(Math.round(span)).toBe(120)
  })

  it('asks the server for a later window that begins after this week ends', () => {
    const now = at('2026-09-23T14:00')
    const later = windowFor('later', TZ, now)
    const week = windowFor('week', TZ, now)
    expect(later.from >= week.to).toBe(true)
  })
})
