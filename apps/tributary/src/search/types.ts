/**
 * Search contracts. One document per published public event.
 *
 * The index is a PUBLIC surface: a search-only key is handed to browsers, so anything
 * in a document is readable by anyone. That is why `document.ts` refuses to build a
 * document for a permissioned event, and why a gated event's exact coordinates never
 * become `_geo` (F27, architecture §15: permissioned data never enters a public store).
 */

/** What we store in Meilisearch. Nothing here may be private to a viewer. */
export interface EventDoc {
  /** The ledger row id; also the Meilisearch primary key. */
  id: string
  name: string
  /** Plain text, markdown stripped, trimmed. */
  description: string
  /** The card's place label. Coarse for gated events, by construction. */
  place: string
  locality: string
  hostHandle: string
  hostName: string
  platform: string
  category: string
  tags: string[]
  region: string
  /** Seconds since the epoch: filterable and sortable. */
  startsAtUnix: number
  endsAtUnix: number | null
  visibility: string
  state: string
  /** Present only for a public event with an exact, non-private location. */
  _geo?: { lat: number; lng: number }
  did: string
  rkey: string | null
}

/** The ledger row fields search needs. Structural, so a drizzle row satisfies it. */
export interface IndexableRow {
  id: string
  normalized: unknown
  state: string
  visibility: string
  startsAt: Date
  endsAt: Date | null
  atUri: string | null
  imageHash: string | null
}

/** The host fields search needs. */
export interface IndexableHost {
  did: string
  handle: string
  displayName: string
  region: string
}

export interface SearchQuery {
  q?: string
  region?: string
  category?: string
  from?: Date
  to?: Date
  near?: { lat: number; lon: number }
  radiusKm?: number
  limit?: number
  /** An opaque offset. */
  cursor?: string
}

export interface SearchHit {
  id: string
  score: number
}

export interface SearchResult {
  hits: SearchHit[]
  total: number
  /** False when search is not configured or unreachable: the caller falls back to Postgres. */
  available: boolean
  cursor: string | null
}

export const UNAVAILABLE: SearchResult = { hits: [], total: 0, available: false, cursor: null }

/** The interface both backends implement. */
export interface SearchIndex {
  /** Create the index and apply settings. Idempotent; safe to call at every boot. */
  configure(): Promise<void>
  upsert(docs: EventDoc[]): Promise<void>
  remove(ids: string[]): Promise<void>
  search(query: SearchQuery): Promise<SearchResult>
  /** Is the backend configured and answering? */
  ready(): Promise<boolean>
}

/* ── the slice of the meilisearch client we use ──────────────────────────────
 * Declared structurally so this module compiles whether or not the package is
 * installed. `meili.ts` loads the real client through a dynamic import and casts
 * to these; a missing package simply means search is unavailable.
 */

export interface RawSearchResponse {
  hits: Array<Record<string, unknown>>
  estimatedTotalHits?: number
  totalHits?: number
  offset?: number
  limit?: number
}

export interface RawIndex {
  addDocuments(docs: Record<string, unknown>[], opts?: { primaryKey?: string }): Promise<unknown>
  deleteDocuments(ids: string[]): Promise<unknown>
  updateSettings(settings: Record<string, unknown>): Promise<unknown>
  search(q: string | null, params?: Record<string, unknown>): Promise<RawSearchResponse>
}

export interface RawClient {
  index(uid: string): RawIndex
  createIndex(uid: string, opts?: { primaryKey?: string }): Promise<unknown>
  health(): Promise<{ status?: string }>
}
