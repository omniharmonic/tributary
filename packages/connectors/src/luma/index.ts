/**
 * `luma` — a Luma calendar (architecture §4.1). A calendar page (`lu.ma/<slug>`,
 * `luma.com/calendar/cal-…`) or an event page (`lu.ma/<8-char slug>`) resolves to the
 * calendar's ICS feed `https://api.lu.ma/ics/get?entity=calendar&id=<cal-…>`.
 *
 * Verified 2026-09-21 against live pages: the Next.js page data carries
 * `props.pageProps.initialData.data.calendar.api_id` (and `.calendar.slug`,
 * `.calendar.name`) on both calendar and event pages; event pages also carry
 * `.event.calendar_api_id`. Discover pages (`lu.ma/sf`) list many calendars and have no
 * `.calendar`; they are refused with a note.
 *
 * Images come from the event page (`cover_image` / `og:image`) through page enrichment;
 * the feed carries none.
 */
import { ConnectorError, MINUTE, type Connector, type DetectInput, type DetectMatch, type RawEvent } from '../sdk.js'
import { fetchAndParse } from '../ics/feed.js'

export interface LumaConfig {
  calendarId: string
  slug?: string
  title?: string
}

const LUMA_HOST = /(^|\.)(lu\.ma|luma\.com)$/i
const CAL_ID = /^cal-[A-Za-z0-9]{6,}$/
const SHORT_SLUG = /^[a-z0-9]{6,10}$/

export function lumaIcsUrl(calendarId: string): string {
  return `https://api.lu.ma/ics/get?entity=calendar&id=${encodeURIComponent(calendarId)}`
}

export function isLumaUrl(u: URL): boolean {
  return LUMA_HOST.test(u.hostname)
}

/** Where the pasted URL points: a calendar page, an event page, or the ICS itself. */
export function classifyLumaUrl(u: URL): { kind: 'ics'; calendarId: string } | { kind: 'calendar'; calendarId: string } | { kind: 'page'; path: string } | null {
  if (/^api\.lu\.ma$/i.test(u.hostname) && u.pathname.startsWith('/ics/get')) {
    const id = u.searchParams.get('id')
    if (id && CAL_ID.test(id)) return { kind: 'ics', calendarId: id }
    return null
  }
  if (!isLumaUrl(u)) return null
  const parts = u.pathname.split('/').filter(Boolean)
  if (parts[0] === 'calendar' && parts[1] && CAL_ID.test(parts[1])) return { kind: 'calendar', calendarId: parts[1] }
  if (parts.length >= 1 && parts[0]) return { kind: 'page', path: `/${parts.join('/')}` }
  return null
}

interface PageData {
  calendar?: { api_id?: string; slug?: string; name?: string }
  event?: { calendar_api_id?: string; url?: string }
}

/** Pull the calendar identity out of a Luma page's embedded data. */
export function calendarFromPage(html: string): { calendarId: string; slug?: string; title?: string } | undefined {
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)
  if (m?.[1]) {
    try {
      const data = JSON.parse(m[1]) as { props?: { pageProps?: { initialData?: { data?: PageData } } } }
      const d = data.props?.pageProps?.initialData?.data
      const id = d?.calendar?.api_id ?? d?.event?.calendar_api_id
      if (id && CAL_ID.test(id)) return { calendarId: id, slug: d?.calendar?.slug, title: d?.calendar?.name }
      // Parsed page data with no calendar of its own (a discover page): not ours to guess.
      return undefined
    } catch {
      /* fall through to the text scan */
    }
  }
  const scan = /"calendar_api_id"\s*:\s*"(cal-[A-Za-z0-9]+)"/.exec(html)?.[1] ?? /"calendar"\s*:\s*\{[^}]*?"api_id"\s*:\s*"(cal-[A-Za-z0-9]+)"/.exec(html)?.[1]
  return scan ? { calendarId: scan } : undefined
}

