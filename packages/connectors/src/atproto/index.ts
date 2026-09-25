/**
 * The AT Protocol repo connector: somebody's own calendar records, read straight out of
 * their repo.
 *
 * This is the one connector where the directory is not scraping a website. The person
 * signs in with their handle, their events already exist as
 * `community.lexicon.calendar.event` records under their own DID, and we list them where
 * they are. Nothing is copied into our PDS: the card points at their record, and when
 * they delete it there it leaves the directory on the next sync.
 *
 * Reading a repo needs no authorisation at all — `listRecords` is public — so a visitor
 * can paste anyone's handle and see their public calendar. Signing in matters for
 * claiming the listing, not for reading it.
 */
import { ConnectorError, HOUR, type Connector, type DetectInput, type DetectMatch, type RawEvent } from '../sdk.js'
import { cleanHandle, isDid, resolveRepo } from './identity.js'
import { EVENT_COLLECTION, toRawEvent, type RepoRecord } from './record.js'

export * from './identity.js'
export * from './record.js'

export interface AtprotoConfig {
  did: string
  handle?: string
  pdsUrl: string
  collection: string
}

/** A repo is a person's whole calendar; 2,000 records is far past any real one. */
const MAX_PAGES = 20
const PAGE_SIZE = 100

/** `https://bsky.app/profile/<handle-or-did>` and the other profile hosts we know. */
function handleFromProfileUrl(url: URL): string | null {
  const seg = url.pathname.split('/').filter(Boolean)
  const i = seg.indexOf('profile')
  return i >= 0 ? (seg[i + 1] ?? null) : null
}

export const atprotoConnector: Connector<AtprotoConfig, null> = {
  type: 'atproto',
  platform: 'atproto',
  capabilities: { live: 'poll', delta: false, explicitDeletes: true, images: 'native', requiresAuth: 'none' },
  defaultInterval: HOUR,

  async detect(input: DetectInput): Promise<DetectMatch | null> {
    // `at://did:plc:.../community.lexicon.calendar.event` or a bare DID or handle.
    const text = input.text?.trim() ?? ''
    if (input.url) {
      const fromProfile = handleFromProfileUrl(input.url)
      if (fromProfile && (isDid(fromProfile) || cleanHandle(fromProfile))) {
        return { type: 'atproto', confidence: 0.95, platform: 'atproto', hint: { actor: fromProfile } }
      }
      return null
    }
    const bare = text.replace(/^at:\/\//, '').replace(/\/.*$/, '')
    if (isDid(bare)) return { type: 'atproto', confidence: 0.99, platform: 'atproto', hint: { actor: bare } }
    // A bare domain is ambiguous — it is usually a website — so an explicit `@` is what
    // makes this a handle. `alice.example.com` still reaches the web connectors first.
    if (text.startsWith('@')) {
      const h = cleanHandle(text)
      if (h) return { type: 'atproto', confidence: 0.9, platform: 'atproto', hint: { actor: h } }
    }
    return null
  },

  async configure(input, ctx) {
    const h = ('hint' in input ? (input as DetectMatch).hint : input) as { actor?: unknown; did?: unknown; handle?: unknown; pdsUrl?: unknown; collection?: unknown }
    const actor = String(h.actor ?? h.did ?? h.handle ?? '').trim()
    if (!actor) throw new ConnectorError('we need a handle or a DID to read a calendar from', 'Unsupported', false)
    const repo = await resolveRepo(actor, ctx.http)
    return { did: repo.did, handle: repo.handle, pdsUrl: repo.pdsUrl, collection: typeof h.collection === 'string' && h.collection ? h.collection : EVENT_COLLECTION }
  },

  async fetch(cfg, _cursor, ctx) {
    const events: RawEvent[] = []
    let cursor: string | undefined
    let pages = 0
    for (; pages < MAX_PAGES; pages++) {
      const url = `${cfg.pdsUrl}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(cfg.did)}&collection=${encodeURIComponent(cfg.collection)}&limit=${PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
      const res = await ctx.http.get(url, { headers: { accept: 'application/json' }, maxBytes: 8 * 1024 * 1024 })
      if (res.status === 400) {
        // `RepoNotFound` and `InvalidRequest` both arrive as 400. A repo that has never
        // held a calendar record is not an error: it is an empty calendar.
        const body = res.text()
        if (/RepoNotFound|RepoDeactivated|RepoTakendown/.test(body)) throw new ConnectorError('that account is not readable right now', 'Gone', false)
        break
      }
      if (res.status === 404) break
      if (res.status === 429) throw new ConnectorError('that server asked us to slow down', 'RateLimited')
      if (res.status !== 200) throw new ConnectorError(`that account’s server answered ${res.status}`, 'Other')
      let json: { records?: RepoRecord[]; cursor?: string }
      try {
        json = JSON.parse(res.text())
      } catch {
        throw new ConnectorError('that account’s server sent something we could not read', 'Unparseable')
      }
      for (const rec of json.records ?? []) {
        const ev = toRawEvent(rec, { pdsUrl: cfg.pdsUrl, did: cfg.did })
        if (ev) events.push(ev)
      }
      cursor = json.cursor
      if (!cursor || (json.records ?? []).length < PAGE_SIZE) break
    }
    if (pages >= MAX_PAGES) ctx.log.warn('atproto repo has more calendar records than one sync reads', { pages })
    // We read the whole collection, so a record that has gone really is gone: this is one
    // of the few sources where a deletion is unambiguous rather than inferred.
    return { events, cursor: null, complete: true, window: ctx.window, meta: { title: cfg.handle ? `@${cfg.handle}` : cfg.did, url: cfg.handle ? `https://bsky.app/profile/${cfg.handle}` : undefined } }
  },

  fingerprint: (cfg) => `atproto:${cfg.did}:${cfg.collection}`,
  label: (cfg) => `Calendar in ${cfg.handle ? `@${cfg.handle}` : cfg.did}’s repo`,
}
