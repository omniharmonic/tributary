/** A map-backed `HttpClient` for tests: URL → { contentType, body, status }. No network. */
import type { HttpClient, SafeResponse } from '@tributary/ssrf-fetch'
import type { FetchCtx } from '../src/sdk.js'

export interface MockRoute {
  contentType?: string
  body: string
  status?: number
  finalUrl?: string
}

export function mockHttp(routes: Record<string, MockRoute>, calls: string[] = []): HttpClient {
  const respond = async (url: string): Promise<SafeResponse> => {
    calls.push(url)
    const r = routes[url]
    if (!r) throw new Error(`mock: no route for ${url}`)
    const text = r.body
    return {
      url: r.finalUrl ?? url,
      status: r.status ?? 200,
      headers: { 'content-type': r.contentType ?? 'text/html' },
      body: Buffer.from(text),
      text: () => text,
      contentType: r.contentType ?? 'text/html',
      notModified: false,
    }
  }
  return { get: respond, head: respond, getPage: respond }
}

export const log = { info: () => {}, warn: () => {} }

export function fetchCtx(http: HttpClient, extra: Partial<FetchCtx> = {}): FetchCtx {
  return {
    http,
    secrets: {},
    log,
    window: { from: new Date('2026-09-20T00:00:00Z'), to: new Date('2026-12-20T00:00:00Z') },
    defaultTz: 'America/Denver',
    ...extra,
  }
}