/** Prefer the short public slug from the description over the UID-derived form. */
export function canonicalLumaUrl(e: RawEvent): string | undefined {
  const fromText = e.description && /https?:\/\/(?:lu\.ma|luma\.com)\/([a-z0-9]{6,12})\b/i.exec(e.description)
  if (fromText?.[1] && !fromText[1].startsWith('event')) return `https://lu.ma/${fromText[1]}`
  if (e.url && /(?:lu\.ma|luma\.com)\//i.test(e.url)) return e.url.replace(/^https?:\/\/(?:www\.)?luma\.com\//i, 'https://lu.ma/')
  const uidSlug = /^(evt-[A-Za-z0-9]+)@/.exec(e.externalId)?.[1]
  return uidSlug ? `https://lu.ma/${uidSlug}` : undefined
}

export const lumaConnector: Connector<LumaConfig, null> = {
  type: 'luma',
  platform: 'luma',
  capabilities: { live: 'poll', delta: false, explicitDeletes: false, images: 'via-page', requiresAuth: 'none' },
  defaultInterval: 30 * MINUTE,

  async detect(input: DetectInput): Promise<DetectMatch | null> {
    const u = input.url
    if (!u) return null
    const c = classifyLumaUrl(u)
    if (!c) return null
    if (c.kind === 'ics' || c.kind === 'calendar') return { type: 'luma', confidence: 0.98, platform: 'luma', hint: { calendarId: c.calendarId } }
    const seg = c.path.slice(1)
    const note = SHORT_SLUG.test(seg) ? 'This looks like a single Luma event; we will connect its whole calendar so new events appear too.' : undefined
    return { type: 'luma', confidence: 0.9, platform: 'luma', hint: { pageUrl: u.toString() }, ...(note ? { note } : {}) }
  },

  async configure(input, ctx): Promise<LumaConfig> {
    const hint = 'hint' in input ? (input as DetectMatch).hint : (input as Record<string, unknown>)
    if (typeof hint.calendarId === 'string' && CAL_ID.test(hint.calendarId)) {
      const cfg: LumaConfig = { calendarId: hint.calendarId }
      if (typeof hint.slug === 'string') cfg.slug = hint.slug
      if (typeof hint.title === 'string') cfg.title = hint.title
      return cfg
    }
    const pageUrl = typeof hint.pageUrl === 'string' ? hint.pageUrl : typeof hint.url === 'string' ? hint.url : undefined
    if (!pageUrl) throw new ConnectorError('no Luma page URL', 'Unsupported', false)
    const res = await ctx.http.getPage(pageUrl)
    if (res.status === 404) throw new ConnectorError('that Luma page does not exist', 'NotFound', false)
    if (res.status !== 200) throw new ConnectorError(`Luma answered ${res.status}`, 'Network', true)
    const found = calendarFromPage(res.text())
    if (!found) {
      throw new ConnectorError('that Luma page is not a calendar or event we can subscribe to (a city discover page lists many calendars; paste one calendar or event instead)', 'Unsupported', false)
    }
    const cfg: LumaConfig = { calendarId: found.calendarId }
    if (found.slug) cfg.slug = found.slug
    if (found.title) cfg.title = found.title
    return cfg
  },

  async fetch(cfg, _cursor, ctx) {
    return fetchAndParse(lumaIcsUrl(cfg.calendarId), ctx, (e) => {
      const url = canonicalLumaUrl(e)
      const out: RawEvent = { ...e }
      if (url) out.url = url
      // Luma marks every event TENTATIVE; the feed carries no cover image.
      delete out.imageUrl
      return out
    })
  },

  fingerprint(cfg) {
    return `luma:${cfg.calendarId}`
  },

  label(cfg) {
    return cfg.title ? `${cfg.title} (Luma)` : cfg.slug ? `lu.ma/${cfg.slug}` : `Luma calendar ${cfg.calendarId}`
  },
}
