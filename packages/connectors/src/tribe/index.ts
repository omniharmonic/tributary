/**
 * `tribe`: WordPress "The Events Calendar" (Modern Tribe) via its REST API,
 * `/wp-json/tribe/events/v1/events`. Paged, filtered by the rolling window, images native.
 */
import { type Connector, ConnectorError, type DetectInput, type DetectMatch, type FetchResult, HOUR, type RawEvent } from '../sdk.js'

export interface TribeConfig {
  /** Site origin, e.g. https://example.org (no trailing slash). */
  origin: string
  tz?: string
}

interface TribeVenue {
  venue?: string
  address?: string
  city?: string
  state?: string
  province?: string
  zip?: string
  country?: string
  geo_lat?: number | string
  geo_lng?: number | string
  website?: string
}

interface TribeEvent {
  id: number
  title?: string
  description?: string
  excerpt?: string
  url?: string
  website?: string
  start_date?: string
  end_date?: string
  utc_start_date?: string
  utc_end_date?: string
  timezone?: string
  all_day?: boolean
  cost?: string
  modified?: string
  image?: { url?: string } | false
  venue?: TribeVenue | TribeVenue[]
  organizer?: Array<{ organizer?: string }> | { organizer?: string }
  categories?: Array<{ name?: string; slug?: string }>
  tags?: Array<{ name?: string }>
  status?: string
}

interface TribePage {
  events?: TribeEvent[]
  total_pages?: number
  next_rest_url?: string
}

