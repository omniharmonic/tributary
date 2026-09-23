/**
 * Place resolution: the gazetteer, the address parser, and the Photon client that sits
 * behind them. The point of these is that a typical Boulder event lands on the map with
 * no operator action, and that a doubtful match lands nowhere rather than somewhere wrong.
 */
import { describe, expect, it } from 'vitest'
import type { HttpClient, SafeResponse } from '@tributary/ssrf-fetch'
import {
  BOULDER_VENUES,
  geocode,
  geocodeBest,
  geocodableQuery,
  geocodeCensus,
  inFrontRange,
  matchVenue,
  normalizeVenueText,
  parseAddressLine,
  type Venue,
} from '../src/enrich/index.js'

/** A Photon stand-in: answers from a list of features, and records every query string. */
function photon(features: unknown[], calls: string[] = []): HttpClient {
  const respond = async (url: string): Promise<SafeResponse> => {
    calls.push(url)
    const body = JSON.stringify({ features })
    return { url, status: 200, headers: {}, body: Buffer.from(body), text: () => body, contentType: 'application/json', notModified: false }
  }
  return { get: respond, head: respond, getPage: respond }
}

const feature = (lat: number, lon: number, props: Record<string, unknown> = {}) => ({ geometry: { coordinates: [lon, lat] }, properties: props })

const OPTS = { photonUrl: 'http://photon:2322', noCensus: true }

describe('the gazetteer', () => {
  it('covers Boulder County at a useful size', () => {
    expect(BOULDER_VENUES.length).toBeGreaterThanOrEqual(150)
    const localities = new Set(BOULDER_VENUES.map((v) => v.locality))
    for (const town of ['Boulder', 'Longmont', 'Louisville', 'Lafayette', 'Lyons', 'Nederland', 'Niwot', 'Erie', 'Superior']) {
      expect(localities, `missing ${town}`).toContain(town)
    }
  })

  it('has well-formed entries with plausible Front Range coordinates', () => {
    for (const v of BOULDER_VENUES) {
      expect(v.name, 'name').toBeTruthy()
      expect(v.street, `${v.name} street`).toBeTruthy()
      expect(v.region, `${v.name} region`).toBe('CO')
      expect(v.country, `${v.name} country`).toBe('US')
      expect(v.postalCode, `${v.name} zip`).toMatch(/^\d{5}$/)
      expect(inFrontRange(v.lat, v.lon), `${v.name} is outside the Front Range`).toBe(true)
      // Four decimals, not fabricated precision.
      expect(String(v.lat).split('.')[1]?.length ?? 0, `${v.name} lat precision`).toBeLessThanOrEqual(4)
      expect(String(v.lon).split('.')[1]?.length ?? 0, `${v.name} lon precision`).toBeLessThanOrEqual(4)
    }
  })

  it('has no duplicate names and no dangerously short aliases', () => {
    const names = BOULDER_VENUES.map((v) => v.name)
    expect(new Set(names).size).toBe(names.length)
    for (const v of BOULDER_VENUES) {
      for (const a of v.aliases) {
        expect(a, `${v.name}: alias "${a}" should be lowercase`).toBe(a.toLowerCase())
        expect(normalizeVenueText(a).length, `${v.name}: alias "${a}" is too short to be safe`).toBeGreaterThanOrEqual(3)
      }
    }
  })
})

describe('normalizeVenueText', () => {
  it('folds case, diacritics, ampersands, punctuation and noise words', () => {
    expect(normalizeVenueText('Trident Booksellers & Cafe')).toBe('trident booksellers and cafe')
    expect(normalizeVenueText('The Dairy Arts Center')).toBe('dairy arts center')
    expect(normalizeVenueText('Café Sulá')).toBe('cafe sula')
    expect(normalizeVenueText('BMoCA, Boulder, CO 80302')).toBe('bmoca boulder')
    expect(normalizeVenueText("Lucky's Market")).toBe('luckys market')
    expect(normalizeVenueText('   ')).toBe('')
  })
})

