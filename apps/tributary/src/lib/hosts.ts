/**
 * Hosts and the credentials we write with. The app password (Door B) or OAuth session
 * (Door A) is the only thing that can write into a host's repo; it is wrapped with a
 * versioned key held outside the database.
 */
import { eq } from 'drizzle-orm'
import { unwrapSecret, wrapSecret } from '@tributary/identity'
import { appPasswordWriter, forgetSession, type RepoWriter } from '@tributary/publisher'
import { config } from '../config.js'
import { getDb } from '../db/index.js'
import { credential, host } from '../db/schema.js'
import { oauthWriterFor } from './oauth.js'

export type HostRow = typeof host.$inferSelect

export class HostPausedError extends Error {
  constructor(readonly reason: string) {
    super(`host paused: ${reason}`)
    this.name = 'HostPausedError'
  }
}

export async function getHost(hostId: string): Promise<HostRow | null> {
  const rows = await getDb().select().from(host).where(eq(host.id, hostId)).limit(1)
  return rows[0] ?? null
}

export async function getHostByDid(did: string): Promise<HostRow | null> {
  const rows = await getDb().select().from(host).where(eq(host.did, did)).limit(1)
  return rows[0] ?? null
}

export async function getHostByHandle(handle: string): Promise<HostRow | null> {
  const rows = await getDb().select().from(host).where(eq(host.handle, handle.toLowerCase())).limit(1)
  return rows[0] ?? null
}

export async function storeAppPassword(hostId: string, identifier: string, appPassword: string): Promise<void> {
  const c = config()
  const w = wrapSecret(appPassword, c.custodyKeys, c.CUSTODY_KEY_VERSION)
  await getDb()
    .insert(credential)
    .values({ hostId, kind: 'app_password', keyVersion: w.keyVersion, ciphertext: w.blob, identifier })
    .onConflictDoUpdate({ target: credential.hostId, set: { kind: 'app_password', keyVersion: w.keyVersion, ciphertext: w.blob, identifier, updatedAt: new Date() } })
}

export async function storeOauthSession(hostId: string, sessionKey: string): Promise<void> {
  const c = config()
  const w = wrapSecret(sessionKey, c.custodyKeys, c.CUSTODY_KEY_VERSION)
  await getDb()
    .insert(credential)
    .values({ hostId, kind: 'oauth_session', keyVersion: w.keyVersion, ciphertext: w.blob, identifier: sessionKey })
    .onConflictDoUpdate({ target: credential.hostId, set: { kind: 'oauth_session', keyVersion: w.keyVersion, ciphertext: w.blob, identifier: sessionKey, updatedAt: new Date() } })
}

export async function dropCredential(hostId: string): Promise<void> {
  await getDb().delete(credential).where(eq(credential.hostId, hostId))
}

/** A writer for this host, or a `HostPausedError` when we hold no working credential. */
export async function writerFor(h: HostRow): Promise<RepoWriter> {
  if (h.pausedReason) throw new HostPausedError(h.pausedReason)
  const rows = await getDb().select().from(credential).where(eq(credential.hostId, h.id)).limit(1)
  const cred = rows[0]
  if (!cred) throw new HostPausedError('no credential')
  const c = config()
  if (cred.kind === 'app_password') {
    const secret = unwrapSecret({ keyVersion: cred.keyVersion, blob: cred.ciphertext }, c.custodyKeys)
    return appPasswordWriter(h.pdsUrl, h.did, cred.identifier, secret)
  }
  return oauthWriterFor(h.did)
}

export async function pauseHost(hostId: string, reason: string): Promise<void> {
  const h = await getHost(hostId)
  if (h) forgetSession(h.pdsUrl, h.did)
  await getDb().update(host).set({ pausedReason: reason }).where(eq(host.id, hostId))
}

export async function unpauseHost(hostId: string): Promise<void> {
  await getDb().update(host).set({ pausedReason: null }).where(eq(host.id, hostId))
}

export function publicHost(h: HostRow): Record<string, unknown> {
  return {
    id: h.id,
    did: h.did,
    handle: h.handle,
    displayName: h.displayName,
    email: h.email,
    door: h.door,
    provenanceLevel: h.provenanceLevel,
    region: h.region,
    logoUrl: h.logoImageHash ? `/api/public/cache-img/${h.logoImageHash}` : null,
    createdAt: h.createdAt.toISOString(),
    paused: h.pausedReason,
  }
}
