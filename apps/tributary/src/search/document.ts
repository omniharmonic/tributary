/**
 * Ledger row → search document, and the one rule that matters: what may be indexed.
 *
 * The index is public. Only `public` and `gated` events at `live` or `cancelled` ever
 * enter it, and a gated event enters as its teaser: the coarse place label and no
 * coordinates. `unlisted` is excluded too — it is public data, but its whole point is
 * to stay out of discovery and search (PRD §8.1).
 */
import { excerpt, placeLabel, type NormalizedEvent } from '@tributary/event-model'
import type { EventDoc, IndexableHost, IndexableRow } from './types.js'

/** Visibility levels that may appear in the index. */
export const INDEXED_VISIBILITY = new Set(['public', 'gated'])
/** Ledger states that may appear in the index. */
export const INDEXED_STATE = new Set(['live', 'cancelled'])

/** Meilisearch primary keys are `[a-zA-Z0-9_-]`; our `ev_…` ids already are. */
const SAFE_ID = /^[A-Za-z0-9_-]+$/

/**
 * The privacy gate. Everything else in this module assumes it returned true.
 * Changing it is changing what the world can see, so it is deliberately one function.
 */
export function isIndexable(row: Pick<IndexableRow, 'id' | 'visibility' | 'state'>): boolean {
  if (!SAFE_ID.test(row.id)) return false
  if (!INDEXED_VISIBILITY.has(row.visibility)) return false
  if (!INDEXED_STATE.has(row.state)) return false
  return true
}

/**
 * Coordinates, but only when publishing them is already the host's choice: a public
 * event with an exact, non-private location. A gated event's pin is the thing the Gate
 * exists to protect, and `_geoRadius` with a small radius would hand it to anyone.
 */
function geoFor(n: NormalizedEvent, coarse: boolean): { lat: number; lng: number } | undefined {
  if (coarse || n.visibility !== 'public') return undefined
  const l = n.locations[0]
  if (!l || l.private || l.precision !== 'exact') return undefined
  if (typeof l.lat !== 'number' || typeof l.lon !== 'number') return undefined
  if (!Number.isFinite(l.lat) || !Number.isFinite(l.lon)) return undefined
  if (Math.abs(l.lat) > 90 || Math.abs(l.lon) > 180) return undefined
  return { lat: l.lat, lng: l.lon }
}

const DESCRIPTION_MAX = 2000

export function toEventDoc(row: IndexableRow, h: IndexableHost): EventDoc | null {
  if (!isIndexable(row)) return null
  const n = row.normalized as NormalizedEvent
  if (!n || typeof n !== 'object' || typeof n.name !== 'string') return null

  const { label, coarse } = placeLabel(n)
  const locality = n.locations[0]?.locality ?? ''

  return {
    id: row.id,
    name: n.name,
    description: excerpt(n.descriptionMd, DESCRIPTION_MAX) ?? '',
    place: label ?? '',
    locality,
    hostHandle: h.handle,
    hostName: h.displayName || h.handle,
    platform: n.provenance?.platform ?? '',
    category: n.category ?? '',
    tags: Array.isArray(n.tags) ? n.tags : [],
    region: h.region,
    startsAtUnix: Math.floor(row.startsAt.getTime() / 1000),
    endsAtUnix: row.endsAt ? Math.floor(row.endsAt.getTime() / 1000) : null,
    visibility: row.visibility,
    state: row.state,
    ...(geoFor(n, coarse) ? { _geo: geoFor(n, coarse)! } : {}),
    did: h.did,
    rkey: row.atUri?.split('/').pop() ?? null,
  }
}