describe('matchVenue', () => {
  it('matches short forms, "the X", and names buried in a sentence', () => {
    expect(matchVenue('Join us at eTown for music')?.name).toBe('eTown Hall')
    expect(matchVenue('The Dairy, 2590 Walnut')?.name).toBe('Dairy Arts Center')
    expect(matchVenue('Doors at 7 at the Fox Theatre, Boulder')?.name).toBe('Fox Theatre')
    expect(matchVenue('Trident Booksellers & Cafe')?.name).toBe('Trident Booksellers & Cafe')
    expect(matchVenue('trident booksellers and cafe')?.name).toBe('Trident Booksellers & Cafe')
  })

  it('prefers the longest key, so a branch beats the system', () => {
    expect(matchVenue('Boulder Public Library, Main — Canyon Theater')?.name).toBe('Boulder Public Library, Main')
    expect(matchVenue('Reynolds Branch community room')?.name).toBe('Boulder Public Library, George Reynolds Branch')
    expect(matchVenue('Meadows Branch, 4800 Baseline Rd')?.name).toBe('Boulder Public Library, Meadows Branch')
    expect(matchVenue('Upslope Brewing, Lee Hill')?.name).toBe('Upslope Brewing, Lee Hill')
  })

  it('reaches outside the city of Boulder', () => {
    expect(matchVenue('Planet Bluegrass, Lyons')?.locality).toBe('Lyons')
    expect(matchVenue('Dickens Opera House')?.locality).toBe('Longmont')
    expect(matchVenue('The Caribou Room, Nederland')?.locality).toBe('Nederland')
    expect(matchVenue('Louisville Public Library')?.locality).toBe('Louisville')
  })

  it('declines rather than guessing', () => {
    expect(matchVenue('123 Nowhere St')).toBeUndefined()
    expect(matchVenue('')).toBeUndefined()
    expect(matchVenue('   ')).toBeUndefined()
    expect(matchVenue('an ordinary sentence about nothing')).toBeUndefined()
  })

  it('accepts a caller-supplied table', () => {
    const mine: Venue[] = [{ name: 'Test Barn', aliases: ['the barn'], street: '1 Test Rd', locality: 'Hygiene', region: 'CO', postalCode: '80533', country: 'US', lat: 40.18, lon: -105.18 }]
    expect(matchVenue('Potluck at The Barn', mine)?.name).toBe('Test Barn')
    // The caller's table replaces the default; Boulder venues are not consulted.
    expect(matchVenue('eTown Hall', mine)).toBeUndefined()
  })
})

