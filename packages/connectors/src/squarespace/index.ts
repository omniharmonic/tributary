/**
 * `squarespace`: an Events collection on a Squarespace site. Any collection page
 * answers `?format=json` with `upcoming[]` / `items[]` (epoch-ms dates, HTML body,
 * `assetUrl` image, structured `location`).
 */
import { type Connector, ConnectorError, type DetectInput, type DetectMatch, type FetchResult, HOUR, type RawEvent } from '../sdk.js'

export interface SquarespaceConfig {
  /** The events collection URL (no query string). */
  url: string
  tz?: string
}

interface SqLocation {
  addressTitle?: string
  addressLine1?: string
  addressLine2?: string
  addressCountry?: string
  mapLat?: number
  mapLng?: number
}

interface SqItem {
  id?: string
  title?: string
  body?: string
  excerpt?: string
  startDate?: number
  endDate?: number
  fullUrl?: string
  urlId?: string
  assetUrl?: string
  location?: SqLocation
  tags?: string[]
  categories?: string[]
}

interface SqCollection {
  collection?: { typeName?: string; title?: string; fullUrl?: string; id?: string }
  website?: { timeZone?: string; baseUrl?: string }
  upcoming?: SqItem[]
  past?: SqItem[]
  items?: SqItem[]
}

function stripQuery(url: string): string {
  try {
    const u = new URL(url)
    u.search = ''
    u.hash = ''
    return u.toString().replace(/\/$/, '')
  } catch {
    return url
  }
}

/** "123 Main St, Boulder, CO 80302" → pieces, best effort. */
function splitLine2(line2: string | undefined): { locality?: string; region?: string; postalCode?: string } {
  if (!line2) return {}
  const m = /^\s*([^,]+?)\s*,\s*([A-Za-z .]+?)\s*(\d{5}(?:-\d{4})?)?\s*$/.exec(line2)
  if (!m) return { locality: line2.trim() }
  return { locality: m[1], region: m[2]?.trim(), postalCode: m[3] }
}

export function squarespaceItemToRaw(item: SqItem, base: string, tz?: string): RawEvent | undefined {
  const name = item.title?.trim()
  if (!name || !item.startDate) return undefined
  const raw: RawEvent = {
    externalId: `sq_${item.id ?? item.urlId ?? item.startDate}`,
    name,
    start: new Date(item.startDate).toISOString(),
    tz,
  }
  if (item.endDate) raw.end = new Date(item.endDate).toISOString()
  if (item.body) {
    raw.description = item.body
    raw.descriptionIsHtml = true
  } else if (item.excerpt) {
    raw.description = item.excerpt
    raw.descriptionIsHtml = true
  }
  if (item.fullUrl) {
    try {
      raw.url = new URL(item.fullUrl, base).toString()
    } catch {
      /* skip */
    }
  }
  if (item.assetUrl) raw.imageUrl = item.assetUrl
  const l = item.location
  if (l && (l.addressTitle || l.addressLine1 || (typeof l.mapLat === 'number' && (l.mapLat !== 0 || l.mapLng !== 0)))) {
    const loc: NonNullable<RawEvent['locations']>[number] = {}
    if (l.addressTitle) loc.name = l.addressTitle
    if (l.addressLine1) loc.street = l.addressLine1
    Object.assign(loc, splitLine2(l.addressLine2))
    if (l.addressCountry) loc.country = /united states|^usa?$/i.test(l.addressCountry) ? 'US' : l.addressCountry
    if (typeof l.mapLat === 'number' && typeof l.mapLng === 'number' && (l.mapLat !== 0 || l.mapLng !== 0)) {
      loc.lat = l.mapLat
      loc.lon = l.mapLng
    }
    if (Object.keys(loc).length) raw.locations = [loc]
  }
  const tags = [...(item.categories ?? []), ...(item.tags ?? [])]
  if (tags.length) raw.tags = tags
  return raw
}

