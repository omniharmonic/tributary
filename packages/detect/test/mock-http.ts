/** A map-backed `HttpClient` for tests: URL → { contentType, body, status }. No network. */
import type { HttpClient, SafeResponse } from '@tributary/ssrf-fetch'

export interface MockRoute {
  contentType?: string
  body: string
  status?: number
  finalUrl?: string
}

export function mockHttp(routes: Record<string, MockRoute>, calls: string[] = []): HttpClient {
  const respond = async (url: string): Promise<SafeResponse> => {
    calls.push(url)
    const key = Object.keys(routes).find((k) => k === url || url === k.replace(/^webcal:/, 'https:'))
    const r = key ? routes[key] : undefined
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