describe('parseAddressLine', () => {
  const cases: Array<[string, ReturnType<typeof parseAddressLine>]> = [
    ['Boulder Public Library, 1001 Arapahoe Ave, Boulder, CO 80302', { venueName: 'Boulder Public Library', street: '1001 Arapahoe Ave', locality: 'Boulder', region: 'CO', postalCode: '80302' }],
    ['1001 Arapahoe Ave Boulder CO', { street: '1001 Arapahoe Ave', locality: 'Boulder', region: 'CO' }],
    ['The Dairy Arts Center • 2590 Walnut St', { venueName: 'The Dairy Arts Center', street: '2590 Walnut St' }],
    ['2590 Walnut St, Boulder', { street: '2590 Walnut St', locality: 'Boulder' }],
    ['1750 13th St', { street: '1750 13th St' }],
    ['1535 Spruce St, Boulder, CO 80302', { street: '1535 Spruce St', locality: 'Boulder', region: 'CO', postalCode: '80302' }],
    ['900 Baseline Rd, Boulder, Colorado 80302', { street: '900 Baseline Rd', locality: 'Boulder', region: 'CO', postalCode: '80302' }],
    ['4600 N Broadway, Boulder, CO', { street: '4600 N Broadway', locality: 'Boulder', region: 'CO' }],
    ['1898 S Flatiron Ct, Boulder', { street: '1898 S Flatiron Ct', locality: 'Boulder' }],
    ['Longmont Museum, 400 Quail Rd, Longmont, CO 80501', { venueName: 'Longmont Museum', street: '400 Quail Rd', locality: 'Longmont', region: 'CO', postalCode: '80501' }],
    ['1001 Arapahoe Ave, Boulder, CO 80302-1234', { street: '1001 Arapahoe Ave', locality: 'Boulder', region: 'CO', postalCode: '80302' }],
    ['Planet Bluegrass, 500 W Main St, Lyons, CO 80540', { venueName: 'Planet Bluegrass', street: '500 W Main St', locality: 'Lyons', region: 'CO', postalCode: '80540' }],
    ['NCAR Mesa Lab, 1850 Table Mesa Dr, Boulder, CO 80305', { venueName: 'NCAR Mesa Lab', street: '1850 Table Mesa Dr', locality: 'Boulder', region: 'CO', postalCode: '80305' }],
    ['123 Main St, Louisville, CO 80027', { street: '123 Main St', locality: 'Louisville', region: 'CO', postalCode: '80027' }],
    ['Boulder, CO', { locality: 'Boulder', region: 'CO' }],
    ['eTown Hall', { venueName: 'eTown Hall' }],
    ['Pearl Street Mall', { venueName: 'Pearl Street Mall' }],
    ['St Julien Hotel, 900 Walnut St, Boulder CO 80302', { venueName: 'St Julien Hotel', street: '900 Walnut St', locality: 'Boulder', region: 'CO', postalCode: '80302' }],
    ['Room 235, UMC, 1669 Euclid Ave, Boulder, CO', { venueName: 'Room 235, UMC', street: '1669 Euclid Ave', locality: 'Boulder', region: 'CO' }],
    ['Chautauqua Park, 900 Baseline Rd', { venueName: 'Chautauqua Park', street: '900 Baseline Rd' }],
  ]
  for (const [input, expected] of cases) {
    it(`parses ${JSON.stringify(input)}`, () => expect(parseAddressLine(input)).toEqual(expected))
  }

  const nonPlaces = ['Online', 'online', 'ONLINE', 'Zoom', 'TBA', 'TBD', 'Various locations', 'Virtual Event', 'To be announced', 'See description', 'N/A', '', '   ', '1234', '—']
  for (const input of nonPlaces) {
    it(`declines ${JSON.stringify(input)}`, () => expect(parseAddressLine(input)).toBeUndefined())
  }

  it('is not fooled by "online" inside a real address', () => {
    const p = parseAddressLine('Online and in person at 1535 Spruce St, Boulder')
    expect(p?.street).toBe('1535 Spruce St')
    expect(p?.locality).toBe('Boulder')
  })

  it('builds a street-first geocoder query', () => {
    const p = parseAddressLine('Boulder Public Library, 1001 Arapahoe Ave, Boulder, CO 80302')!
    expect(geocodableQuery(p)).toBe('1001 Arapahoe Ave, Boulder, CO 80302')
    expect(geocodableQuery({ venueName: 'eTown Hall' })).toBeUndefined()
  })
})

describe('inFrontRange', () => {
  it('accepts the county and rejects everywhere else', () => {
    expect(inFrontRange(40.0139, -105.2816)).toBe(true)
    expect(inFrontRange(40.1512, -105.1037)).toBe(true)
    expect(inFrontRange(39.7392, -104.9903)).toBe(true) // Denver
    expect(inFrontRange(38.8339, -104.8214)).toBe(false) // Colorado Springs
    expect(inFrontRange(41.878, -87.6298)).toBe(false) // Chicago
    expect(inFrontRange(Number.NaN, -105.2)).toBe(false)
  })
})

