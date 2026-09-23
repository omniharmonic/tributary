/**
 * Search: a Meilisearch index over published public events, with a null backend so
 * every caller works unchanged when search is not configured.
 *
 * Configuration comes from the environment. `MEILI_URL` is what switches it on:
 *
 *   MEILI_URL          http://meili:7700   (empty = search off, Postgres path used)
 *   MEILI_MASTER_KEY   the admin key the API writes with
 *   MEILI_INDEX        index name, default `tb_events`
 *
 * Nothing here ever throws at its caller. Indexing is a side effect of publishing; a
 * search outage must never fail a publish, and a stale index is recoverable by
 * `reindexAll()`.
 */
import { and, asc, eq, gt } from 'drizzle-orm'
import { getDb } from '../db/index.js'
import { host as hostTable, sourceEvent } from '../db/schema.js'
import { describeError, log } from '../lib/logging.js'
import { isIndexable, toEventDoc } from './document.js'
import { loadMeiliClient, MeiliSearchIndex } from './meili.js'
import { INDEX_UID } from './settings.js'
import { UNAVAILABLE, type EventDoc, type IndexableHost, type IndexableRow, type SearchIndex, type SearchQuery, type SearchResult } from './types.js'

export * from './types.js'
export { isIndexable, toEventDoc, INDEXED_STATE, INDEXED_VISIBILITY } from './document.js'
export { buildFilters, buildSearchParams, quote } from './query.js'
export { indexSettings, INDEX_UID, PRIMARY_KEY, SYNONYMS } from './settings.js'
export { MeiliSearchIndex, loadMeiliClient } from './meili.js'

/** The backend used when search is not configured: every call is a no-op. */
export class NullSearchIndex implements SearchIndex {
  async configure(): Promise<void> {}
  async upsert(): Promise<void> {}
  async remove(): Promise<void> {}
  async search(): Promise<SearchResult> {
    return UNAVAILABLE
  }
  async ready(): Promise<boolean> {
    return false
  }
}

export interface SearchOptions {
  url?: string
  apiKey?: string
  index?: string
}

function fromEnv(): Required<SearchOptions> {
  return {
    url: (process.env.MEILI_URL ?? '').trim(),
    apiKey: (process.env.MEILI_MASTER_KEY ?? '').trim(),
    index: (process.env.MEILI_INDEX ?? INDEX_UID).trim() || INDEX_UID,
  }
}

let cached: Promise<SearchIndex> | undefined

/** The configured backend, memoized. `NullSearchIndex` whenever search is off. */
export function searchIndex(opts?: SearchOptions): Promise<SearchIndex> {
  if (opts) return build(opts)
  return (cached ??= build(fromEnv()))
}

async function build(opts: SearchOptions): Promise<SearchIndex> {
  const { url, apiKey, index } = { ...fromEnv(), ...opts }
  if (!url) return new NullSearchIndex()
  const client = await loadMeiliClient(url, apiKey)
  if (!client) return new NullSearchIndex()
  return new MeiliSearchIndex(client, index)
}

/** Tests and the smoke script. */
export function resetSearchForTests(): void {
  cached = undefined
}

/** True when search is switched on for this deployment, whatever its health. */
export function searchConfigured(): boolean {
  return !!fromEnv().url
}

/* ── the runtime's hooks ─────────────────────────────────────────────────────
 * Every one of these swallows its own failures. Call them and move on.
 */

/** Boot: create the index and apply settings. */
export async function configureSearch(): Promise<void> {
  try {
    const idx = await searchIndex()
    if (idx instanceof NullSearchIndex) return
    await idx.configure()
  } catch (err) {
    log.warn('search configure failed', { detail: describeError(err) })
  }
}

/**
 * Index one event, or remove it. Call this after every ledger write: a public event
 * that was narrowed to unlisted, held or members must LEAVE the index, so this decides
 * in both directions rather than making the caller think about it.
 */
