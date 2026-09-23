/**
 * Search, against a fake in-memory Meilisearch. No live server, no Postgres.
 *
 * The rule under test that matters most is the privacy one: only public and gated
 * live events reach the index, and a gated event never carries coordinates.
 */
import { describe, expect, it } from 'vitest'
import { normalize, type NormalizedEvent } from '@tributary/event-model'
import {
  buildFilters,
  buildSearchParams,
  INDEX_UID,
  indexSettings,
  isIndexable,
  MeiliSearchIndex,
  NullSearchIndex,
  quote,
  reindexAll,
  SYNONYMS,
  toEventDoc,
  type EventDoc,
  type IndexableHost,
  type IndexableRow,
  type RawClient,
  type RawIndex,
  type RawSearchResponse,
} from '../src/search/index.js'

/* ── the fake ────────────────────────────────────────────────────────────── */

class FakeIndex implements RawIndex {
  docs = new Map<string, Record<string, unknown>>()
  settings: Record<string, unknown> | null = null
  lastSearch: { q: string | null; params: Record<string, unknown> } | null = null
  async addDocuments(docs: Record<string, unknown>[]) {
    for (const d of docs) this.docs.set(String(d.id), d)
  }
  async deleteDocuments(ids: string[]) {
    for (const id of ids) this.docs.delete(id)
  }
  async updateSettings(s: Record<string, unknown>) {
    this.settings = s
  }
  async search(q: string | null, params?: Record<string, unknown>): Promise<RawSearchResponse> {
    this.lastSearch = { q, params: params ?? {} }
    const hits = [...this.docs.values()].map((d) => ({ id: d.id, _rankingScore: 0.9 }))
    return { hits, estimatedTotalHits: hits.length, offset: Number(params?.offset ?? 0), limit: Number(params?.limit ?? hits.length) }
  }
}

class FakeClient implements RawClient {
  indexes = new Map<string, FakeIndex>()
  created: string[] = []
  index(uid: string): FakeIndex {
    let i = this.indexes.get(uid)
    if (!i) {
      i = new FakeIndex()
      this.indexes.set(uid, i)
    }
    return i
  }
  async createIndex(uid: string) {
    this.created.push(uid)
  }
  async health() {
    return { status: 'available' }
  }
}

/* ── fixtures ────────────────────────────────────────────────────────────── */

const HOST: IndexableHost = { did: 'did:plc:abc', handle: 'dairyarts.test', displayName: 'Dairy Arts Center', region: 'boulder' }

function event(over: Partial<Parameters<typeof normalize>[0]> = {}): NormalizedEvent {
  return normalize(
    {
      externalId: 'e1',
      name: 'Seed Swap and Garden Planning',
      description: 'Bring **seeds**, take seeds. [More](https://x.org/a)',
      descriptionIsHtml: false,
      start: '2026-10-04T10:00:00',
      tz: 'America/Denver',
      locations: [{ name: 'Boulder Public Library', street: '1001 Arapahoe Ave', locality: 'Boulder', region: 'CO' }],
      geo: { lat: 40.0139, lon: -105.2816 },
      url: 'https://lu.ma/abcd',
      tags: ['gardening'],
      ...over,
    },
    { sourceId: 's', sourceType: 'ics', platform: 'luma', defaultTz: 'America/Denver', fallbackUrl: 'https://lu.ma' },
  )
}

function row(n: NormalizedEvent, over: Partial<IndexableRow> = {}): IndexableRow {
  return {
    id: 'ev_abc-123_X',
    normalized: n,
    state: 'live',
    visibility: n.visibility,
    startsAt: new Date(n.start.instant),
    endsAt: n.end ? new Date(n.end.instant) : null,
    atUri: 'at://did:plc:abc/community.lexicon.calendar.event/3kabc',
    imageHash: null,
    ...over,
  }
}

/* ── document mapping ────────────────────────────────────────────────────── */

describe('document mapping', () => {
  it('maps a public event, with coordinates and plain-text description', () => {
    const doc = toEventDoc(row(event()), HOST)!
    expect(doc).toMatchObject({
      id: 'ev_abc-123_X',
      name: 'Seed Swap and Garden Planning',
      locality: 'Boulder',
      hostHandle: 'dairyarts.test',
      hostName: 'Dairy Arts Center',
      platform: 'luma',
      region: 'boulder',
      visibility: 'public',
      state: 'live',
      did: 'did:plc:abc',
      rkey: '3kabc',
    })
    expect(doc.place).toContain('Boulder Public Library')
    expect(doc._geo).toEqual({ lat: 40.0139, lng: -105.2816 })
    expect(doc.startsAtUnix).toBe(Math.floor(Date.parse('2026-10-04T16:00:00Z') / 1000))
    // Markdown is stripped: no asterisks, no link syntax.
    expect(doc.description).toBe('Bring seeds, take seeds. More')
  })

  it('never puts coordinates on a gated event', () => {
    const doc = toEventDoc(row({ ...event(), visibility: 'gated' }, { visibility: 'gated' }), HOST)!
    expect(doc.visibility).toBe('gated')
    expect(doc._geo).toBeUndefined()
    // The place label is the coarse one, not the street.
    expect(doc.place).not.toContain('Arapahoe')
  })

  it('omits coordinates for a private or coarse location', () => {
    const priv = event({ locations: [{ name: 'Home', street: '1 Elm', locality: 'Boulder', private: true }] })
    expect(toEventDoc(row(priv), HOST)!._geo).toBeUndefined()
    const noGeo = event({ geo: undefined })
    expect(toEventDoc(row(noGeo), HOST)!._geo).toBeUndefined()
  })

  it('carries an absent end date as null', () => {
    expect(toEventDoc(row(event()), HOST)!.endsAtUnix).toBeNull()
  })
})