describe('geocode', () => {
  it('biases to Boulder and bounds every query', async () => {
    const calls: string[] = []
    const http = photon([feature(40.0139, -105.2816, { housenumber: '1001', street: 'Arapahoe Ave', city: 'Boulder' })], calls)
    await geocode('1001 Arapahoe Ave', { http, ...OPTS })
    expect(calls[0]).toContain('lat=40.015')
    expect(calls[0]).toContain('lon=-105.27')
    expect(calls[0]).toContain('bbox=')
  })

  it('rejects a hit outside the Front Range', async () => {
    const http = photon([feature(41.878, -87.6298, { housenumber: '100', street: 'Main St', city: 'Chicago' })])
    expect(await geocode('100 Main St', { http, ...OPTS })).toBeUndefined()
  })

  it('prefers a house-level hit over a city centroid that ranked first', async () => {
    const http = photon([
      feature(40.015, -105.27, { osm_key: 'place', osm_value: 'city', name: 'Boulder', city: 'Boulder' }),
      feature(40.0206, -105.2599, { housenumber: '2590', street: 'Walnut St', city: 'Boulder' }),
    ])
    const r = await geocode('2590 Walnut St', { http, ...OPTS })
    expect(r).toMatchObject({ lat: 40.0206, precision: 'exact' })
  })

  it('reports a locality hit as city precision', async () => {
    const http = photon([feature(40.015, -105.27, { osm_key: 'place', osm_value: 'city', name: 'Boulder', city: 'Boulder' })])
    expect((await geocode('Boulder', { http, ...OPTS }))?.precision).toBe('city')
  })

  it('treats a named amenity as exact', async () => {
    const http = photon([feature(40.0195, -105.2774, { osm_key: 'amenity', osm_value: 'theatre', name: 'eTown Hall', city: 'Boulder' })])
    expect((await geocode('eTown Hall', { http, ...OPTS }))?.precision).toBe('exact')
  })

  it('never throws: no Photon, a bad URL, a transport failure, or nonsense back', async () => {
    const ok = photon([])
    expect(await geocode('anywhere', { http: ok })).toBeUndefined()
    expect(await geocode('anywhere', { http: ok, photonUrl: 'not a url' })).toBeUndefined()
    expect(await geocode('   ', { http: ok, ...OPTS })).toBeUndefined()
    const boom: HttpClient = { get: async () => { throw new Error('connection refused') }, head: async () => { throw new Error('x') }, getPage: async () => { throw new Error('x') } }
    expect(await geocode('1001 Arapahoe Ave', { http: boom, ...OPTS })).toBeUndefined()
    const junk: HttpClient = { ...ok, get: async (u: string) => ({ url: u, status: 200, headers: {}, body: Buffer.from('<html>'), text: () => '<html>', contentType: 'text/html', notModified: false }) }
    expect(await geocode('1001 Arapahoe Ave', { http: junk, ...OPTS })).toBeUndefined()
  })
})

