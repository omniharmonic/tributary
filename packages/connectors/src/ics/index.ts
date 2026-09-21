/**
 * `ics` — the generic ICS / webcal connector (architecture §4.1). Any URL that returns
 * `text/calendar`, plus `<link rel="alternate" type="text/calendar">` autodiscovery on
 * a page the detector already fetched.
 */
import { ConnectorError, MINUTE, type Connector, type DetectInput, type DetectMatch } from '../sdk.js'
import { fetchAndParse, fetchIcsFeed, looksLikeIcs, normalizeFeedUrl } from './feed.js'
import { parseIcs } from './parse.js'

export interface IcsConfig {
  url: string
  tz?: string
  title?: string
}

const ICS_PATH = /\.ics(?:$|\?)|\/ical(?:\/|$|\?)|\/feed\/ical|\/events\.ics|\/calendar\.ics|format=ical|\/webcal/i

/** Hosts whose ICS URLs belong to a more specific connector; the generic one steps back. */
const SPECIFIC_HOSTS = /(^|\.)(calendar\.google\.com|lu\.ma|luma\.com|api\.lu\.ma|meetup\.com)$/i

export function findCalendarLink(html: string, baseUrl: string): string | undefined {
  const re = /<link\b[^>]*>/gi
  for (const m of html.matchAll(re)) {
    const tag = m[0]
    if (!/type\s*=\s*["']?text\/calendar/i.test(tag)) continue
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
    if (!href) continue
    try {
      return normalizeFeedUrl(new URL(href, baseUrl).toString())
    } catch {
      /* skip */
    }
  }
  const plain = /https?:\/\/[^\s"'<>]+\.ics\b/i.exec(html)?.[0] ?? /webcal:\/\/[^\s"'<>]+/i.exec(html)?.[0]
  return plain ? normalizeFeedUrl(plain) : undefined
}

export const icsConnector: Connector<IcsConfig, null> = {
  type: 'ics',
  platform: 'ics',
  capabilities: { live: 'poll', delta: false, explicitDeletes: false, images: 'via-page', requiresAuth: 'none' },
  defaultInterval: 30 * MINUTE,

  async detect(input: DetectInput): Promise<DetectMatch | null> {
    const text = input.text?.trim() ?? ''
    if (/^webcal:\/\//i.test(text)) {
      return { type: 'ics', confidence: 0.95, platform: 'ics', hint: { url: normalizeFeedUrl(text) } }
    }
    if (input.url) {
      if (SPECIFIC_HOSTS.test(input.url.hostname)) return null
      if (ICS_PATH.test(input.url.pathname + input.url.search)) {
        return { type: 'ics', confidence: 0.9, platform: 'ics', hint: { url: normalizeFeedUrl(input.url.toString()) } }
      }
    }
    if (input.fetched) {
      const ct = input.fetched.contentType?.toLowerCase()
      if (ct === 'text/calendar' || looksLikeIcs(input.fetched.body)) {
        return { type: 'ics', confidence: 0.98, platform: 'ics', hint: { url: normalizeFeedUrl(input.fetched.finalUrl) } }
      }
      if (ct?.includes('html')) {
        const link = findCalendarLink(input.fetched.body, input.fetched.finalUrl)
        if (link && !SPECIFIC_HOSTS.test(new URL(link).hostname)) {
          return { type: 'ics', confidence: 0.7, platform: 'ics', hint: { url: link }, note: 'This site publishes a calendar feed; we will subscribe to it.' }
        }
      }
    }
    if (input.file && (/\.ics$/i.test(input.file.name) || input.file.mime === 'text/calendar')) {
      // Files belong to the upload connector; the detector routes them there.
      return null
    }
    return null
  },

  async configure(input, ctx): Promise<IcsConfig> {
    const hint = 'hint' in input ? (input as DetectMatch).hint : (input as Record<string, unknown>)
    const raw = typeof hint.url === 'string' ? hint.url : undefined
    if (!raw) throw new ConnectorError('no feed URL', 'Unsupported', false)
    const url = normalizeFeedUrl(raw)
    const probe = await fetchIcsFeed(url, { http: ctx.http, log: ctx.log, secrets: {}, window: { from: new Date(0), to: new Date(0) }, defaultTz: 'UTC' })
    const parsed = parseIcs(probe.text, { window: { from: new Date(0), to: new Date(8.64e15 / 2) }, defaultTz: 'UTC' })
    const cfg: IcsConfig = { url }
    if (parsed.meta.tz) cfg.tz = parsed.meta.tz
    if (parsed.meta.title) cfg.title = parsed.meta.title
    return cfg
  },

  async fetch(cfg, _cursor, ctx) {
    return fetchAndParse(cfg.url, { ...ctx, defaultTz: cfg.tz ?? ctx.defaultTz })
  },

  fingerprint(cfg) {
    return `ics:${normalizeFeedUrl(cfg.url).toLowerCase()}`
  },

  label(cfg) {
    return cfg.title ? `${cfg.title} (calendar feed)` : `Calendar feed ${cfg.url}`
  },
}
