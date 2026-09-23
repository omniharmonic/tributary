/**
 * The Meilisearch backend.
 *
 * The client is loaded through a dynamic import with a non-literal specifier, so this
 * module compiles and runs whether or not the package is installed. A missing package,
 * an unset URL or an unreachable server all land in the same place: search reports
 * itself unavailable and callers fall back to Postgres.
 */
import { buildSearchParams } from './query.js'
import { indexSettings, INDEX_UID, PRIMARY_KEY } from './settings.js'
import { UNAVAILABLE, type EventDoc, type RawClient, type SearchIndex, type SearchQuery, type SearchResult } from './types.js'
import { describeError, log } from '../lib/logging.js'

/** Documents per write batch: Meilisearch is happy with far more, but this bounds memory. */
const BATCH = 500

/**
 * Load the real client. `spec` is typed `string` on purpose: TypeScript will not try to
 * resolve a non-literal specifier, so `meilisearch` stays an optional dependency at
 * compile time as well as at run time.
 */
export async function loadMeiliClient(host: string, apiKey: string): Promise<RawClient | null> {
  try {
    const spec: string = 'meilisearch'
    const mod = (await import(spec)) as { MeiliSearch?: new (o: { host: string; apiKey?: string }) => RawClient }
    if (!mod.MeiliSearch) return null
    return new mod.MeiliSearch({ host, apiKey: apiKey || undefined })
  } catch (err) {
    log.warn('meilisearch client could not be loaded; search falls back to Postgres', { detail: describeError(err) })
    return null
  }
}

export class MeiliSearchIndex implements SearchIndex {
  private configured = false

  constructor(
    private readonly client: RawClient,
    private readonly uid: string = INDEX_UID,
  ) {}

  private index() {
    return this.client.index(this.uid)
  }

  /** Create the index if it is new, then apply settings. Both are idempotent. */
  async configure(): Promise<void> {
    try {
      await this.client.createIndex(this.uid, { primaryKey: PRIMARY_KEY }).catch(() => {
        // Already there: the settings update below is what matters.
      })
      await this.index().updateSettings(indexSettings())
      this.configured = true
      log.info('search index configured', { index: this.uid })
    } catch (err) {
      log.warn('search index could not be configured', { detail: describeError(err) })
    }
  }

  async upsert(docs: EventDoc[]): Promise<void> {
    if (docs.length === 0) return
    for (let i = 0; i < docs.length; i += BATCH) {
      const batch = docs.slice(i, i + BATCH) as unknown as Record<string, unknown>[]
      await this.index().addDocuments(batch, { primaryKey: PRIMARY_KEY })
    }
  }

  async remove(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    for (let i = 0; i < ids.length; i += BATCH) {
      await this.index().deleteDocuments(ids.slice(i, i + BATCH))
    }
  }

  async search(query: SearchQuery): Promise<SearchResult> {
    try {
      const params = buildSearchParams(query)
      const res = await this.index().search(query.q?.trim() || null, params)
      const hits = (res.hits ?? []).map((h) => ({ id: String(h.id ?? ''), score: Number(h._rankingScore ?? 1) })).filter((h) => h.id)
      const total = res.estimatedTotalHits ?? res.totalHits ?? hits.length
      const offset = Number(params.offset ?? 0)
      const limit = Number(params.limit ?? hits.length)
      return { hits, total, available: true, cursor: offset + hits.length < total ? String(offset + limit) : null }
    } catch (err) {
      log.warn('search query failed; falling back', { detail: describeError(err) })
      return UNAVAILABLE
    }
  }

  async ready(): Promise<boolean> {
    try {
      const h = await this.client.health()
      const ok = !h.status || h.status === 'available'
      if (ok && !this.configured) await this.configure()
      return ok
    } catch {
      return false
    }
  }
}
