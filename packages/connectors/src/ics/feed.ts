/**
 * Shared "fetch an ICS URL and parse it" step for every ICS-family connector, with
 * conditional GET and the error mapping the console shows in plain language.
 */
import type { RawEvent } from '@tributary/event-model'
import { ConnectorError, type FetchCtx, type FetchResult } from '../sdk.js'
import { parseIcs, type ParseIcsResult } from './parse.js'

export function normalizeFeedUrl(url: string): string {
  const s = url.trim().replace(/^webcal:\/\//i, 'https://')
  const u = new URL(s)
  u.hash = ''
  return u.toString()
}

export function looksLikeIcs(body: string): boolean {
  return /^\s*BEGIN:VCALENDAR/i.test(body.slice(0, 200))
}

export async function fetchIcsFeed(
  url: string,
  ctx: FetchCtx,
  opts: { conditional?: boolean; maxBytes?: number } = {},
): Promise<{ text: string; etag?: string; lastModified?: string; notModified: boolean; finalUrl: string }> {
  let res
  try {
    res = await ctx.http.get(url, {
      headers: { accept: 'text/calendar, text/plain;q=0.8, */*;q=0.5' },
      ...(opts.conditional !== false && ctx.etag ? { etag: ctx.etag } : {}),
      ...(opts.conditional !== false && ctx.lastModified ? { lastModified: ctx.lastModified } : {}),
      maxBytes: opts.maxBytes ?? 8 * 1024 * 1024,
    })
  } catch (err) {
    const name = err instanceof Error ? err.name : ''
    if (name === 'FetchLimitError') throw new ConnectorError('the calendar feed is too large to read', 'TooLarge', false)
    if (name === 'UnsafeUrlError') throw new ConnectorError('that address cannot be fetched', 'Unsupported', false)
    throw new ConnectorError('could not reach the calendar feed', 'Network', true)
  }
  if (res.notModified) return { text: '', notModified: true, finalUrl: res.url, etag: ctx.etag, lastModified: ctx.lastModified }
  if (res.status === 404 || res.status === 410) throw new ConnectorError('the calendar feed is gone (404). If it was a Google Calendar, it may no longer be public.', res.status === 410 ? 'Gone' : 'NotFound', true)
  if (res.status === 401 || res.status === 403) throw new ConnectorError('the calendar feed is not public', 'Forbidden', true)
  if (res.status === 429) throw new ConnectorError('the calendar host asked us to slow down', 'RateLimited', true)
  if (res.status >= 500) throw new ConnectorError('the calendar host is having trouble', 'Network', true)
  if (res.status !== 200) throw new ConnectorError(`unexpected response ${res.status} from the calendar feed`, 'Other', true)
  const text = res.text()
  if (!looksLikeIcs(text)) {
    throw new ConnectorError('that address did not return a calendar feed', 'Unparseable', false)
  }
  return { text, etag: res.etag, lastModified: res.lastModified, notModified: false, finalUrl: res.url }
}

/** Turn a parse result into the runtime's FetchResult shape. */
export function toFetchResult(parsed: ParseIcsResult, extra: { etag?: string; lastModified?: string; url?: string }, map?: (e: RawEvent) => RawEvent): FetchResult<null> {
  const events = map ? parsed.events.map(map) : parsed.events
  return {
    events,
    cursor: null,
    complete: parsed.complete,
    window: parsed.window,
    etag: extra.etag,
    lastModified: extra.lastModified,
    meta: { title: parsed.meta.title, description: parsed.meta.description, tz: parsed.meta.tz, url: extra.url ?? parsed.meta.url },
  }
}

export async function fetchAndParse(url: string, ctx: FetchCtx, map?: (e: RawEvent) => RawEvent): Promise<FetchResult<null>> {
  const feed = await fetchIcsFeed(url, ctx)
  if (feed.notModified) return { events: [], cursor: null, complete: false, notModified: true, etag: feed.etag, lastModified: feed.lastModified }
  const parsed = parseIcs(feed.text, { window: ctx.window, defaultTz: ctx.defaultTz })
  return toFetchResult(parsed, { etag: feed.etag, lastModified: feed.lastModified, url }, map)
}