/* ── the privacy rule ────────────────────────────────────────────────────── */

describe('privacy: what may be indexed', () => {
  it('admits only public and gated, live or cancelled', () => {
    for (const visibility of ['public', 'gated']) {
      for (const state of ['live', 'cancelled']) {
        expect(isIndexable({ id: 'ev_1', visibility, state })).toBe(true)
      }
    }
  })

  it('refuses unlisted, members, invite and held, in every state', () => {
    for (const visibility of ['unlisted', 'members', 'invite', 'held']) {
      for (const state of ['live', 'cancelled', 'held', 'removed']) {
        expect(isIndexable({ id: 'ev_1', visibility, state }), `${visibility}/${state}`).toBe(false)
      }
    }
  })

  it('refuses removed and held rows even when public', () => {
    expect(isIndexable({ id: 'ev_1', visibility: 'public', state: 'removed' })).toBe(false)
    expect(isIndexable({ id: 'ev_1', visibility: 'public', state: 'held' })).toBe(false)
  })

  it('refuses an id Meilisearch could not use as a primary key', () => {
    expect(isIndexable({ id: 'ev/1', visibility: 'public', state: 'live' })).toBe(false)
    expect(toEventDoc(row(event(), { id: 'ev 1' }), HOST)).toBeNull()
  })

  it('toEventDoc returns null for anything not indexable', () => {
    for (const visibility of ['unlisted', 'members', 'invite', 'held']) {
      expect(toEventDoc(row({ ...event(), visibility: visibility as never }, { visibility }), HOST)).toBeNull()
    }
  })
})

/* ── settings ────────────────────────────────────────────────────────────── */

describe('index settings', () => {
  it('applies synonyms, filterable and sortable attributes on configure', async () => {
    const client = new FakeClient()
    await new MeiliSearchIndex(client, INDEX_UID).configure()
    const s = client.index(INDEX_UID).settings!
    expect(client.created).toContain(INDEX_UID)
    expect(s.synonyms).toEqual(SYNONYMS)
    expect(s.filterableAttributes).toContain('_geo')
    expect(s.filterableAttributes).toContain('startsAtUnix')
    expect(s.sortableAttributes).toContain('startsAtUnix')
    expect((s.typoTolerance as { enabled: boolean }).enabled).toBe(true)
  })

  it('ranks the name above the description', () => {
    const attrs = indexSettings().searchableAttributes as string[]
    expect(attrs.indexOf('name')).toBeLessThan(attrs.indexOf('description'))
    expect(attrs.indexOf('tags')).toBeLessThan(attrs.indexOf('place'))
  })

  it('carries Boulder vocabulary both ways', () => {
    expect(SYNONYMS.kids).toContain('family')
    expect(SYNONYMS.family).toContain('kids')
    expect(SYNONYMS['live music']).toContain('concert')
    expect(SYNONYMS.workshop).toContain('class')
  })
})

/* ── query building ──────────────────────────────────────────────────────── */

