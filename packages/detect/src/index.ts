/**
 * Input classification (architecture §10). Cheap checks first, stop at the first
 * confident match, always return a ranked list so the console can offer "not right?".
 *
 *   1. shape        file by MIME/magic; email; image; text without a URL → extract
 *   2. known hosts  URL patterns for the platforms we know
 *   3. content type HEAD/GET through ssrf-fetch: text/calendar → ics
 *   4. fingerprints HTML: calendar autodiscovery, Tribe probe, Squarespace, Localist,
 *                   JSON-LD Event (one → jsonld-page; many → list page)
 *   5. fallback     readability text → extract, with a note
 *
 * Never throws for a bad input: an unusable URL yields a single `extract` match with a
 * note explaining what happened.
 */
// Imported by path rather than through the `@tributary/connectors` barrel so the detector
// does not load every connector module (and their fetch code) just to classify input.
import type { DetectMatch, SourceType } from '../../connectors/src/sdk.js'
import { extractPageMeta } from '../../connectors/src/jsonld-page/extract.js'
import type { HttpClient } from '@tributary/ssrf-fetch'

export type { DetectMatch }

export interface DetectFile {
  name: string
  mime: string
  bytes: Buffer
}

export interface DetectRequest {
  text?: string
  file?: DetectFile
}

export interface DetectCtx {
  http: HttpClient
  log: { info(msg: string, fields?: Record<string, string | number | boolean>): void; warn(msg: string, fields?: Record<string, string | number | boolean>): void }
}

export const NOTES = {
  facebook: 'We cannot import from Facebook: it does not publish events in a readable form. Forward the invite email, drop a screenshot of the event, or type the details and we will take it from there.',
  partiful: 'We cannot import from Partiful: it does not publish events in a readable form. Forward the invite email, drop a screenshot, or type the details.',
  unstructured: 'This page has no structured event data. We can read it and ask you to confirm what we found; updates will need your confirmation each time.',
  unreachable: 'We could not reach that address. Check the link, or paste the events page from your site.',
  notUrl: 'That does not look like a link. We can read it as a description of an event and ask you to confirm.',
  listPage: 'This page lists several events; we will follow each one and re-check the page daily.',
  eventbrite: 'We can read this event now. Connect Eventbrite later for live sync of all your events.',
  gcalPrivate: 'This looks like a private Google Calendar link. Make the calendar public (Settings → Access permissions) or paste the "Public address in iCal format".',
} as const

/* ---------- 1. shape ---------- */

function sniffFile(file: DetectFile): DetectMatch | undefined {
  const name = file.name.toLowerCase()
  const head = file.bytes.subarray(0, 512).toString('latin1')
  const mime = file.mime.toLowerCase()
  if (name.endsWith('.ics') || mime === 'text/calendar' || /^\s*BEGIN:VCALENDAR/i.test(head)) {
    return { type: 'upload', confidence: 0.99, platform: 'file', hint: { kind: 'ics', name: file.name } }
  }
  if (name.endsWith('.csv') || mime === 'text/csv' || name.endsWith('.xlsx') || name.endsWith('.xls') || mime.includes('spreadsheet') || mime.includes('excel')) {
    return { type: 'upload', confidence: 0.95, platform: 'file', hint: { kind: 'csv', name: file.name } }
  }
  const isPng = file.bytes[0] === 0x89 && file.bytes[1] === 0x50
  const isJpg = file.bytes[0] === 0xff && file.bytes[1] === 0xd8
  const isGif = head.startsWith('GIF8')
  const isWebp = head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP'
  const isPdf = head.startsWith('%PDF')
  if (isPng || isJpg || isGif || isWebp || mime.startsWith('image/') || isPdf || mime === 'application/pdf') {
    return { type: 'extract', confidence: 0.9, platform: 'flyer', hint: { kind: 'flyer', name: file.name, mime }, note: 'We will read the flyer and show you what we found to confirm before anything is published.' }
  }
  if (mime.startsWith('text/') || name.endsWith('.txt')) {
    return { type: 'extract', confidence: 0.7, platform: 'text', hint: { kind: 'text', text: file.bytes.toString('utf8').slice(0, 20_000) }, note: 'We will read this and ask you to confirm what we found.' }
  }
  return undefined
}

