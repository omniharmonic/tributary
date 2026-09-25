/**
 * A coordinate from outside the region is a placeholder, not a place.
 *
 * One Squarespace calendar shipped 40.7207559, -74.0007613 — Squarespace's own address
 * in lower Manhattan — on every event, for venues that are all in Boulder. Twenty-six
 * listings pinned to New York, and a map that zoomed out to the United States.
 */
import { describe, expect, it } from 'vitest'
import { dropStrayPin } from '../src/pipeline/enrich.js'
import type { NormalizedEvent } from '@tributary/event-model'

const SQUARESPACE_DEFAULT = { lat: 40.7207559, lon: -74.0007613 }
const CHAUTAUQUA = { lat: 40.0004, lon: -105.2815 }

function ev(location: Record<string, unknown> | null): NormalizedEvent {
  return {
    identity: { sourceId: 's', externalId: 'e1' },
    name: 'Water seminar',
    start: { instant: '2026-10-04T16:00:00.000Z', tz: 'America/Denver', allDay: false, tzInferred: false },
    status: 'scheduled',
    mode: 'inperson',
    locations: location ? [location] : [],
    links: [],
    tags: [],
    sourceUrl: 'https://example.org/x',
    visibility: 'public',
    contentHash: 'h',
    provenance: { platform: 'squarespace', method: 'jsonld-page', fetchedAt: '2026-09-25T00:00:00.000Z' },
  } as unknown as NormalizedEvent
}

describe('dropStrayPin', () => {
  it('removes a pin that cannot be in this region, and keeps every word', () => {
    const out = dropStrayPin(ev({ name: 'Unitarian Universalist Church of Boulder', locality: 'Boulder', region: 'CO', precision: 'exact', private: false, ...SQUARESPACE_DEFAULT }))
    const l = out.locations[0]!
    expect(l.lat).toBeUndefined()
    expect(l.lon).toBeUndefined()
    expect(l.name).toBe('Unitarian Universalist Church of Boulder')
    expect(l.locality).toBe('Boulder')
    expect(l.region).toBe('CO')
  })

  it('leaves a real local pin exactly as it found it', () => {
    const before = ev({ name: 'Chautauqua', precision: 'exact', private: false, ...CHAUTAUQUA })
    expect(dropStrayPin(before)).toBe(before)
  })

  it('does nothing when there is no pin to drop', () => {
    const noCoords = ev({ name: 'Community Room', precision: 'exact', private: false })
    expect(dropStrayPin(noCoords)).toBe(noCoords)
    const noPlace = ev(null)
    expect(dropStrayPin(noPlace)).toBe(noPlace)
  })
})