function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function unescapeHtml(s: string): string {
  return s.replace(/&#8217;/g, '’').replace(/&#8211;/g, '–').replace(/&#038;|&amp;/g, '&').replace(/&#8220;|&#8221;/g, '"').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

export function tribeEventToRaw(e: TribeEvent, tz?: string): RawEvent | undefined {
  const name = e.title ? unescapeHtml(e.title).trim() : ''
  if (!name || !e.start_date) return undefined
  const start = e.start_date.replace(' ', 'T')
  const raw: RawEvent = {
    externalId: `tribe_${e.id}`,
    name,
    start,
    tz: e.timezone ?? tz,
  }
  if (e.end_date) raw.end = e.end_date.replace(' ', 'T')
  if (e.all_day) raw.allDay = true
  if (e.description) {
    raw.description = e.description
    raw.descriptionIsHtml = true
  }
  const url = e.url ?? e.website
  if (url) raw.url = url
  if (e.image && typeof e.image === 'object' && e.image.url) raw.imageUrl = e.image.url
  const venue = Array.isArray(e.venue) ? e.venue[0] : e.venue
  if (venue && Object.keys(venue).length) {
    const loc: NonNullable<RawEvent['locations']>[number] = {}
    if (venue.venue) loc.name = unescapeHtml(venue.venue)
    if (venue.address) loc.street = venue.address
    if (venue.city) loc.locality = venue.city
    if (venue.state ?? venue.province) loc.region = venue.state ?? venue.province
    if (venue.zip) loc.postalCode = venue.zip
    if (venue.country) loc.country = /united states/i.test(venue.country) ? 'US' : venue.country
    const lat = Number(venue.geo_lat)
    const lon = Number(venue.geo_lng)
    if (Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)) {
      loc.lat = lat
      loc.lon = lon
    }
    if (Object.keys(loc).length) raw.locations = [loc]
  }
  if (e.cost) {
    raw.priceText = unescapeHtml(e.cost)
    raw.isFree = /^(free|\$?0(\.00)?)$/i.test(e.cost.trim())
  }
  const tags = [...(e.categories ?? []).map((c) => c.name), ...(e.tags ?? []).map((t) => t.name)].filter((t): t is string => !!t).map(unescapeHtml)
  if (tags.length) raw.tags = tags
  const org = Array.isArray(e.organizer) ? e.organizer[0] : e.organizer
  if (org?.organizer) raw.organizerName = unescapeHtml(org.organizer)
  if (e.modified) raw.lastModified = e.modified
  if (e.status && e.status !== 'publish') raw.status = 'cancelled'
  return raw
}

export const tribeConnector: Connector<TribeConfig, null> = {
  type: 'tribe',
  platform: 'wordpress',
  capabilities: { live: 'poll', delta: false, explicitDeletes: false, images: 'native', requiresAuth: 'none' },
  defaultInterval: HOUR,

  async detect(input: DetectInput, ctx): Promise<DetectMatch | null> {
    if (!input.url) return null
    const origin = originOf(input.url.toString())
    if (!origin) return null
    const markup = input.fetched?.body ? /tribe-events|\/wp-json\/tribe\/|tribe_events/i.test(input.fetched.body) : false
    if (!markup && !input.fetched) return null
    if (!markup && input.fetched && !/wp-content|wp-json|wordpress/i.test(input.fetched.body)) return null
    try {
      const res = await ctx.http.get(`${origin}/wp-json/tribe/events/v1/events?per_page=1`, { timeoutMs: 8000, maxBytes: 500_000 })
      if (res.status !== 200 || !res.contentType?.includes('json')) return null
      const json = JSON.parse(res.text()) as TribePage
      if (!Array.isArray(json.events)) return null
      return { type: 'tribe', confidence: 0.95, platform: 'wordpress', hint: { origin } }
    } catch {
      return null
    }
  },

  async configure(input) {
    const hint = 'hint' in input && input.hint && typeof input.hint === 'object' ? (input.hint as Record<string, unknown>) : (input as Record<string, unknown>)
    const origin = typeof hint.origin === 'string' ? hint.origin : typeof hint.url === 'string' ? originOf(hint.url) : undefined
    if (!origin) throw new ConnectorError('a site origin is required', 'Unsupported', false)
    const cfg: TribeConfig = { origin: origin.replace(/\/$/, '') }
    if (typeof hint.tz === 'string') cfg.tz = hint.tz
    return cfg
  },

  async fetch(cfg, _cursor, ctx): Promise<FetchResult<null>> {
    const events: RawEvent[] = []
    let feedTz: string | undefined
    let page = 1
    let pages = 1
    do {
      const url = `${cfg.origin}/wp-json/tribe/events/v1/events?per_page=50&page=${page}&start_date=${ymd(ctx.window.from)}&end_date=${ymd(ctx.window.to)}`
      let res
      try {
        res = await ctx.http.get(url, { headers: { accept: 'application/json' } })
      } catch (err) {
        throw new ConnectorError(err instanceof Error ? err.message : 'fetch failed', 'Network')
      }
      if (res.status === 404) throw new ConnectorError('the events API is not available on this site', 'NotFound')
      if (res.status === 403 || res.status === 401) throw new ConnectorError('the site refused us', 'Forbidden')
      if (res.status === 429) throw new ConnectorError('rate limited', 'RateLimited')
      if (res.status >= 400) throw new ConnectorError(`HTTP ${res.status}`, 'Network')
      let json: TribePage
      try {
        json = JSON.parse(res.text()) as TribePage
      } catch {
        throw new ConnectorError('the events API returned something that is not JSON', 'Unparseable')
      }
      for (const e of json.events ?? []) {
        const raw = tribeEventToRaw(e, cfg.tz)
        if (raw) {
          feedTz ??= raw.tz
          events.push(raw)
        }
      }
      pages = Number(json.total_pages ?? 1) || 1
      page += 1
    } while (page <= pages && page <= 20)
    return { events, cursor: null, complete: true, window: ctx.window, meta: { tz: feedTz, url: cfg.origin } }
  },

  fingerprint: (cfg) => `tribe:${cfg.origin.toLowerCase()}`,
  label: (cfg) => `WordPress events calendar at ${cfg.origin.replace(/^https?:\/\//, '')}`,
}
