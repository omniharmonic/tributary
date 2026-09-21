/** A scripted `ctx.http` for connector tests: no sockets, exact URL → response. */
import type { HttpClient, SafeResponse } from '@tributary/ssrf-fetch'
import type { FetchCtx } from '../src/sdk.js'

export interface Scripted {
  status?: number
  body?: string
  contentType?: string
  etag?: string
  lastModified?: string
  /** Answer 304 when the request carries this etag. */
  notModifiedFor?: string
}

export function mockHttp(routes: Record<string, Scripted | ((url: string, opts: Record<string, unknown>) => Scripted)>): HttpClient & { calls: Array<{ url: string; opts: Record<string, unknown> }> } {
  const calls: Array<{ url: string; opts: Record<string, unknown> }> = []
  const answer = async (url: string, opts: Record<string, unknown> = {}): Promise<SafeResponse> => {
    calls.push({ url, opts })
    const key = Object.keys(routes).find((k) => (k.endsWith('*') ? url.startsWith(k.slice(0, -1)) : url === k))
    const route = key ? routes[key]! : undefined
    const s: Scripted = route ? (typeof route === 'function' ? route(url, opts) : route) : { status: 404, body: 'not found', contentType: 'text/plain' }
    const notModified = !!s.notModifiedFor && opts.etag === s.notModifiedFor
    const body = Buffer.from(notModified ? '' : (s.body ?? ''))
    return {
      url,
      status: notModified ? 304 : (s.status ?? 200),
      headers: {},
      body,
      text: () => body.toString('utf8'),
      contentType: s.contentType ?? (s.body?.startsWith('BEGIN:VCALENDAR') ? 'text/calendar' : 'text/html'),
      etag: s.etag,
      lastModified: s.lastModified,
      notModified,
    }
  }
  return { calls, get: answer, head: answer, getPage: answer }
}

export function ctxWith(http: HttpClient, extra: Partial<FetchCtx> = {}): FetchCtx {
  const now = new Date('2026-09-21T00:00:00Z')
  return {
    http,
    secrets: {},
    log: { info() {}, warn() {} },
    window: { from: new Date(now.getTime() - 86_400_000), to: new Date(now.getTime() + 90 * 86_400_000) },
    defaultTz: 'America/Denver',
    ...extra,
  }
}

export const MINIMAL_ICS = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//t//t//EN\r\nX-WR-CALNAME:Test Feed\r\nX-WR-TIMEZONE:America/Denver\r\nBEGIN:VEVENT\r\nUID:one@test\r\nDTSTAMP:20260921T000000Z\r\nDTSTART:20261001T160000Z\r\nDTEND:20261001T170000Z\r\nSUMMARY:One\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`
