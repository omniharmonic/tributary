/**
 * `gcal-public` — a public Google Calendar (architecture §4.1). The calendar id comes
 * from an ICS URL, an embed `src=`, a `cid=` link (base64url of the id, often unpadded)
 * or a bare calendar address. With `GOOGLE_API_KEY` the Calendar API is read with
 * `singleEvents=true&showDeleted=true` and a `syncToken` cursor; without a key the
 * public `basic.ics` is read through the ICS parser.
 */
import { DateTime } from 'luxon'
import type { RawEvent, SourcePrivacy } from '@tributary/event-model'
import { ConnectorError, MINUTE, type Connector, type DetectInput, type DetectMatch, type FetchCtx, type FetchResult } from '../sdk.js'
import { fetchAndParse } from '../ics/feed.js'

export interface GcalConfig {
  calendarId: string
  tz?: string
  title?: string
}

export interface GcalCursor {
  syncToken: string
}

const GCAL_ID = /^[A-Za-z0-9._%+-]+@(?:group\.calendar\.google\.com|gmail\.com|googlemail\.com|[A-Za-z0-9.-]+\.[A-Za-z]{2,})$/

export function decodeCid(cid: string): string | undefined {
  try {
    const b64 = cid.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const decoded = Buffer.from(padded, 'base64').toString('utf8')
    return decoded && /^[\x20-\x7e]+$/.test(decoded) ? decoded : undefined
  } catch {
    return undefined
  }
}

