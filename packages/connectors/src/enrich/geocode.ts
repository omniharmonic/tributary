/**
 * Geocoding through a self-hosted Photon (architecture §11). Public Nominatim forbids
 * this use, so with no Photon configured we answer `undefined` and fall back to the
 * gazetteer. Callers cache by normalized address.
 *
 * Two rules keep the pins honest. Every query is biased to Boulder and every answer is
 * rejected unless it lands inside the Front Range box, because a bare street name like
 * "Main St" matches a thousand places and a wrong pin is worse than no pin. And a hit
 * that is only a locality is reported as `precision: 'city'` so callers can decline to
 * put it on the map.
 */
import type { HttpClient } from '@tributary/ssrf-fetch'
import { geocodableQuery, parseAddressLine } from './address.js'
import { matchVenue, type Venue } from './venues.js'

export interface GeocodeResult {
  lat: number
  lon: number
  precision: 'exact' | 'city'
  /** Photon's normalized pieces, when it gave them. */
  locality?: string
  region?: string
  postalCode?: string
  country?: string
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] }
  properties?: {
    osm_key?: string
    osm_value?: string
    type?: string
    name?: string
    housenumber?: string
    street?: string
    city?: string
    state?: string
    postcode?: string
    countrycode?: string
  }
}

/** Boulder, roughly the Pearl and Broadway corner. Every query is biased here. */
export const BOULDER_BIAS = { lat: 40.015, lon: -105.27 } as const

/**
 * The Front Range box: Eldorado Springs and Denver in the south, the Wyoming-ward end
 * of Larimer in the north, the Divide in the west, the plains in the east. Anything
 * outside is a different Main Street.
 */
export const FRONT_RANGE_BBOX = { minLat: 39.5, maxLat: 40.4, minLon: -105.8, maxLon: -104.8 } as const

export function inFrontRange(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= FRONT_RANGE_BBOX.minLat &&
    lat <= FRONT_RANGE_BBOX.maxLat &&
    lon >= FRONT_RANGE_BBOX.minLon &&
    lon <= FRONT_RANGE_BBOX.maxLon
  )
}

export function normalizeAddress(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').replace(/[.,]+/g, ',').replace(/,\s*,/g, ',').trim()
}

/** `place` results are administrative areas; everything else is a thing at an address. */
const LOCALITY_KEYS = new Set(['place', 'boundary'])
const LOCALITY_VALUES = new Set(['city', 'town', 'village', 'hamlet', 'suburb', 'neighbourhood', 'quarter', 'county', 'state', 'administrative', 'locality'])

function precisionOf(p: NonNullable<PhotonFeature['properties']>): GeocodeResult['precision'] {
  if (p.housenumber || p.type === 'house') return 'exact'
  if (p.osm_key && LOCALITY_KEYS.has(p.osm_key)) return 'city'
  if (p.osm_value && LOCALITY_VALUES.has(p.osm_value)) return 'city'
  if (p.type === 'city' || p.type === 'locality' || p.type === 'county' || p.type === 'state') return 'city'
  // A named amenity, building, leisure or tourism feature is a real place on the map.
  if (p.osm_key === 'amenity' || p.osm_key === 'building' || p.osm_key === 'tourism' || p.osm_key === 'leisure' || p.osm_key === 'shop' || p.osm_key === 'office') return 'exact'
  if (p.street) return 'exact'
  return 'city'
}

function toResult(f: PhotonFeature): GeocodeResult | undefined {
  const coords = f.geometry?.coordinates
  if (!coords || coords.length < 2) return undefined
  const [lon, lat] = coords
  if (typeof lat !== 'number' || typeof lon !== 'number' || !inFrontRange(lat, lon)) return undefined
  const p = f.properties ?? {}
  return {
    lat,
    lon,
    precision: precisionOf(p),
    locality: p.city,
    region: p.state,
    postalCode: p.postcode,
    country: p.countrycode?.toUpperCase(),
  }
}

export interface GeocodeOptions {
  photonUrl?: string
  http: HttpClient
  bias?: { lat: number; lon: number }
}

/** One Photon query. Never throws; `undefined` covers "no Photon", "no hit" and "out of area". */
export async function geocode(address: string, opts: GeocodeOptions): Promise<GeocodeResult | undefined> {
  if (!opts.photonUrl || !address.trim()) return undefined
  const bias = opts.bias ?? BOULDER_BIAS
  let url: URL
  try {
    url = new URL('/api', opts.photonUrl)
  } catch {
    return undefined
  }
  url.searchParams.set('q', address.trim())
  // More than one, so a result outside the box can be skipped rather than lost.
  url.searchParams.set('limit', '5')
  url.searchParams.set('lat', String(bias.lat))
  url.searchParams.set('lon', String(bias.lon))
  url.searchParams.set('bbox', `${FRONT_RANGE_BBOX.minLon},${FRONT_RANGE_BBOX.minLat},${FRONT_RANGE_BBOX.maxLon},${FRONT_RANGE_BBOX.maxLat}`)
  let json: { features?: PhotonFeature[] }
  try {
    const res = await opts.http.get(url.toString(), { headers: { accept: 'application/json' }, timeoutMs: 8000, allowPrivate: true })
    if (res.status !== 200) return undefined
    json = JSON.parse(res.text()) as { features?: PhotonFeature[] }
  } catch {
    return undefined
  }
  const hits = (json.features ?? []).map(toResult).filter((r): r is GeocodeResult => !!r)
  // Prefer a house-level hit over a city centroid even when the city comes back first.
  return hits.find((r) => r.precision === 'exact') ?? hits[0]
}

export interface BestGeocode {
  result: GeocodeResult
  via: 'venue' | 'address' | 'raw'
  /** Set when the gazetteer answered, so callers can adopt the canonical name. */
  venue?: Venue
}

function fromVenue(v: Venue): GeocodeResult {
  return {
    lat: v.lat,
    lon: v.lon,
    precision: v.precision === 'area' ? 'city' : 'exact',
    locality: v.locality,
    region: v.region,
    postalCode: v.postalCode,
    country: v.country,
  }
}

/**
 * Resolve a free-text location the way the pipeline should: the curated gazetteer
 * first because it is free and exact, then the parsed street address, then the raw
 * text. `undefined` when nothing trustworthy comes back.
 */
export async function geocodeBest(text: string | undefined | null, opts: GeocodeOptions): Promise<BestGeocode | undefined> {
  const raw = (text ?? '').trim()
  if (!raw) return undefined

  const venue = matchVenue(raw)
  if (venue) return { result: fromVenue(venue), via: 'venue', venue }

  const parsed = parseAddressLine(raw)
  const query = parsed ? geocodableQuery(parsed) : undefined
  if (query) {
    const hit = await geocode(query, opts)
    if (hit) return { result: { ...hit, locality: hit.locality ?? parsed?.locality, region: hit.region ?? parsed?.region, postalCode: hit.postalCode ?? parsed?.postalCode }, via: 'address' }
  }
  // Nothing parseable, or Photon did not know the street: try the whole string.
  if (parsed) {
    const hit = await geocode(raw, opts)
    if (hit) return { result: hit, via: 'raw' }
  }
  return undefined
}
