/**
 * Request helpers: the closed error vocabulary from docs/api.md, session and API-key
 * authentication, CSRF for cookie sessions.
 */
import type { Context, MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import { and, eq, isNull } from 'drizzle-orm'
import { hashToken } from '@tributary/identity'
import { getDb } from '../db/index.js'
import { apiKey } from '../db/schema.js'
import { getHost, type HostRow } from '../lib/hosts.js'
import { hostForCookie, SESSION_COOKIE } from '../lib/sessions.js'

export type ErrorCode = 'InvalidInput' | 'NotFound' | 'Unauthorized' | 'Forbidden' | 'RateLimited' | 'SourceUnreachable' | 'SourceUnsupported' | 'NeedsConfirmation' | 'Conflict' | 'PdsRejected' | 'Internal'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const notFound = () => new ApiError(404, 'NotFound', 'Not found.')
export const unauthorized = () => new ApiError(401, 'Unauthorized', 'Sign in to do that.')

export type Vars = { host?: HostRow; auth?: 'session' | 'apikey' | 'none' }
export type AppContext = Context<{ Variables: Vars }>

const CSRF_HEADER = 'x-requested-with'

/** Resolve the caller. Cookie sessions on state-changing requests must carry the CSRF header. */
export const authenticate: MiddlewareHandler<{ Variables: Vars }> = async (c, next) => {
  const auth = c.req.header('authorization')
  if (auth?.startsWith('Bearer tb_')) {
    const key = auth.slice('Bearer '.length).trim()
    const rows = await getDb()
      .select()
      .from(apiKey)
      .where(and(eq(apiKey.keyHash, hashToken(key)), isNull(apiKey.revokedAt)))
      .limit(1)
    const k = rows[0]
    if (k) {
      const h = await getHost(k.hostId)
      if (h) {
        c.set('host', h)
        c.set('auth', 'apikey')
        void getDb().update(apiKey).set({ lastUsedAt: new Date() }).where(eq(apiKey.id, k.id))
        return next()
      }
    }
    throw unauthorized()
  }
  const cookie = getCookie(c, SESSION_COOKIE)
  if (cookie) {
    const h = await hostForCookie(cookie)
    if (h) {
      if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.header(CSRF_HEADER) !== 'tributary') {
        throw new ApiError(403, 'Forbidden', 'Missing the X-Requested-With header.')
      }
      c.set('host', h)
      c.set('auth', 'session')
      return next()
    }
  }
  c.set('auth', 'none')
  return next()
}

export function requireHost(c: AppContext): HostRow {
  const h = c.get('host')
  if (!h) throw unauthorized()
  return h
}

export async function body<T = Record<string, unknown>>(c: AppContext): Promise<T> {
  try {
    return (await c.req.json()) as T
  } catch {
    throw new ApiError(400, 'InvalidInput', 'Expected a JSON body.')
  }
}

export function str(v: unknown, name: string, opts: { max?: number; optional?: boolean } = {}): string {
  if (v === undefined || v === null || v === '') {
    if (opts.optional) return ''
    throw new ApiError(400, 'InvalidInput', `${name} is required.`)
  }
  if (typeof v !== 'string') throw new ApiError(400, 'InvalidInput', `${name} must be a string.`)
  if (opts.max && v.length > opts.max) throw new ApiError(400, 'InvalidInput', `${name} is too long.`)
  return v
}

/** In-memory rate limit for anonymous routes: per key, N per window. */
const buckets = new Map<string, { n: number; reset: number }>()
export function rateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowMs })
    return
  }
  b.n++
  if (b.n > limit) throw new ApiError(429, 'RateLimited', 'Too many requests. Try again in a minute.')
  if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k)
}

export function clientIp(c: AppContext): string {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip') ?? 'local'
}