/** Resolve a Google Calendar id from any of the spellings a host might paste. */
export function calendarIdFrom(input: string): string | undefined {
  const s = input.trim()
  if (GCAL_ID.test(s)) return s
  // Embed code: <iframe src="https://calendar.google.com/calendar/embed?src=...">
  const src = /src\s*=\s*["']?(https?:\/\/calendar\.google\.com[^"'\s>]+)/i.exec(s)?.[1]
  const candidate = src ?? s
  let u: URL
  try {
    u = new URL(candidate.replace(/^webcal:\/\//i, 'https://'))
  } catch {
    return undefined
  }
  if (!/(^|\.)calendar\.google\.com$/i.test(u.hostname)) return undefined
  const ical = /\/calendar\/ical\/([^/]+)\//.exec(u.pathname)?.[1]
  if (ical) return decodeURIComponent(ical)
  const srcParam = u.searchParams.get('src')
  if (srcParam) return decodeURIComponent(srcParam)
  const cid = u.searchParams.get('cid')
  if (cid) {
    const decoded = decodeCid(cid)
    if (decoded) return decoded
    // Some cid links carry the address directly.
    if (GCAL_ID.test(cid)) return cid
  }
  return undefined
}

export function publicIcsUrl(calendarId: string): string {
  return `https://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`
}

interface ApiEvent {
  id: string
  status?: string
  summary?: string
  description?: string
  location?: string
  htmlLink?: string
  hangoutLink?: string
  visibility?: string
  sequence?: number
  updated?: string
  recurringEventId?: string
  originalStartTime?: { date?: string; dateTime?: string; timeZone?: string }
  start?: { date?: string; dateTime?: string; timeZone?: string }
  end?: { date?: string; dateTime?: string; timeZone?: string }
  organizer?: { displayName?: string; email?: string }
  attachments?: Array<{ fileUrl?: string; mimeType?: string }>
}

function apiEventToRaw(e: ApiEvent, feedTz: string | undefined): RawEvent | null {
  if (!e.summary && e.status !== 'cancelled') return null
  const allDay = !!e.start?.date
  const start = e.start?.dateTime ?? e.start?.date
  if (!start) return null
  const tz = e.start?.timeZone ?? feedTz
  const raw: RawEvent = {
    externalId: e.recurringEventId ?? e.id,
    name: e.summary ?? '(cancelled)',
    start,
    ...(e.end?.dateTime || e.end?.date ? { end: e.end.dateTime ?? e.end.date! } : {}),
    ...(tz ? { tz } : {}),
    ...(allDay ? { allDay: true } : {}),
  }
  if (e.recurringEventId) {
    const orig = e.originalStartTime?.dateTime ?? e.originalStartTime?.date
    if (orig) {
      const dt = DateTime.fromISO(orig, { zone: e.originalStartTime?.timeZone ?? tz ?? 'utc' })
      if (dt.isValid) raw.occurrence = dt.toUTC().toISO()!
    }
    raw.seriesKey = e.recurringEventId
  }
  if (e.status === 'cancelled') raw.status = 'cancelled'
  if (e.description) {
    raw.description = e.description
    raw.descriptionIsHtml = /<(p|br|a|div|ul|ol|li|b|i|strong|em|span)\b/i.test(e.description)
  }
  // The conference link is surfaced so the normalizer can gate it; never dropped silently.
  if (e.hangoutLink) raw.description = `${raw.description ?? ''}\n\nJoin: ${e.hangoutLink}`.trim()
  if (e.location) raw.location = e.location
  if (e.htmlLink) raw.url = e.htmlLink
  if (e.organizer?.displayName) raw.organizerName = e.organizer.displayName
  const vis = e.visibility?.toLowerCase()
  if (vis === 'private' || vis === 'confidential') raw.sourcePrivacy = vis as SourcePrivacy
  else if (vis === 'public') raw.sourcePrivacy = 'public'
  if (typeof e.sequence === 'number') raw.sequence = e.sequence
  if (e.updated) raw.lastModified = e.updated
  const img = e.attachments?.find((a) => a.mimeType?.startsWith('image/') && a.fileUrl)?.fileUrl
  if (img) raw.imageUrl = img
  return raw
}

async function fetchViaApi(cfg: GcalConfig, cursor: GcalCursor | null, ctx: FetchCtx, key: string): Promise<FetchResult<GcalCursor>> {
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cfg.calendarId)}/events`
  const events: RawEvent[] = []
  let pageToken: string | undefined
  let nextSync: string | undefined
  let feedTz: string | undefined = cfg.tz
  let tokenExpired = false
  for (let page = 0; page < 20; page++) {
    const u = new URL(base)
    u.searchParams.set('key', key)
    u.searchParams.set('singleEvents', 'true')
    u.searchParams.set('showDeleted', 'true')
    u.searchParams.set('maxResults', '250')
    if (cursor?.syncToken && !tokenExpired) u.searchParams.set('syncToken', cursor.syncToken)
    else {
      u.searchParams.set('timeMin', ctx.window.from.toISOString())
      u.searchParams.set('timeMax', ctx.window.to.toISOString())
    }
    if (pageToken) u.searchParams.set('pageToken', pageToken)
    const res = await ctx.http.get(u.toString(), { headers: { accept: 'application/json' } })
    if (res.status === 410 && cursor?.syncToken && !tokenExpired) {
      // Sync token expired: full resync.
      tokenExpired = true
      page = -1
      events.length = 0
      continue
    }
    if (res.status === 404) throw new ConnectorError('that Google Calendar is not public or does not exist', 'NotFound', true)
    if (res.status === 403) throw new ConnectorError('Google refused the request (quota or key)', 'Forbidden', true)
    if (res.status !== 200) throw new ConnectorError(`Google Calendar API answered ${res.status}`, 'Network', true)
    const body = JSON.parse(res.text()) as { items?: ApiEvent[]; nextPageToken?: string; nextSyncToken?: string; timeZone?: string; summary?: string }
    feedTz ??= body.timeZone
    for (const item of body.items ?? []) {
      const raw = apiEventToRaw(item, feedTz)
      if (raw) events.push(raw)
    }
    if (body.nextPageToken) {
      pageToken = body.nextPageToken
      continue
    }
    nextSync = body.nextSyncToken
    break
  }
  const incremental = !!cursor?.syncToken && !tokenExpired
  return {
    events,
    cursor: nextSync ? { syncToken: nextSync } : cursor,
    // An incremental page lists only changes; only a full read is the complete set.
    complete: !incremental,
    window: incremental ? undefined : { from: ctx.window.from, to: ctx.window.to },
    meta: { tz: feedTz },
  }
}

export const gcalPublicConnector: Connector<GcalConfig, GcalCursor> = {
  type: 'gcal-public',
  platform: 'google',
  capabilities: { live: 'poll', delta: true, explicitDeletes: true, images: 'none', requiresAuth: 'none' },
  defaultInterval: 15 * MINUTE,

  async detect(input: DetectInput): Promise<DetectMatch | null> {
    const text = input.text?.trim() ?? ''
    const id = calendarIdFrom(text) ?? (input.url ? calendarIdFrom(input.url.toString()) : undefined)
    if (!id) return null
    return { type: 'gcal-public', confidence: 0.97, platform: 'google', hint: { calendarId: id } }
  },

  async configure(input, ctx): Promise<GcalConfig> {
    const hint = 'hint' in input ? (input as DetectMatch).hint : (input as Record<string, unknown>)
    const calendarId = typeof hint.calendarId === 'string' ? hint.calendarId : typeof hint.url === 'string' ? calendarIdFrom(hint.url) : undefined
    if (!calendarId) throw new ConnectorError('no Google Calendar id', 'Unsupported', false)
    // Confirm it is public by reading the ICS once (the API path needs a key we may not have).
    const probeCtx: FetchCtx = { http: ctx.http, log: ctx.log, secrets: {}, window: { from: new Date(), to: new Date(Date.now() + 1) }, defaultTz: 'UTC' }
    const res = await fetchAndParse(publicIcsUrl(calendarId), probeCtx)
    const cfg: GcalConfig = { calendarId }
    if (res.meta?.tz && res.meta.tz !== 'UTC') cfg.tz = res.meta.tz
    if (res.meta?.title) cfg.title = res.meta.title
    return cfg
  },

  async fetch(cfg, cursor, ctx) {
    const key = ctx.secrets.GOOGLE_API_KEY
    if (key) return fetchViaApi(cfg, cursor, ctx, key)
    const r = await fetchAndParse(publicIcsUrl(cfg.calendarId), { ...ctx, defaultTz: cfg.tz ?? ctx.defaultTz })
    return { ...r, cursor: null }
  },

  fingerprint(cfg) {
    return `gcal:${cfg.calendarId.toLowerCase()}`
  },

  label(cfg) {
    return cfg.title ? `${cfg.title} (Google Calendar)` : `Google Calendar ${cfg.calendarId}`
  },
}
