/**
 * Cookie sessions: the cookie is `<id>.<hmac>`; the session row is the truth.
 */
import { and, eq, gt } from 'drizzle-orm'
import { newSessionId, signSessionId, verifySessionCookie } from '@tributary/identity'
import { config } from '../config.js'
import { getDb } from '../db/index.js'
import { session } from '../db/schema.js'
import { getHost, type HostRow } from './hosts.js'

export const SESSION_COOKIE = 'tb_session'

export async function createSession(hostId: string): Promise<{ cookie: string; expiresAt: Date }> {
  const c = config()
  const id = newSessionId()
  const expiresAt = new Date(Date.now() + c.SESSION_TTL_DAYS * 86_400_000)
  await getDb().insert(session).values({ id, hostId, expiresAt })
  return { cookie: signSessionId(id, c.SESSION_SECRET), expiresAt }
}

export async function hostForCookie(cookie: string | undefined): Promise<HostRow | null> {
  if (!cookie) return null
  const id = verifySessionCookie(cookie, config().SESSION_SECRET)
  if (!id) return null
  const rows = await getDb()
    .select()
    .from(session)
    .where(and(eq(session.id, id), gt(session.expiresAt, new Date())))
    .limit(1)
  const s = rows[0]
  if (!s) return null
  return getHost(s.hostId)
}

export async function destroySession(cookie: string | undefined): Promise<void> {
  if (!cookie) return
  const id = verifySessionCookie(cookie, config().SESSION_SECRET)
  if (id) await getDb().delete(session).where(eq(session.id, id))
}

export function cookieHeader(cookie: string, expiresAt: Date): string {
  const secure = config().WEB_PUBLIC_URL.startsWith('https://') ? '; Secure' : ''
  return `${SESSION_COOKIE}=${cookie}; Path=/; HttpOnly; SameSite=Lax${secure}; Expires=${expiresAt.toUTCString()}`
}

export function clearCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}