export async function indexEvent(row: IndexableRow, h: IndexableHost): Promise<void> {
  try {
    const idx = await searchIndex()
    if (idx instanceof NullSearchIndex) return
    const doc = toEventDoc(row, h)
    if (doc) await idx.upsert([doc])
    else await idx.remove([row.id])
  } catch (err) {
    log.warn('search index update failed', { detail: describeError(err) })
  }
}

export async function deindexEvent(id: string): Promise<void> {
  try {
    const idx = await searchIndex()
    if (idx instanceof NullSearchIndex) return
    await idx.remove([id])
  } catch (err) {
    log.warn('search index removal failed', { detail: describeError(err) })
  }
}

/** A page of the ledger, so `reindexAll` can be tested without Postgres. */
export type LedgerPage = (afterId: string | null, limit: number) => Promise<Array<{ row: IndexableRow; host: IndexableHost }>>

/**
 * Rebuild the index from the ledger. Walks by id so a long run is resumable and never
 * holds the whole table in memory. Indexable rows are upserted; everything else is
 * removed, which is what repairs an index that went stale while search was down.
 */
export async function reindexAll(opts: { pageSize?: number; page?: LedgerPage; index?: SearchIndex } = {}): Promise<{ indexed: number; removed: number; ok: boolean }> {
  const pageSize = opts.pageSize ?? 500
  const page = opts.page ?? defaultLedgerPage
  let indexed = 0
  let removed = 0
  try {
    const idx = opts.index ?? (await searchIndex())
    if (idx instanceof NullSearchIndex) return { indexed: 0, removed: 0, ok: false }
    let after: string | null = null
    for (let guard = 0; guard < 10_000; guard++) {
      const rows: Array<{ row: IndexableRow; host: IndexableHost }> = await page(after, pageSize)
      if (rows.length === 0) break
      const docs: EventDoc[] = []
      const gone: string[] = []
      for (const { row, host } of rows) {
        const doc = isIndexable(row) ? toEventDoc(row, host) : null
        if (doc) docs.push(doc)
        else gone.push(row.id)
      }
      if (docs.length) await idx.upsert(docs)
      if (gone.length) await idx.remove(gone)
      indexed += docs.length
      removed += gone.length
      after = rows[rows.length - 1]!.row.id
      if (rows.length < pageSize) break
    }
    log.info('search reindex complete', { indexed, removed })
    return { indexed, removed, ok: true }
  } catch (err) {
    log.warn('search reindex failed', { detail: describeError(err) })
    return { indexed, removed, ok: false }
  }
}

/** The default ledger walker: every row, oldest id first, with its host. */
const defaultLedgerPage: LedgerPage = async (afterId, limit) => {
  const rows = await getDb()
    .select({ e: sourceEvent, h: hostTable })
    .from(sourceEvent)
    .innerJoin(hostTable, eq(hostTable.id, sourceEvent.hostId))
    .where(and(gt(sourceEvent.id, afterId ?? '')))
    .orderBy(asc(sourceEvent.id))
    .limit(limit)
  return rows.map(({ e, h }) => ({ row: e, host: h }))
}

/**
 * Search. `available: false` means the caller should use its own Postgres path; it is
 * not an error and not an empty result.
 */
export async function searchEvents(query: SearchQuery): Promise<SearchResult> {
  try {
    const idx = await searchIndex()
    if (idx instanceof NullSearchIndex) return UNAVAILABLE
    return await idx.search(query)
  } catch (err) {
    log.warn('search failed', { detail: describeError(err) })
    return UNAVAILABLE
  }
}

/** For `/api/public/health`. */
export async function searchHealth(): Promise<'ok' | 'down' | 'off'> {
  if (!searchConfigured()) return 'off'
  try {
    const idx = await searchIndex()
    return (await idx.ready()) ? 'ok' : 'down'
  } catch {
    return 'down'
  }
}
