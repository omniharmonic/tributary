/**
 * The provenance ladder (PRD §7): listed < email < source < domain.
 *
 *  - `source`: the host proved control of a connected source by placing a token in the
 *    calendar's description or title (the podcast-directory pattern). We re-fetch the
 *    source through its connector and look for the token in what it returns.
 *  - `domain`: an OAuth host whose handle is a domain they control (not one of the
 *    big shared handle providers and not ours).
 */
import { eq } from 'drizzle-orm'
import { connectorFor, defaultWindow, PUSH_SOURCE_TYPES } from '@tributary/connectors'
import { newToken } from '@tributary/identity'
import { config } from '../config.js'
import { getDb } from '../db/index.js'
import { host, source } from '../db/schema.js'
import { recordAudit } from './audit.js'
import { httpClient } from './http-client.js'
import { log } from './logging.js'

export const LEVEL_RANK: Record<string, number> = { listed: 0, email: 1, source: 2, domain: 3 }

const SHARED_HANDLE_DOMAINS = ['bsky.social', 'bsky.team', 'brid.gy', 'threads.net', 'mastodon.social']

export function isOwnDomainHandle(handle: string): boolean {
  const h = handle.toLowerCase()
  if (h.endsWith(`.${config().handleDomain}`)) return false
  if (SHARED_HANDLE_DOMAINS.some((d) => h === d || h.endsWith(`.${d}`))) return false
  return h.split('.').length <= 3 && !h.startsWith('did:')
}

export async function raiseProvenance(hostId: string, level: 'source' | 'domain', actor: string, detail?: Record<string, unknown>): Promise<boolean> {
  const rows = await getDb().select({ level: host.provenanceLevel }).from(host).where(eq(host.id, hostId)).limit(1)
  const current = rows[0]?.level ?? 'email'
  if ((LEVEL_RANK[level] ?? 0) <= (LEVEL_RANK[current] ?? 0)) return false
  await getDb().update(host).set({ provenanceLevel: level }).where(eq(host.id, hostId))
  await recordAudit({ hostId, actor, action: `provenance.${level}`, detail: detail ?? null })
  return true
}

/** Mint (or reuse) the token the host places in the source. It is meant to be public. */
export async function verificationToken(s: typeof source.$inferSelect): Promise<string> {
  const cfg = s.config as Record<string, unknown>
  if (typeof cfg.verifyToken === 'string' && cfg.verifyToken) return cfg.verifyToken
  const token = `tributary-verify-${newToken(9).replace(/[^A-Za-z0-9]/g, '').slice(0, 12).toLowerCase()}`
  await getDb().update(source).set({ config: { ...cfg, verifyToken: token } }).where(eq(source.id, s.id))
  return token
}

/** Re-fetch the source and look for the token in titles, descriptions and the feed title. */
export async function checkVerification(s: typeof source.$inferSelect): Promise<{ verified: boolean; reason?: string }> {
  const token = (s.config as { verifyToken?: string }).verifyToken
  if (!token) return { verified: false, reason: 'no token issued yet' }
  if (PUSH_SOURCE_TYPES.has(s.type)) return { verified: false, reason: 'this kind of source cannot be verified by token; it is already yours' }
  const connector = connectorFor(s.type as never)
  const res = await connector.fetch(s.config, null, { http: httpClient(), secrets: {}, log, window: defaultWindow(), defaultTz: s.tz })
  const hay = [res.meta?.title ?? '', res.meta?.description ?? '', ...res.events.flatMap((e) => [e.name, e.description ?? '', e.location ?? ''])].join('\n').toLowerCase()
  return hay.includes(token.toLowerCase()) ? { verified: true } : { verified: false, reason: 'the token was not found in the feed yet; feeds can take a few minutes to update' }
}
