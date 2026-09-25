/**
 * Door A: a server-side confidential OAuth client (architecture §8.3). The browser never
 * sees a token; the dance ends in our session cookie and the OAuth session lives in
 * Postgres, keyed by DID, so background sync can restore it indefinitely as long as we
 * refresh. Granular scopes only: create/update/delete on one collection plus image
 * blobs. If a host's PDS refuses them we say so and offer Door B rather than silently
 * asking for `transition:generic`.
 */
import { Agent } from '@atproto/api'
import { JoseKey } from '@atproto/jwk-jose'
import { NodeOAuthClient, type NodeSavedSession, type NodeSavedSessionStore, type NodeSavedState, type NodeSavedStateStore, type RuntimeLock } from '@atproto/oauth-client-node'
import { eq, sql } from 'drizzle-orm'
import { AgentWriter, type RepoWriter } from '@tributary/publisher'
import { config } from '../config.js'
import { getDb, getPool } from '../db/index.js'
import { oauthSession, oauthState } from '../db/schema.js'

const KID = 'tributary-1'
const KEY_ROW = '__client_key__'

export const OAUTH_SCOPE = 'atproto repo:community.lexicon.calendar.event blob:image/*'

class PgStateStore implements NodeSavedStateStore {
  async get(key: string): Promise<NodeSavedState | undefined> {
    const rows = await getDb().select().from(oauthState).where(eq(oauthState.key, key)).limit(1)
    return (rows[0]?.value as NodeSavedState | undefined) ?? undefined
  }
  async set(key: string, value: NodeSavedState): Promise<void> {
    await getDb().insert(oauthState).values({ key, value }).onConflictDoUpdate({ target: oauthState.key, set: { value } })
  }
  async del(key: string): Promise<void> {
    await getDb().delete(oauthState).where(eq(oauthState.key, key))
  }
}

class PgSessionStore implements NodeSavedSessionStore {
  async get(sub: string): Promise<NodeSavedSession | undefined> {
    const rows = await getDb().select().from(oauthSession).where(eq(oauthSession.key, sub)).limit(1)
    return (rows[0]?.value as NodeSavedSession | undefined) ?? undefined
  }
  async set(sub: string, value: NodeSavedSession): Promise<void> {
    await getDb().insert(oauthSession).values({ key: sub, value }).onConflictDoUpdate({ target: oauthSession.key, set: { value, updatedAt: new Date() } })
  }
  async del(sub: string): Promise<void> {
    await getDb().delete(oauthSession).where(eq(oauthSession.key, sub))
  }
}

/**
 * Two workers refreshing the same session would invalidate it (refresh tokens are
 * single-use), so the lock is a Postgres advisory lock keyed by DID (§8.3).
 */
const pgAdvisoryLock: RuntimeLock = async (name, fn) => {
  const client = await getPool().connect()
  try {
    await client.query('select pg_advisory_lock(hashtext($1))', [name])
    try {
      return await fn()
    } finally {
      await client.query('select pg_advisory_unlock(hashtext($1))', [name])
    }
  } finally {
    client.release()
  }
}

async function loadOrCreateKey(): Promise<JoseKey> {
  const configured = config().OAUTH_PRIVATE_JWK
  if (configured) return JoseKey.fromImportable(JSON.parse(configured), KID)
  const rows = await getDb().select().from(oauthState).where(eq(oauthState.key, KEY_ROW)).limit(1)
  if (rows[0]) return JoseKey.fromImportable(rows[0].value as never, KID)
  const key = await JoseKey.generate(['ES256'], KID)
  await getDb().insert(oauthState).values({ key: KEY_ROW, value: key.privateJwk as object }).onConflictDoNothing()
  return key
}

export function oauthUsable(): boolean {
  const u = new URL(config().WEB_PUBLIC_URL)
  return u.protocol === 'https:' && u.hostname !== 'localhost' && !/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)
}

export function clientMetadata(): Record<string, unknown> {
  const c = config()
  const base = c.WEB_PUBLIC_URL
  return {
    client_id: `${base}/oauth-client-metadata.json`,
    // The consent screen is the one place this software faces the public under its own
    // name, and the person reading it is signing in to a directory, not to an adapter.
    client_name: c.BRAND_NAME,
    client_uri: base,
    logo_uri: `${base}/icon.png`,
    tos_uri: `${base}/legal/terms`,
    policy_uri: `${base}/legal/privacy`,
    redirect_uris: [`${base}/oauth/callback`],
    scope: OAUTH_SCOPE,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    application_type: 'web',
    token_endpoint_auth_method: 'private_key_jwt',
    token_endpoint_auth_signing_alg: 'ES256',
    dpop_bound_access_tokens: true,
    jwks_uri: `${base}/oauth/jwks.json`,
  }
}

let client: NodeOAuthClient | undefined

export class OAuthUnavailableError extends Error {
  readonly status = 503
  readonly code = 'OAuthNotConfigured'
  constructor() {
    super('Signing in with an existing account needs Tributary to be served over https on a real hostname. The email door works regardless.')
    this.name = 'OAuthUnavailableError'
  }
}

export async function oauthClient(): Promise<NodeOAuthClient> {
  if (client) return client
  if (!oauthUsable()) throw new OAuthUnavailableError()
  const key = await loadOrCreateKey()
  client = new NodeOAuthClient({
    clientMetadata: clientMetadata() as never,
    keyset: [key],
    stateStore: new PgStateStore(),
    sessionStore: new PgSessionStore(),
    requestLock: pgAdvisoryLock,
  })
  return client
}

export async function jwks(): Promise<unknown> {
  return (await oauthClient()).jwks
}

export async function oauthWriterFor(did: string): Promise<RepoWriter> {
  const c = await oauthClient()
  const session = await c.restore(did)
  return new AgentWriter(did, new Agent(session))
}

export async function revokeOauthSession(did: string): Promise<void> {
  try {
    const c = await oauthClient()
    const s = await c.restore(did)
    await s.signOut()
  } catch {
    await getDb().delete(oauthSession).where(eq(oauthSession.key, did))
  }
}

/** Old state rows (abandoned authorizations) are garbage. */
export async function purgeOauthState(): Promise<void> {
  await getDb().delete(oauthState).where(sql`${oauthState.key} <> ${KEY_ROW} and ${oauthState.createdAt} < now() - interval '1 hour'`)
}