function parseCollection(text: string): SqCollection | undefined {
  try {
    const json = JSON.parse(text) as SqCollection
    return json && typeof json === 'object' ? json : undefined
  } catch {
    return undefined
  }
}

export const squarespaceConnector: Connector<SquarespaceConfig, null> = {
  type: 'squarespace',
  platform: 'squarespace',
  capabilities: { live: 'poll', delta: false, explicitDeletes: false, images: 'native', requiresAuth: 'none' },
  defaultInterval: HOUR,

  async detect(input: DetectInput, ctx): Promise<DetectMatch | null> {
    if (!input.url || !input.fetched?.body) return null
    if (!/static1\.squarespace\.com|<meta name="generator" content="Squarespace|squarespace-cdn/i.test(input.fetched.body)) return null
    const url = stripQuery(input.fetched.finalUrl)
    try {
      const res = await ctx.http.get(`${url}?format=json`, { headers: { accept: 'application/json' }, timeoutMs: 8000 })
      if (res.status !== 200) return null
      const json = parseCollection(res.text())
      if (!json) return null
      const isEvents = json.collection?.typeName === 'events' || Array.isArray(json.upcoming)
      if (!isEvents) {
        return { type: 'squarespace', confidence: 0.4, platform: 'squarespace', hint: { url }, note: 'This is a Squarespace site, but this page is not its events collection. Paste the events page.' }
      }
      return { type: 'squarespace', confidence: 0.95, platform: 'squarespace', hint: { url, tz: json.website?.timeZone } }
    } catch {
      return null
    }
  },

  async configure(input) {
    const hint = 'hint' in input && input.hint && typeof input.hint === 'object' ? (input.hint as Record<string, unknown>) : (input as Record<string, unknown>)
    const url = typeof hint.url === 'string' ? hint.url : undefined
    if (!url) throw new ConnectorError('an events page URL is required', 'Unsupported', false)
    const cfg: SquarespaceConfig = { url: stripQuery(url) }
    if (typeof hint.tz === 'string') cfg.tz = hint.tz
    return cfg
  },

  async fetch(cfg, _cursor, ctx): Promise<FetchResult<null>> {
    let res
    try {
      res = await ctx.http.get(`${cfg.url}?format=json`, { headers: { accept: 'application/json' } })
    } catch (err) {
      throw new ConnectorError(err instanceof Error ? err.message : 'fetch failed', 'Network')
    }
    if (res.status === 404 || res.status === 410) throw new ConnectorError('the events page is gone', 'NotFound')
    if (res.status === 403 || res.status === 401) throw new ConnectorError('the site refused us', 'Forbidden')
    if (res.status === 429) throw new ConnectorError('rate limited', 'RateLimited')
    if (res.status >= 400) throw new ConnectorError(`HTTP ${res.status}`, 'Network')
    const json = parseCollection(res.text())
    if (!json) throw new ConnectorError('the page did not answer with JSON', 'Unparseable')
    const tz = cfg.tz ?? json.website?.timeZone
    const items = [...(json.upcoming ?? []), ...(json.items ?? []), ...(json.past ?? [])]
    const seen = new Set<string>()
    const events: RawEvent[] = []
    for (const item of items) {
      const raw = squarespaceItemToRaw(item, cfg.url, tz)
      if (!raw || seen.has(raw.externalId)) continue
      seen.add(raw.externalId)
      events.push(raw)
    }
    // Squarespace's `upcoming` is unbounded into the future but drops past events at
    // once; the observed window starts now.
    return { events, cursor: null, complete: true, window: { from: new Date(), to: ctx.window.to }, meta: { title: json.collection?.title, tz, url: cfg.url } }
  },

  fingerprint: (cfg) => `squarespace:${cfg.url.toLowerCase()}`,
  label: (cfg) => `Squarespace events at ${cfg.url.replace(/^https?:\/\//, '')}`,
}