describe('geocodeBest', () => {
  it('answers from the gazetteer without touching the network', async () => {
    const calls: string[] = []
    const http = photon([], calls)
    const best = await geocodeBest('The Dairy Arts Center, 2590 Walnut St, Boulder, CO', { http, ...OPTS })
    expect(best).toMatchObject({ via: 'venue', result: { lat: 40.0206, lon: -105.2599, precision: 'exact', locality: 'Boulder' } })
    expect(best?.venue?.name).toBe('Dairy Arts Center')
    expect(calls).toHaveLength(0)
  })

  it('reports an area venue at city precision', async () => {
    const best = await geocodeBest('Chautauqua Park', { http: photon([]), ...OPTS })
    expect(best).toMatchObject({ via: 'venue', result: { precision: 'city' } })
  })

  it('falls through to the parsed street address', async () => {
    const calls: string[] = []
    const http = photon([feature(40.0221, -105.2745, { housenumber: '1234', street: 'Pine St', city: 'Boulder', postcode: '80302' })], calls)
    const best = await geocodeBest('Some Unknown Hall, 1234 Pine St, Boulder, CO 80302', { http, ...OPTS })
    expect(best?.via).toBe('address')
    expect(best?.result).toMatchObject({ lat: 40.0221, precision: 'exact', locality: 'Boulder' })
    // The street, not the venue name, is what went to Photon.
    expect(new URL(calls[0]!).searchParams.get('q')).toBe('1234 Pine St, Boulder, CO 80302')
  })

  it('falls back to the raw string when the street is unknown', async () => {
    let n = 0
    const respond = async (url: string): Promise<SafeResponse> => {
      n++
      const body = JSON.stringify({ features: n === 1 ? [] : [feature(40.03, -105.25, { osm_key: 'amenity', name: 'Some Unknown Hall', city: 'Boulder' })] })
      return { url, status: 200, headers: {}, body: Buffer.from(body), text: () => body, contentType: 'application/json', notModified: false }
    }
    const http: HttpClient = { get: respond, head: respond, getPage: respond }
    const best = await geocodeBest('Some Unknown Hall, 9999 Nowhere Ave, Boulder', { http, ...OPTS })
    expect(best?.via).toBe('raw')
    expect(n).toBe(2)
  })

  it('declines for a placeholder or an empty string, without a request', async () => {
    const calls: string[] = []
    const http = photon([feature(40.015, -105.27, {})], calls)
    expect(await geocodeBest('Online', { http, ...OPTS })).toBeUndefined()
    expect(await geocodeBest('TBD', { http, ...OPTS })).toBeUndefined()
    expect(await geocodeBest('', { http, ...OPTS })).toBeUndefined()
    expect(calls).toHaveLength(0)
  })

  it('answers from the gazetteer even with no Photon configured', async () => {
    const best = await geocodeBest('eTown Hall', { http: photon([]) })
    expect(best).toMatchObject({ via: 'venue', result: { lat: 40.0195, lon: -105.2774 } })
  })
})

describe('the US Census geocoder', () => {
  const body = {
    result: {
      addressMatches: [
        { matchedAddress: '2590 WALNUT ST, BOULDER, CO, 80302', coordinates: { x: -105.260848, y: 40.019995 }, addressComponents: { city: 'BOULDER', state: 'CO', zip: '80302' } },
      ],
    },
  }
  const http = (json: unknown, status = 200) =>
    ({
      get: async () => {
        const text = JSON.stringify(json)
        return { url: 'x', status, headers: {}, body: Buffer.from(text), text: () => text, contentType: 'application/json', notModified: false }
      },
      head: async () => { throw new Error('no') },
      getPage: async () => { throw new Error('no') },
    }) as never

  it('returns a house-level result with a title-cased locality', async () => {
    const r = await geocodeCensus('2590 Walnut St, Boulder, CO', { http: http(body) })
    expect(r).toMatchObject({ lat: 40.019995, lon: -105.260848, precision: 'exact', locality: 'Boulder', region: 'CO', postalCode: '80302', country: 'US' })
  })
  it('rejects a match outside the Front Range', async () => {
    const far = { result: { addressMatches: [{ coordinates: { x: -74.006, y: 40.7128 } }] } }
    expect(await geocodeCensus('350 5th Ave, New York, NY', { http: http(far) })).toBeUndefined()
  })
  it('is quiet about an empty answer or a bad status', async () => {
    expect(await geocodeCensus('nowhere', { http: http({ result: { addressMatches: [] } }) })).toBeUndefined()
    expect(await geocodeCensus('x', { http: http({}, 500) })).toBeUndefined()
    expect(await geocodeCensus('', { http: http(body) })).toBeUndefined()
  })
  it('geocodeBest uses it before Photon and reports via address', async () => {
    const r = await geocodeBest('2590 Walnut St, Boulder, CO 80302', { http: http(body) })
    expect(r?.via).toBe('address')
    expect(r?.result.precision).toBe('exact')
  })
})
