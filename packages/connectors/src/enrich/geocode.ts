/**
 * Geocoding through a self-hosted Photon (architecture §11). Public Nominatim forbids
 * this use, so with no Photon configured we answer `undefined` and the event ships
 * without coordinates. Callers cache by normalized address.
 */
import type { HttpClient } from '@tributary/ssrf-fetch'

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
  properties?: { osm_key?: string; osm_value?: string; type?: string; housenumber?: string; street?: string; city?: string; state?: string; postcode?: string; countrycode?: string }
}

export function normalizeAddress(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').replace(/[.,]+/g, ',').replace(/,\s*,/g, ',').trim()
}

export async function geocode(
  address: string,
  opts: { photonUrl?: string; http: HttpClient; bias?: { lat: number; lon: number } },
): Promise<GeocodeResult | undefined> {
  if (!opts.photonUrl || !address.trim()) return undefined
  const url = new URL('/api', opts.photonUrl)
  url.searchParams.set('q', address.trim())
  url.searchParams.set('limit', '1')
  if (opts.bias) {
    url.searchParams.set('lat', String(opts.bias.lat))
    url.searchParams.set('lon', String(opts.bias.lon))
  }
  let json: { features?: PhotonFeature[] }
  try {
    const res = await opts.http.get(url.toString(), { headers: { accept: 'application/json' }, timeoutMs: 8000, allowPrivate: true })
    if (res.status !== 200) return undefined
    json = JSON.parse(res.text()) as { features?: PhotonFeature[] }
  } catch {
    return undefined
  }
  const f = json.features?.[0]
  const coords = f?.geometry?.coordinates
  if (!f || !coords) return undefined
  const p = f.properties ?? {}
  const precision: GeocodeResult['precision'] = p.housenumber || p.type === 'house' || p.osm_key === 'amenity' || p.osm_key === 'building' || p.osm_key === 'tourism' || p.osm_key === 'leisure' ? 'exact' : 'city'
  return {
    lat: coords[1],
    lon: coords[0],
    precision,
    locality: p.city,
    region: p.state,
    postalCode: p.postcode,
    country: p.countrycode?.toUpperCase(),
  }
}