describe('query building', () => {
  const now = new Date('2026-09-23T12:00:00Z')

  it('always asserts the visibility and state whitelist', () => {
    const f = buildFilters({}, now)
    expect(f.some((x) => x.startsWith('visibility IN') && x.includes('"public"') && x.includes('"gated"'))).toBe(true)
    expect(f.some((x) => x.startsWith('state IN'))).toBe(true)
    expect(f.join(' ')).not.toContain('unlisted')
  })

  it('defaults the window to three hours ago', () => {
    const f = buildFilters({}, now)
    const expected = Math.floor((now.getTime() - 3 * 3_600_000) / 1000)
    expect(f).toContain(`startsAtUnix >= ${expected}`)
  })

  it('filters by region, category or tag, and a geo radius', () => {
    const f = buildFilters({ region: 'boulder', category: 'music', near: { lat: 40.01, lon: -105.27 }, radiusKm: 10 }, now)
    expect(f).toContain('region = "boulder"')
    expect(f).toContain('(category = "music" OR tags = "music")')
    expect(f).toContain('_geoRadius(40.01, -105.27, 10000)')
  })

  it('sorts by date when browsing and by relevance when searching', () => {
    expect(buildSearchParams({}, now).sort).toEqual(['startsAtUnix:asc'])
    const searching = buildSearchParams({ q: 'yoga' }, now)
    expect(searching.sort).toBeUndefined()
    expect(searching.showRankingScore).toBe(true)
  })

  it('caps the limit and reads the cursor as an offset', () => {
    expect(buildSearchParams({ limit: 9999 }, now).limit).toBe(500)
    expect(buildSearchParams({ limit: 0 }, now).limit).toBe(1)
    expect(buildSearchParams({ cursor: '200' }, now).offset).toBe(200)
    expect(buildSearchParams({ cursor: 'nonsense' }, now).offset).toBe(0)
  })

  it('escapes quotes in a filter value', () => {
    expect(quote('a "b" c')).toBe('"a \\"b\\" c"')
  })

  it('only asks for the id back, since the card comes from Postgres', () => {
    expect(buildSearchParams({ q: 'x' }, now).attributesToRetrieve).toEqual(['id'])
  })
})

/* ── the backends ────────────────────────────────────────────────────────── */

describe('MeiliSearchIndex', () => {
  it('upserts, removes and searches', async () => {
    const client = new FakeClient()
    const idx = new MeiliSearchIndex(client, INDEX_UID)
    const doc = toEventDoc(row(event()), HOST)!
    await idx.upsert([doc])
    expect(client.index(INDEX_UID).docs.size).toBe(1)

    const res = await idx.search({ q: 'seed', region: 'boulder' })
    expect(res.available).toBe(true)
    expect(res.hits[0]!.id).toBe(doc.id)
    expect(client.index(INDEX_UID).lastSearch!.q).toBe('seed')

    await idx.remove([doc.id])
    expect(client.index(INDEX_UID).docs.size).toBe(0)
  })

  it('reports unavailable rather than throwing when the server errors', async () => {
    const client = new FakeClient()
    const idx = new MeiliSearchIndex(client, INDEX_UID)
    client.index(INDEX_UID).search = async () => {
      throw new Error('boom')
    }
    const res = await idx.search({ q: 'x' })
    expect(res).toMatchObject({ available: false, hits: [], total: 0 })
  })
})

describe('NullSearchIndex', () => {
  it('is a no-op that reports unavailable', async () => {
    const idx = new NullSearchIndex()
    await idx.upsert()
    await idx.remove()
    await idx.configure()
    expect(await idx.ready()).toBe(false)
    expect(await idx.search()).toMatchObject({ available: false, hits: [] })
  })
})

/* ── reindex ─────────────────────────────────────────────────────────────── */

describe('reindexAll', () => {
  it('upserts what belongs, sweeps out what does not, and pages by id', async () => {
    const client = new FakeClient()
    const idx = new MeiliSearchIndex(client, INDEX_UID)
    // A stale document from before the event was narrowed to members-only.
    await idx.upsert([{ ...toEventDoc(row(event()), HOST)!, id: 'ev_b' } as EventDoc])

    const all = [
      { row: row(event(), { id: 'ev_a' }), host: HOST },
      { row: row(event(), { id: 'ev_b', visibility: 'members' }), host: HOST },
      { row: row(event(), { id: 'ev_c', state: 'removed' }), host: HOST },
      { row: row(event(), { id: 'ev_d' }), host: HOST },
    ]
    const seen: Array<string | null> = []
    const page: (a: string | null, n: number) => Promise<typeof all> = async (after, limit) => {
      seen.push(after)
      const start = after ? all.findIndex((x) => x.row.id === after) + 1 : 0
      return all.slice(start, start + limit)
    }

    const res = await reindexAll({ pageSize: 2, page, index: idx })
    expect(res).toMatchObject({ ok: true, indexed: 2, removed: 2 })
    expect([...client.index(INDEX_UID).docs.keys()].sort()).toEqual(['ev_a', 'ev_d'])
    // Paged: first call with no cursor, then from the last id of each page.
    expect(seen).toEqual([null, 'ev_b', 'ev_d'])
  })

  it('reports not-ok against the null backend instead of throwing', async () => {
    const res = await reindexAll({ index: new NullSearchIndex(), page: async () => [] })
    expect(res).toEqual({ indexed: 0, removed: 0, ok: false })
  })
})

describe('client loading', () => {
  it('accepts either exported constructor name', async () => {
    // The package renamed `MeiliSearch` to `Meilisearch`; production once fell back to
    // Postgres silently because only the old name was read.
    const mod = (await import('meilisearch')) as Record<string, unknown>
    const named = Object.keys(mod).filter((k) => /^meilisearch$/i.test(k))
    expect(named.length).toBeGreaterThan(0)
  })
})