/** Find the first URL in a pasted string; also handles embed code (`src="…"`) and bare hosts. */
export function findUrl(text: string): URL | undefined {
  const s = text.trim()
  const src = /(?:src|href)=["']([^"']+)["']/i.exec(s)
  const candidate = src?.[1] ?? /(?:https?:\/\/|webcal:\/\/)[^\s<>"']+/i.exec(s)?.[0] ?? (/^[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i.test(s) ? `https://${s}` : undefined)
  if (!candidate) return undefined
  try {
    const u = new URL(candidate.replace(/^webcal:\/\//i, 'https://').replace(/&amp;/g, '&'))
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined
    return u
  } catch {
    return undefined
  }
}

/* ---------- 2. known hosts ---------- */

function host(u: URL): string {
  return u.hostname.toLowerCase().replace(/^www\./, '')
}

/** Google Calendar: ICS URL, embed `src`, or a `cid=` link (base64 of the calendar id). */
export function googleCalendarId(u: URL): { calendarId?: string; icsUrl?: string; private?: boolean } | undefined {
  if (!/(^|\.)google\.com$/.test(host(u))) return undefined
  const ics = /\/calendar\/ical\/([^/]+)\/(public|private-[a-f0-9]+)\/(basic|full)\.ics$/i.exec(u.pathname)
  if (ics) {
    const id = decodeURIComponent(ics[1]!)
    return { calendarId: id, icsUrl: u.toString(), private: ics[2]!.startsWith('private') }
  }
  const src = u.searchParams.getAll('src')[0]
  if (src && /\/calendar\/(embed|u\/\d+\/embed|b\/\d+\/embed)/i.test(u.pathname)) return { calendarId: src }
  const cid = u.searchParams.get('cid')
  if (cid) {
    // `cid` is url-safe base64 of the calendar id, padding optional; a plain id passes through.
    let decoded = cid
    if (!cid.includes('@') && /^[A-Za-z0-9_=-]+$/.test(cid)) {
      try {
        const padded = cid.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (cid.length % 4)) % 4)
        const d = Buffer.from(padded, 'base64').toString('utf8')
        if (/^[\w.+-]+@[\w.-]+$/.test(d)) decoded = d
      } catch {
        /* keep as-is */
      }
    }
    return { calendarId: decoded }
  }
  if (/\/calendar\/?$/.test(u.pathname) || /\/calendar\/u\/\d+\/?r?$/.test(u.pathname)) return { private: true }
  return undefined
}

function knownHost(u: URL): DetectMatch[] {
  const h = host(u)
  const path = u.pathname
  const out: DetectMatch[] = []

  const g = googleCalendarId(u)
  if (g) {
    if (g.calendarId) out.push({ type: 'gcal-public', confidence: 0.97, platform: 'google', hint: { calendarId: g.calendarId, icsUrl: g.icsUrl } })
    else out.push({ type: 'gcal-public', confidence: 0.2, platform: 'google', hint: {}, note: NOTES.gcalPrivate })
    return out
  }
  if (/(^|\.)docs\.google\.com$/.test(h) && /^\/spreadsheets\/d\/(?:e\/)?[A-Za-z0-9_-]{10,}/.test(path)) {
    const id = /^\/spreadsheets\/d\/(?:e\/)?([A-Za-z0-9_-]{10,})/.exec(path)![1]!
    const gid = u.searchParams.get('gid') ?? /gid=(\d+)/.exec(u.hash)?.[1] ?? undefined
    out.push({ type: 'sheet', confidence: 0.95, platform: 'sheet', hint: { sheetId: id, gid, published: path.includes('/d/e/') }, note: 'The sheet must be shared with "anyone with the link". We will ask you to match the columns.' })
    return out
  }
  if (h === 'lu.ma' || h === 'luma.com') {
    const seg = path.split('/').filter(Boolean)
    const first = seg[0] ?? ''
    if (first === 'calendar' || first === 'cal' || /^cal-/.test(first)) {
      out.push({ type: 'luma', confidence: 0.97, platform: 'luma', hint: { url: u.toString(), kind: 'calendar', calendarId: /^cal-/.test(first) ? first : seg[1] } })
    } else if (first === 'u' || first === 'user') {
      out.push({ type: 'luma', confidence: 0.85, platform: 'luma', hint: { url: u.toString(), kind: 'user', slug: seg[1] } })
    } else if (first) {
      out.push({ type: 'luma', confidence: 0.9, platform: 'luma', hint: { url: u.toString(), kind: /^evt-/.test(first) ? 'event' : 'event-or-calendar', slug: first } })
    }
    return out
  }
  if (h === 'meetup.com') {
    const seg = path.split('/').filter(Boolean)
    const slug = seg[0]
    if (slug && !['find', 'login', 'register', 'pro', 'home'].includes(slug)) {
      out.push({ type: 'meetup', confidence: 0.96, platform: 'meetup', hint: { url: u.toString(), group: slug, icsUrl: `https://www.meetup.com/${slug}/events/ical/`, event: seg[1] === 'events' ? seg[2] : undefined } })
    }
    return out
  }
  if (/(^|\.)eventbrite\.(com|co\.uk|ca|com\.au|de|fr|es|it|nl|ie)$/.test(h)) {
    const org = /\/o\/([^/]+)/.exec(path)
    out.push({ type: 'jsonld-page', confidence: org ? 0.6 : 0.9, platform: 'eventbrite', hint: { url: u.toString(), organizer: org?.[1], list: !!org }, note: NOTES.eventbrite })
    return out
  }
  if (/(^|\.)(outlook\.(live|office)\.com|outlook\.office365\.com)$/.test(h) && /\.ics$|\/calendar\/published\//i.test(u.toString())) {
    out.push({ type: 'ics', confidence: 0.95, platform: 'outlook', hint: { url: u.toString() } })
    return out
  }
  if (/(^|\.)icloud\.com$/.test(h) && /\/published\//i.test(path)) {
    out.push({ type: 'ics', confidence: 0.9, platform: 'icloud', hint: { url: u.toString() } })
    return out
  }
  if (/(^|\.)tockify\.com$/.test(h)) {
    const cal = path.split('/').filter(Boolean)[0]
    out.push({ type: 'ics', confidence: 0.95, platform: 'tockify', hint: { url: cal ? `https://tockify.com/api/feeds/ics/${cal}` : u.toString(), pageUrl: u.toString() } })
    return out
  }
  if (/(^|\.)teamup\.com$/.test(h)) {
    const key = /\/(ks[a-z0-9]+)/i.exec(path)?.[1]
    out.push({ type: 'ics', confidence: 0.9, platform: 'teamup', hint: { url: key ? `https://ics.teamup.com/feed/${key}/0.ics` : u.toString(), pageUrl: u.toString() } })
    return out
  }
  if (/(^|\.)trumba\.com$/.test(h)) {
    out.push({ type: 'ics', confidence: 0.85, platform: 'trumba', hint: { url: /\.ics$/i.test(path) ? u.toString() : `${u.origin}${path.replace(/\/?$/, '')}.ics`, pageUrl: u.toString() } })
    return out
  }
  if (/(^|\.)libcal\.com$/.test(h)) {
    out.push({ type: 'ics', confidence: 0.85, platform: 'libcal', hint: { url: /\.ics$|\/ical/i.test(path) ? u.toString() : `${u.origin}/calendar?cid=-1&t=d&d=0000-00-00&cal=-1&ical=1`, pageUrl: u.toString() }, note: 'LibCal calendars publish an iCal feed under "Subscribe"; paste that link if this one does not work.' })
    return out
  }
  if (/(^|\.)localist\.com$/.test(h)) {
    out.push({ type: 'localist', confidence: 0.9, platform: 'localist', hint: { origin: u.origin, pageUrl: u.toString() } })
    out.push({ type: 'ics', confidence: 0.6, platform: 'localist', hint: { url: `${u.origin}/calendar.ics`, pageUrl: u.toString() } })
    return out
  }
  if (/(^|\.)mobilize\.us$/.test(h)) {
    const slug = path.split('/').filter(Boolean)[0]
    if (slug) out.push({ type: 'mobilize', confidence: 0.9, platform: 'mobilize', hint: { slug, pageUrl: u.toString(), organizationId: /^\d+$/.test(slug) ? slug : undefined } })
    return out
  }
  if (/(^|\.)humanitix\.com$/.test(h)) {
    out.push({ type: 'jsonld-page', confidence: 0.9, platform: 'humanitix', hint: { url: u.toString() } })
    return out
  }
  if (/(^|\.)dandelion\.events$/.test(h)) {
    out.push({ type: 'jsonld-page', confidence: 0.9, platform: 'dandelion', hint: { url: u.toString() } })
    return out
  }
  if (/(^|\.)tickettailor\.com$/.test(h) || /(^|\.)ti\.to$/.test(h)) {
    out.push({ type: 'jsonld-page', confidence: 0.85, platform: /tito|ti\.to/.test(h) ? 'tito' : 'tickettailor', hint: { url: u.toString() } })
    return out
  }
  if (/(^|\.)(facebook\.com|fb\.com|fb\.me)$/.test(h)) {
    out.push({ type: 'extract', confidence: 0, platform: 'facebook', hint: { url: u.toString(), kind: 'unsupported' }, note: NOTES.facebook })
    return out
  }
  if (/(^|\.)partiful\.com$/.test(h)) {
    out.push({ type: 'extract', confidence: 0, platform: 'partiful', hint: { url: u.toString(), kind: 'unsupported' }, note: NOTES.partiful })
    return out
  }
  if (/\.ics$/i.test(path) || /format=ical|\/ical\/?$/i.test(u.toString())) {
    out.push({ type: 'ics', confidence: 0.9, platform: 'ics', hint: { url: u.toString() } })
  }
  return out
}

/* ---------- 3 + 4. fetch and fingerprint ---------- */

interface Fetched {
  contentType?: string
  body: string
  finalUrl: string
  status: number
}

async function fetchOnce(u: URL, ctx: DetectCtx): Promise<Fetched | undefined> {
  try {
    const res = await ctx.http.get(u.toString(), { timeoutMs: 12_000, maxBytes: 3 * 1024 * 1024 })
    return { contentType: res.contentType, body: res.text(), finalUrl: res.url, status: res.status }
  } catch (err) {
    ctx.log.warn('detect fetch failed', { reason: err instanceof Error ? err.name : 'unknown' })
    return undefined
  }
}

async function probeTribe(origin: string, ctx: DetectCtx): Promise<boolean> {
  try {
    const res = await ctx.http.get(`${origin}/wp-json/tribe/events/v1/events?per_page=1`, { timeoutMs: 8000, maxBytes: 500_000 })
    if (res.status !== 200) return false
    const json = JSON.parse(res.text()) as { events?: unknown }
    return Array.isArray(json.events)
  } catch {
    return false
  }
}

async function probeLocalist(origin: string, ctx: DetectCtx): Promise<boolean> {
  try {
    const res = await ctx.http.get(`${origin}/api/2/events?pp=1`, { timeoutMs: 8000, maxBytes: 500_000 })
    if (res.status !== 200) return false
    const json = JSON.parse(res.text()) as { events?: unknown }
    return Array.isArray(json.events)
  } catch {
    return false
  }
}

async function probeSquarespace(pageUrl: string, ctx: DetectCtx): Promise<{ events: boolean; tz?: string } | undefined> {
  try {
    const u = new URL(pageUrl)
    u.search = ''
    u.hash = ''
    const res = await ctx.http.get(`${u.toString().replace(/\/$/, '')}?format=json`, { timeoutMs: 8000, maxBytes: 2_000_000 })
    if (res.status !== 200) return undefined
    const json = JSON.parse(res.text()) as { collection?: { typeName?: string }; upcoming?: unknown; website?: { timeZone?: string } }
    return { events: json.collection?.typeName === 'events' || Array.isArray(json.upcoming), tz: json.website?.timeZone }
  } catch {
    return undefined
  }
}

function fromFingerprints(u: URL, f: Fetched, meta: ReturnType<typeof extractPageMeta>): DetectMatch[] {
  const out: DetectMatch[] = []
  const finalUrl = f.finalUrl
  if (meta.calendarLinks.length) {
    out.push({ type: 'ics', confidence: 0.9, platform: 'ics', hint: { url: meta.calendarLinks[0], pageUrl: finalUrl, alternatives: meta.calendarLinks.slice(1) } })
  }
  if (meta.jsonLdEventCount === 1) {
    out.push({ type: 'jsonld-page', confidence: 0.8, platform: platformFromHints(u, meta.platformHints), hint: { url: finalUrl, list: false } })
  } else if (meta.jsonLdEventCount > 1) {
    out.push({ type: 'jsonld-page', confidence: 0.8, platform: platformFromHints(u, meta.platformHints), hint: { url: finalUrl, list: true, count: meta.jsonLdEventCount }, note: NOTES.listPage })
  }
  return out
}

function platformFromHints(u: URL, hints: string[]): string {
  for (const p of ['eventbrite', 'humanitix', 'dandelion', 'luma', 'meetup', 'tribe', 'squarespace', 'localist', 'tockify', 'libcal', 'civicplus', 'trumba', 'teamup']) {
    if (hints.includes(p)) return p === 'tribe' ? 'wordpress' : p
  }
  return hints.includes('wordpress') ? 'wordpress' : 'web'
}

/* ---------- the detector ---------- */

export async function detect(input: DetectRequest, ctx: DetectCtx): Promise<DetectMatch[]> {
  // 1. shape
  if (input.file) {
    const m = sniffFile(input.file)
    if (m) return [m]
  }
  const text = input.text?.trim() ?? ''
  if (!text) return []
  const url = findUrl(text)
  if (!url) {
    return [{ type: 'extract', confidence: 0.7, platform: 'text', hint: { kind: 'text', text: text.slice(0, 20_000) }, note: NOTES.notUrl }]
  }

  // 2. known hosts
  const known = knownHost(url)
  const confident = known.find((m) => m.confidence >= 0.85)
  if (confident) return rank(known)
  const results: DetectMatch[] = [...known]

  // 3. content type
  const fetched = await fetchOnce(url, ctx)
  if (!fetched || fetched.status >= 400) {
    if (results.length) return rank(results)
    return [{ type: 'extract', confidence: 0, platform: 'web', hint: { url: url.toString(), kind: 'unreachable' }, note: NOTES.unreachable }]
  }
  const ct = fetched.contentType ?? ''
  if (ct.includes('text/calendar') || /^\s*BEGIN:VCALENDAR/i.test(fetched.body)) {
    results.push({ type: 'ics', confidence: 0.98, platform: 'ics', hint: { url: fetched.finalUrl } })
    return rank(results)
  }
  if (ct.includes('json')) {
    // A bare API endpoint; we do not know its shape.
    results.push({ type: 'extract', confidence: 0.1, platform: 'web', hint: { url: fetched.finalUrl, kind: 'page' }, note: NOTES.unstructured })
    return rank(results)
  }

  // 4. fingerprints
  const meta = extractPageMeta(fetched.body, fetched.finalUrl)
  const origin = new URL(fetched.finalUrl).origin
  if (meta.platformHints.includes('tribe') || (meta.platformHints.includes('wordpress') && /event/i.test(fetched.finalUrl))) {
    if (await probeTribe(origin, ctx)) results.push({ type: 'tribe', confidence: 0.95, platform: 'wordpress', hint: { origin } })
  }
  if (meta.platformHints.includes('squarespace')) {
    const sq = await probeSquarespace(fetched.finalUrl, ctx)
    if (sq?.events) results.push({ type: 'squarespace', confidence: 0.95, platform: 'squarespace', hint: { url: fetched.finalUrl.split('?')[0], tz: sq.tz } })
    else if (sq) results.push({ type: 'squarespace', confidence: 0.4, platform: 'squarespace', hint: { url: fetched.finalUrl.split('?')[0] }, note: 'This is a Squarespace site, but this page is not its events collection. Paste the events page.' })
  }
  if (meta.platformHints.includes('localist') && (await probeLocalist(origin, ctx))) {
    results.push({ type: 'localist', confidence: 0.92, platform: 'localist', hint: { origin, pageUrl: fetched.finalUrl } })
    results.push({ type: 'ics', confidence: 0.6, platform: 'localist', hint: { url: `${origin}/calendar.ics`, pageUrl: fetched.finalUrl } })
  }
  results.push(...fromFingerprints(url, fetched, meta))
  if (results.some((m) => m.confidence >= 0.8)) return rank(results)

  // 5. fallback
  results.push({ type: 'extract', confidence: 0.3, platform: 'web', hint: { url: fetched.finalUrl, kind: 'page', title: meta.title }, note: NOTES.unstructured })
  return rank(results)
}

function rank(matches: DetectMatch[]): DetectMatch[] {
  const seen = new Set<string>()
  return matches
    .sort((a, b) => b.confidence - a.confidence)
    .filter((m) => {
      const k = `${m.type}|${m.platform}|${JSON.stringify(m.hint.url ?? m.hint.calendarId ?? m.hint.origin ?? '')}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
}

/** A short human label for a match, for the console ("Luma calendar", "Meetup group foo"). */
export function describeMatch(m: DetectMatch): string {
  const h = m.hint
  const hostOf = (u: unknown): string => {
    try {
      return typeof u === 'string' ? new URL(u).hostname.replace(/^www\./, '') : ''
    } catch {
      return ''
    }
  }
  const t: SourceType = m.type
  switch (t) {
    case 'gcal-public':
      return h.calendarId ? `Google Calendar ${String(h.calendarId)}` : 'Google Calendar'
    case 'luma':
      return h.kind === 'event' ? 'Luma event' : h.kind === 'user' ? `Luma host ${String(h.slug ?? '')}`.trim() : 'Luma calendar'
    case 'meetup':
      return h.event ? `Meetup event in ${String(h.group)}` : `Meetup group ${String(h.group ?? '')}`.trim()
    case 'tribe':
      return `WordPress events calendar at ${hostOf(h.origin)}`
    case 'squarespace':
      return `Squarespace events at ${hostOf(h.url)}`
    case 'ics':
      return m.platform === 'ics' ? `Calendar feed at ${hostOf(h.url)}` : `${cap(m.platform)} calendar feed`
    case 'jsonld-page':
      return h.list ? `Events listed on ${hostOf(h.url)}` : m.platform === 'web' ? `Event page on ${hostOf(h.url)}` : `${cap(m.platform)} event`
    case 'sheet':
      return 'Google Sheet'
    case 'localist':
      return `Localist calendar at ${hostOf(h.origin ?? h.pageUrl)}`
    case 'mobilize':
      return `Mobilize organisation ${String(h.slug ?? h.organizationId ?? '')}`.trim()
    case 'upload':
      return h.kind === 'ics' ? `Calendar file ${String(h.name ?? '')}`.trim() : `Spreadsheet ${String(h.name ?? '')}`.trim()
    case 'extract':
      return h.kind === 'flyer' ? 'Flyer or image' : h.kind === 'text' ? 'Typed description' : h.kind === 'unsupported' ? `${cap(m.platform)} link (not importable)` : h.kind === 'unreachable' ? 'Unreachable link' : `Page on ${hostOf(h.url)} (needs confirmation)`
    case 'manual':
      return 'Manual entry'
    case 'api':
      return 'API'
    default:
      return cap(t)
  }
}

function cap(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s
}
