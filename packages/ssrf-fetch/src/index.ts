/**
 * SSRF-safe, polite HTTP for user-supplied URLs (architecture §15).
 *
 *  - https and http only; `webcal://` rewritten to https
 *  - DNS resolved once per hop, every address checked against private, loopback,
 *    link-local, multicast, and cloud-metadata ranges, and the socket pinned to the
 *    checked address (undici `connect.lookup`), so a DNS rebind cannot slip through
 *  - redirects followed by hand, re-checked per hop, at most 5
 *  - size and time caps; no credentials forwarded; an identifying user agent
 *  - per-host politeness: a minimum spacing between requests to the same host
 *  - conditional GET helpers (ETag / Last-Modified) and a small robots.txt check for
 *    page fetches (feeds are published interfaces and skip robots)
 *
 * Nothing else in the monorepo imports `undici`, `http` or `https` directly.
 */
import { lookup as dnsLookup } from 'node:dns/promises'
import ipaddr from 'ipaddr.js'
import { Agent, request as undiciRequest, type Dispatcher } from 'undici'

export const USER_AGENT = process.env.TRIBUTARY_USER_AGENT ?? 'TributaryBot/0.1 (+https://tributary.freeskool.directory/about/crawler; events adapter)'

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeUrlError'
  }
}
export class FetchLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FetchLimitError'
  }
}
export class RobotsDisallowedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RobotsDisallowedError'
  }
}

export interface SafeFetchOptions {
  method?: 'GET' | 'HEAD' | 'POST'
  headers?: Record<string, string>
  body?: string
  /** Bytes. Default 10 MB. */
  maxBytes?: number
  /** Milliseconds for the whole exchange. Default 20 s. */
  timeoutMs?: number
  maxRedirects?: number
  /** Conditional GET. */
  etag?: string
  lastModified?: string
  /** Check robots.txt for this path first (page fetches). Default false (feeds). */
  respectRobots?: boolean
  /** Skip the private-range check: tests and local development against a local PDS. */
  allowPrivate?: boolean
  signal?: AbortSignal
}

export interface SafeResponse {
  url: string
  status: number
  headers: Record<string, string>
  body: Buffer
  text(): string
  contentType: string | undefined
  etag?: string
  lastModified?: string
  notModified: boolean
}

const PRIVATE_RANGES = ['unspecified', 'broadcast', 'multicast', 'linkLocal', 'loopback', 'private', 'uniqueLocal', 'carrierGradeNat', 'reserved'] as const

export function isPublicAddress(address: string): boolean {
  let addr: ipaddr.IPv4 | ipaddr.IPv6
  try {
    addr = ipaddr.parse(address)
  } catch {
    return false
  }
  if (addr.kind() === 'ipv6' && (addr as ipaddr.IPv6).isIPv4MappedAddress()) addr = (addr as ipaddr.IPv6).toIPv4Address()
  const range = addr.range()
  if ((PRIVATE_RANGES as readonly string[]).includes(range)) return false
  // Cloud metadata endpoints, explicitly.
  const s = addr.toString()
  if (s === '169.254.169.254' || s === 'fd00:ec2::254' || s.startsWith('100.100.100.')) return false
  return true
}

