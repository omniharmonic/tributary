/**
 * `jsonld-page`: any page carrying schema.org `Event` data — Eventbrite, Humanitix,
 * Ticket Tailor, Dandelion, a venue's own site. Re-checked daily until the event ends.
 */
import { type Connector, ConnectorError, DAY, type DetectMatch, type FetchResult, type RawEvent } from '../sdk.js'
import { extractJsonLdEvents, extractPageMeta } from './extract.js'

export interface JsonLdPageConfig {
  url: string
  tz?: string
  platform?: string
  /** True when the page lists many events (a list page): missing-detection applies. */
  list?: boolean
}

const PLATFORM_BY_HOST: Array<[RegExp, string]> = [
  [/(^|\.)eventbrite\./i, 'eventbrite'],
  [/(^|\.)humanitix\.com$/i, 'humanitix'],
  [/(^|\.)tickettailor\.com$/i, 'tickettailor'],
  [/(^|\.)dandelion\.events$/i, 'dandelion'],
  [/(^|\.)ti\.to$/i, 'tito'],
  [/(^|\.)lu\.ma$|(^|\.)luma\.com$/i, 'luma'],
  [/(^|\.)meetup\.com$/i, 'meetup'],
]

export function platformForUrl(url: string): string {
  try {
    const host = new URL(url).hostname
    for (const [re, p] of PLATFORM_BY_HOST) if (re.test(host)) return p
  } catch {
    /* fall through */
  }
  return 'web'
}

function canonical(url: string): string {
  try {
    const u = new URL(url)
    u.hash = ''
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$|aff)/i.test(k)) u.searchParams.delete(k)
    return u.toString()
  } catch {
    return url
  }
}

export const jsonldPageConnector: Connector<JsonLdPageConfig, null> = {
  type: 'jsonld-page',
  platform: 'web',
  capabilities: { live: 'poll', delta: false, explicitDeletes: false, images: 'native', requiresAuth: 'none' },
  defaultInterval: DAY,

  async detect(input) {
    if (!input.url || !input.fetched?.body) return null
    if (input.fetched.contentType && !/html|xml/.test(input.fetched.contentType)) return null
    const events = extractJsonLdEvents(input.fetched.body, input.fetched.finalUrl)
    if (events.length === 0) return null
    const platform = platformForUrl(input.fetched.finalUrl)
    const many = events.length > 1
    return {
      type: 'jsonld-page',
      confidence: 0.8,
      platform,
      hint: { url: input.fetched.finalUrl, list: many, count: events.length },
      note: many
        ? `This page lists ${events.length} events; we will follow each one and re-check the page daily.`
        : platform === 'eventbrite'
          ? 'We can read this event now. Connect Eventbrite later for live sync of all your events.'
          : undefined,
    }
  },

  async configure(input) {
    const hint = 'hint' in input && input.hint && typeof input.hint === 'object' ? (input.hint as Record<string, unknown>) : (input as Record<string, unknown>)
    const url = typeof hint.url === 'string' ? hint.url : undefined
    if (!url) throw new ConnectorError('a page URL is required', 'Unsupported', false)
    const cfg: JsonLdPageConfig = { url: canonical(url), platform: (input as DetectMatch).platform ?? platformForUrl(url) }
    if (typeof hint.tz === 'string') cfg.tz = hint.tz
    if (hint.list === true) cfg.list = true
    return cfg
  },

  async fetch(cfg, _cursor, ctx): Promise<FetchResult<null>> {
    let res
    try {
      res = await ctx.http.getPage(cfg.url, { etag: ctx.etag, lastModified: ctx.lastModified })
    } catch (err) {
      throw new ConnectorError(err instanceof Error ? err.message : 'fetch failed', 'Network')
    }
    if (res.notModified) return { events: [], cursor: null, complete: false, notModified: true, etag: ctx.etag, lastModified: ctx.lastModified }
    if (res.status === 404 || res.status === 410) throw new ConnectorError('the page is gone', res.status === 410 ? 'Gone' : 'NotFound')
    if (res.status === 403 || res.status === 401) throw new ConnectorError('the page refused us', 'Forbidden')
    if (res.status === 429) throw new ConnectorError('rate limited', 'RateLimited')
    if (res.status >= 400) throw new ConnectorError(`HTTP ${res.status}`, 'Network')
    const html = res.text()
    const events: RawEvent[] = extractJsonLdEvents(html, res.url)
    const meta = extractPageMeta(html, res.url)
    for (const e of events) {
      if (!e.imageUrl && meta.ogImage) e.imageUrl = meta.ogImage
      if (cfg.tz && !e.tz) e.tz = cfg.tz
      if (!e.url) e.url = res.url
    }
    if (events.length === 0) throw new ConnectorError('the page no longer carries event data', 'Unparseable')
    const starts = events.map((e) => new Date(e.start).getTime()).filter((t) => Number.isFinite(t))
    const ends = events.map((e) => new Date(e.end ?? e.start).getTime()).filter((t) => Number.isFinite(t))
    return {
      events,
      cursor: null,
      complete: true,
      window: cfg.list || events.length > 1
        ? ctx.window
        : { from: new Date(Math.min(...starts)), to: new Date(Math.max(...ends)) },
      etag: res.etag,
      lastModified: res.lastModified,
      meta: { title: meta.title, url: res.url },
    }
  },

  fingerprint: (cfg) => `page:${canonical(cfg.url).toLowerCase()}`,
  label: (cfg) => {
    try {
      const u = new URL(cfg.url)
      return `${cfg.platform && cfg.platform !== 'web' ? cfg.platform[0]!.toUpperCase() + cfg.platform.slice(1) : 'Event page'} ${u.hostname}${u.pathname.length > 1 ? u.pathname : ''}`
    } catch {
      return `Event page ${cfg.url}`
    }
  },
}
