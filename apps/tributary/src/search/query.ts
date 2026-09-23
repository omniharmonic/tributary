/**
 * Query building. Filters are belt and braces: the index only ever holds public and
 * gated live events, and every query asserts that again, so a bug in the indexing
 * path cannot become a leak in the reading path.
 */
import { INDEXED_STATE, INDEXED_VISIBILITY } from './document.js'
import type { SearchQuery } from './types.js'

export const DEFAULT_LIMIT = 200
export const MAX_LIMIT = 500
/** Events that started up to three hours ago are still "on now". */
export const LOOKBACK_MS = 3 * 3_600_000
const DEFAULT_RADIUS_KM = 25

/** Quote a filter value. Meilisearch strings are double-quoted with backslash escapes. */
export function quote(v: string): string {
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

const list = (vs: Iterable<string>) => [...vs].map(quote).join(', ')

export function buildFilters(query: SearchQuery, now = new Date()): string[] {
  const from = query.from ?? new Date(now.getTime() - LOOKBACK_MS)
  const filters: string[] = [
    `visibility IN [${list(INDEXED_VISIBILITY)}]`,
    `state IN [${list(INDEXED_STATE)}]`,
    `startsAtUnix >= ${Math.floor(from.getTime() / 1000)}`,
  ]
  if (query.to) filters.push(`startsAtUnix <= ${Math.floor(query.to.getTime() / 1000)}`)
  if (query.region) filters.push(`region = ${quote(query.region)}`)
  // A category chip matches the assigned category or any source tag.
  if (query.category) filters.push(`(category = ${quote(query.category)} OR tags = ${quote(query.category)})`)
  if (query.near) {
    const metres = Math.round((query.radiusKm ?? DEFAULT_RADIUS_KM) * 1000)
    filters.push(`_geoRadius(${query.near.lat}, ${query.near.lon}, ${metres})`)
  }
  return filters
}

export function buildSearchParams(query: SearchQuery, now = new Date()): Record<string, unknown> {
  const limit = Math.min(Math.max(Number(query.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
  const offset = Number.isFinite(Number(query.cursor)) ? Math.max(Number(query.cursor), 0) : 0
  const hasQuery = !!query.q?.trim()
  return {
    filter: buildFilters(query, now),
    limit,
    offset,
    // Browsing is chronological; searching is by relevance, with the trailing
    // `startsAtUnix:asc` ranking rule breaking ties towards the soonest event.
    sort: hasQuery ? undefined : ['startsAtUnix:asc'],
    attributesToRetrieve: ['id'],
    showRankingScore: hasQuery,
  }
}

/**
 * `near=lat,lon` from a query string. Returns undefined for anything that is not a
 * usable pair of degrees, so a malformed value browses normally instead of 500ing or,
 * worse, being passed through to `_geoRadius` as NaN and quietly matching nothing.
 */
export function parseNear(raw: string | undefined): { lat: number; lon: number } | undefined {
  if (!raw) return undefined
  const parts = raw.split(',')
  if (parts.length !== 2) return undefined
  // Number('') is 0, not NaN, so an empty half would silently become the Gulf of Guinea
  // and the visitor would be told there is nothing near them.
  const [rawLat, rawLon] = parts.map((x) => x.trim())
  if (!rawLat || !rawLon) return undefined
  const lat = Number(rawLat)
  const lon = Number(rawLon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return undefined
  return { lat, lon }
}