export function normalizeUrl(input: string): URL {
  let u: URL
  try {
    u = new URL(input.trim().replace(/^webcal:\/\//i, 'https://'))
  } catch {
    throw new UnsafeUrlError('not a URL')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new UnsafeUrlError(`scheme ${u.protocol} not allowed`)
  if (u.username || u.password) throw new UnsafeUrlError('credentials in URL not allowed')
  if (!u.hostname) throw new UnsafeUrlError('no host')
  const host = u.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw new UnsafeUrlError('local host not allowed')
  return u
}

async function resolvePinned(hostname: string, allowPrivate: boolean): Promise<string> {
  const bare = hostname.replace(/^\[|\]$/g, '')
  if (ipaddr.isValid(bare)) {
    if (!allowPrivate && !isPublicAddress(bare)) throw new UnsafeUrlError('address is not public')
    return bare
  }
  const results = await dnsLookup(bare, { all: true, verbatim: true }).catch(() => [])
  if (results.length === 0) throw new UnsafeUrlError('host does not resolve')
  for (const r of results) {
    if (!allowPrivate && !isPublicAddress(r.address)) throw new UnsafeUrlError('host resolves to a non-public address')
  }
  return results[0]!.address
}

/** One undici Agent per pinned address, cached briefly. */
const agents = new Map<string, { agent: Agent; at: number }>()
function agentFor(address: string, hostname: string): Agent {
  const key = `${address}|${hostname}`
  const hit = agents.get(key)
  if (hit && Date.now() - hit.at < 60_000) return hit.agent
  const agent = new Agent({
    connect: {
      lookup: (_host, _opts, cb) => cb(null, [{ address, family: address.includes(':') ? 6 : 4 }] as never),
      servername: hostname,
      timeout: 10_000,
    },
    headersTimeout: 15_000,
    bodyTimeout: 20_000,
  })
  agents.set(key, { agent, at: Date.now() })
  if (agents.size > 200) {
    const oldest = [...agents.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (oldest) {
      void oldest[1].agent.close()
      agents.delete(oldest[0])
    }
  }
  return agent
}

/* politeness: minimum spacing per host */
const lastRequestAt = new Map<string, number>()
const MIN_SPACING_MS = Number(process.env.TRIBUTARY_MIN_SPACING_MS ?? 1000)
const waiters = new Map<string, Promise<void>>()

async function politeWait(host: string): Promise<void> {
  const prev = waiters.get(host) ?? Promise.resolve()
  const mine = prev.then(async () => {
    const last = lastRequestAt.get(host) ?? 0
    const wait = last + MIN_SPACING_MS - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastRequestAt.set(host, Date.now())
  })
  waiters.set(host, mine.catch(() => {}))
  await mine
}

/* robots.txt (page fetches only) */
const robotsCache = new Map<string, { rules: Array<{ allow: boolean; path: string }>; at: number }>()

async function robotsAllows(u: URL, opts: SafeFetchOptions): Promise<boolean> {
  const origin = u.origin
  let entry = robotsCache.get(origin)
  if (!entry || Date.now() - entry.at > 6 * 3_600_000) {
    let rules: Array<{ allow: boolean; path: string }> = []
    try {
      const res = await safeFetch(`${origin}/robots.txt`, { ...opts, respectRobots: false, maxBytes: 200_000, timeoutMs: 8000 })
      if (res.status === 200) rules = parseRobots(res.text())
    } catch {
      rules = []
    }
    entry = { rules, at: Date.now() }
    robotsCache.set(origin, entry)
  }
  const path = u.pathname + u.search
  // Longest match wins, allow beats disallow on ties (Google's semantics).
  let best: { allow: boolean; path: string } | undefined
  for (const r of entry.rules) {
    if (path.startsWith(r.path) || r.path === '') {
      if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r
    }
  }
  return best ? best.allow : true
}

export function parseRobots(text: string): Array<{ allow: boolean; path: string }> {
  const rules: Array<{ allow: boolean; path: string }> = []
  let applies = false
  let sawSpecific = false
  const specific: Array<{ allow: boolean; path: string }> = []
  const generic: Array<{ allow: boolean; path: string }> = []
  let current: Array<{ allow: boolean; path: string }> | null = null
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line)
    if (!m) continue
    const key = m[1]!.toLowerCase()
    const val = m[2]!.trim()
    if (key === 'user-agent') {
      const ua = val.toLowerCase()
      if (ua === 'tributarybot' || ua === 'tributary') {
        current = specific
        sawSpecific = true
        applies = true
      } else if (ua === '*') {
        current = generic
        applies = true
      } else {
        current = null
        applies = false
      }
    } else if (applies && current && (key === 'disallow' || key === 'allow')) {
      if (key === 'disallow' && val === '') continue
      current.push({ allow: key === 'allow', path: val.replace(/\*$/, '') })
    }
  }
  rules.push(...(sawSpecific ? specific : generic))
  return rules
}

/** The one fetch. */
export async function safeFetch(input: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  const maxBytes = opts.maxBytes ?? 10 * 1024 * 1024
  const timeoutMs = opts.timeoutMs ?? 20_000
  const maxRedirects = opts.maxRedirects ?? 5
  const allowPrivate = opts.allowPrivate ?? process.env.TRIBUTARY_ALLOW_PRIVATE_FETCH === '1'
  const deadline = Date.now() + timeoutMs
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  if (opts.signal) opts.signal.addEventListener('abort', () => ac.abort(), { once: true })

  try {
    let u = normalizeUrl(input)
    if (opts.respectRobots && !(await robotsAllows(u, opts))) throw new RobotsDisallowedError('disallowed by robots.txt')
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const address = await resolvePinned(u.hostname, allowPrivate)
      await politeWait(u.hostname)
      const dispatcher: Dispatcher = agentFor(address, u.hostname)
      const headers: Record<string, string> = {
        'user-agent': USER_AGENT,
        accept: opts.headers?.accept ?? 'text/calendar, application/json, text/html;q=0.9, */*;q=0.5',
        'accept-language': 'en-US,en;q=0.8',
        ...(opts.headers ?? {}),
      }
      if (opts.etag) headers['if-none-match'] = opts.etag
      if (opts.lastModified) headers['if-modified-since'] = opts.lastModified
      const res = await undiciRequest(u, {
        method: opts.method ?? 'GET',
        headers,
        body: opts.body,
        dispatcher,
        signal: ac.signal,
        headersTimeout: Math.max(1000, deadline - Date.now()),
        bodyTimeout: Math.max(1000, deadline - Date.now()),
      })
      const status = res.statusCode
      const flat: Record<string, string> = {}
      for (const [k, v] of Object.entries(res.headers)) flat[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : (v ?? '')

      if ([301, 302, 303, 307, 308].includes(status) && flat.location) {
        await res.body.dump().catch(() => {})
        if (hop === maxRedirects) throw new FetchLimitError('too many redirects')
        const next = new URL(flat.location, u)
        u = normalizeUrl(next.toString())
        if (status === 303 || ((status === 301 || status === 302) && opts.method === 'POST')) opts = { ...opts, method: 'GET', body: undefined }
        continue
      }

      const declared = Number(flat['content-length'] ?? 0)
      if (declared > maxBytes) {
        await res.body.dump().catch(() => {})
        throw new FetchLimitError(`response too large (${declared} bytes)`)
      }
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of res.body) {
        const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        size += b.length
        if (size > maxBytes) {
          res.body.destroy()
          throw new FetchLimitError(`response too large (>${maxBytes} bytes)`)
        }
        chunks.push(b)
      }
      const body = Buffer.concat(chunks)
      let text: string | undefined
      return {
        url: u.toString(),
        status,
        headers: flat,
        body,
        text: () => (text ??= decode(body, flat['content-type'])),
        contentType: flat['content-type']?.split(';')[0]?.trim().toLowerCase(),
        etag: flat.etag,
        lastModified: flat['last-modified'],
        notModified: status === 304,
      }
    }
    throw new FetchLimitError('too many redirects')
  } finally {
    clearTimeout(timer)
  }
}

function decode(body: Buffer, contentType: string | undefined): string {
  const m = /charset=([^;]+)/i.exec(contentType ?? '')
  const cs = m?.[1]?.trim().toLowerCase().replace(/^"|"$/g, '')
  if (cs && cs !== 'utf-8' && cs !== 'utf8') {
    try {
      return new TextDecoder(cs).decode(body)
    } catch {
      /* fall through */
    }
  }
  return body.toString('utf8')
}

/** A tiny client interface handed to connectors as `ctx.http`. */
export interface HttpClient {
  get(url: string, opts?: Omit<SafeFetchOptions, 'method' | 'body'>): Promise<SafeResponse>
  head(url: string, opts?: Omit<SafeFetchOptions, 'method' | 'body'>): Promise<SafeResponse>
  getPage(url: string, opts?: Omit<SafeFetchOptions, 'method' | 'body'>): Promise<SafeResponse>
}

export const http: HttpClient = {
  get: (url, opts) => safeFetch(url, { ...opts, method: 'GET' }),
  head: (url, opts) => safeFetch(url, { ...opts, method: 'HEAD', maxBytes: 1 }),
  /** Page fetches honour robots.txt and ask for HTML. */
  getPage: (url, opts) =>
    safeFetch(url, {
      ...opts,
      method: 'GET',
      respectRobots: true,
      headers: { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', ...(opts?.headers ?? {}) },
      maxBytes: opts?.maxBytes ?? 3 * 1024 * 1024,
    }),
}
