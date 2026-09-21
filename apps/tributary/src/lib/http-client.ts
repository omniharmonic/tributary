/**
 * The one HTTP client connectors and enrichment receive (`ctx.http`). In development
 * the local PDS/Photon sit on loopback, which the SSRF policy would refuse; the
 * `PDS_ALLOW_PRIVATE` flag opens ONLY that door.
 */
import { http as baseHttp, type HttpClient, type SafeFetchOptions } from '@tributary/ssrf-fetch'
import { config } from '../config.js'

export function httpClient(): HttpClient {
  const c = config()
  if (!c.PDS_ALLOW_PRIVATE) return baseHttp
  const allow = (url: string, opts?: Omit<SafeFetchOptions, 'method' | 'body'>) => {
    let priv = false
    try {
      const u = new URL(url)
      priv = u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === 'host.docker.internal'
    } catch {
      /* let safeFetch reject it */
    }
    return { ...opts, allowPrivate: priv }
  }
  return {
    get: (url, opts) => baseHttp.get(url, allow(url, opts)),
    head: (url, opts) => baseHttp.head(url, allow(url, opts)),
    getPage: (url, opts) => baseHttp.getPage(url, allow(url, opts)),
  }
}
