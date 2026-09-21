/**
 * The signed-in host: profile, ownership buttons (take control, revoke, delete),
 * API keys, push channels, export, organisation roles.
 */
import { Hono } from 'hono'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { hashToken, newApiKey, newToken, PdsError, pdsAdmin, revokeSyncAppPassword, loginWithAppPassword, unwrapSecret } from '@tributary/identity'
import { unpublishEvent } from '@tributary/publisher'
import { config } from '../../config.js'
import { getDb } from '../../db/index.js'
import { apiKey, credential, host, inboundAddress, orgRole, source, sourceEvent, visibilityRule } from '../../db/schema.js'
import { recordAudit } from '../../lib/audit.js'
import { pdsConfig, SignupError, takeControl } from '../../lib/custody.js'
import { dropCredential, pauseHost, publicHost, writerFor } from '../../lib/hosts.js'
import { id } from '../../lib/ids.js'
import { describeError, log } from '../../lib/logging.js'
import { revokeOauthSession } from '../../lib/oauth.js'
import { deletePermissioned } from '../../pipeline/gate.js'
import { ApiError, body, requireHost, str, type Vars } from '../context.js'
import { publicSource } from '../../lib/sources.js'
import { resolveHandle } from '@tributary/identity'

export const meRoutes = new Hono<{ Variables: Vars }>()

meRoutes.get('/', (c) => {
  const h = requireHost(c)
  return c.json({ host: publicHost(h), capabilities: { canSetPassword: h.door === 'custodial', canMigrate: h.door === 'custodial', canRevokeSync: true } })
})

meRoutes.patch('/', async (c) => {
  const h = requireHost(c)
  const b = await body(c)
  const displayName = str(b.displayName, 'displayName', { optional: true, max: 80 })
  if (displayName) await getDb().update(host).set({ displayName }).where(eq(host.id, h.id))
  return c.json({ ok: true })
})

meRoutes.post('/take-control', async (c) => {
  const h = requireHost(c)
  try {
    await takeControl(h)
  } catch (err) {
    if (err instanceof SignupError) throw new ApiError(err.status, err.code as never, err.message)
    if (err instanceof PdsError) throw new ApiError(502, 'PdsRejected', 'The server could not send the reset email right now.')
    throw err
  }
  return c.json({ status: 'email-sent' })
})

meRoutes.post('/revoke-sync', async (c) => {
  const h = requireHost(c)
  if (h.door === 'custodial') {
    const rows = await getDb().select().from(credential).where(eq(credential.hostId, h.id)).limit(1)
    const cred = rows[0]
    if (cred?.kind === 'app_password') {
      try {
        const agent = await loginWithAppPassword(h.pdsUrl, cred.identifier, unwrapSecret({ keyVersion: cred.keyVersion, blob: cred.ciphertext }, config().custodyKeys))
        await revokeSyncAppPassword(agent)
      } catch (err) {
        log.warn('could not revoke the app password at the PDS; dropping it locally anyway', { detail: describeError(err) })
      }
    }
  } else {
    await revokeOauthSession(h.did).catch(() => {})
  }
  await dropCredential(h.id)
  await pauseHost(h.id, 'revoked-by-host')
  await recordAudit({ hostId: h.id, actor: h.did, action: 'host.revoke-sync' })
  return c.json({ status: 'revoked' })
})

/** "Delete everything": records we hold a ledger row for, sources, then (custodial) the account. */
meRoutes.post('/delete', async (c) => {
  const h = requireHost(c)
  const b = await body(c)
  if (b.confirm !== 'delete everything') throw new ApiError(400, 'InvalidInput', 'Type "delete everything" to confirm.')
  const db = getDb()
  const rows = await db.select().from(sourceEvent).where(eq(sourceEvent.hostId, h.id))
  let writer: Awaited<ReturnType<typeof writerFor>> | undefined
  try {
    writer = await writerFor(h)
  } catch {
    writer = undefined
  }
  let removed = 0
  for (const r of rows) {
    try {
      if (r.atUri && r.rkey && writer) await unpublishEvent(writer, r.rkey)
      if (r.spaceUri) await deletePermissioned(h.did as `did:${string}`, r)
      removed++
    } catch (err) {
      log.warn('delete: a record could not be removed', { detail: describeError(err) })
    }
  }
  await db.delete(source).where(eq(source.hostId, h.id))
  if (h.door === 'custodial') {
    try {
      await pdsAdmin.deleteAccount(pdsConfig(), h.did)
    } catch (err) {
      log.warn('delete: PDS account deletion failed', { detail: describeError(err) })
    }
  } else {
    await revokeOauthSession(h.did).catch(() => {})
  }
  await recordAudit({ hostId: null, actor: h.did, action: 'host.deleted', detail: { removed } })
  await db.delete(host).where(eq(host.id, h.id))
  return c.json({ removed })
})

meRoutes.get('/export', async (c) => {
  const h = requireHost(c)
  const db = getDb()
  const sources = await db.select().from(source).where(eq(source.hostId, h.id))
  const events = await db.select().from(sourceEvent).where(eq(sourceEvent.hostId, h.id))
  const rules = sources.length ? await db.select().from(visibilityRule) : []
  c.header('Content-Disposition', `attachment; filename="tributary-export-${h.handle}.json"`)
  return c.json({ host: publicHost(h), exportedAt: new Date().toISOString(), sources: sources.map((s) => ({ ...publicSource(s), config: s.config })), rules: rules.filter((r) => sources.some((s) => s.id === r.sourceId)), events: events.map((e) => ({ id: e.id, sourceId: e.sourceId, externalId: e.externalId, occurrence: e.occurrence, state: e.state, visibility: e.visibility, atUri: e.atUri, spaceUri: e.spaceUri, normalized: e.normalized, override: e.override, firstSeen: e.firstSeen, lastSeen: e.lastSeen })) })
})

/* ── API keys ───────────────────────────────────────────────────────────────── */

meRoutes.get('/keys', async (c) => {
  const h = requireHost(c)
  const rows = await getDb().select().from(apiKey).where(and(eq(apiKey.hostId, h.id), isNull(apiKey.revokedAt))).orderBy(desc(apiKey.createdAt))
  return c.json({ keys: rows.map((k) => ({ id: k.id, name: k.name, createdAt: k.createdAt.toISOString(), lastUsedAt: k.lastUsedAt?.toISOString() ?? null })) })
})

meRoutes.post('/keys', async (c) => {
  const h = requireHost(c)
  const b = await body(c)
  const name = str(b.name, 'name', { max: 60 })
  const key = newApiKey()
  const kid = id('key')
  await getDb().insert(apiKey).values({ id: kid, hostId: h.id, name, keyHash: hashToken(key) })
  await recordAudit({ hostId: h.id, actor: h.did, action: 'apikey.created', subject: kid })
  return c.json({ id: kid, name, key, createdAt: new Date().toISOString() }, 201)
})

meRoutes.delete('/keys/:id', async (c) => {
  const h = requireHost(c)
  await getDb().update(apiKey).set({ revokedAt: new Date() }).where(and(eq(apiKey.id, c.req.param('id')), eq(apiKey.hostId, h.id)))
  return c.json({ ok: true })
})

/* ── inbound channels ──────────────────────────────────────────────────────── */

async function inboundFor(hostId: string) {
  const rows = await getDb().select().from(inboundAddress).where(eq(inboundAddress.hostId, hostId)).limit(1)
  if (rows[0]) return rows[0]
  const [row] = await getDb().insert(inboundAddress).values({ hostId, emailToken: newToken(12), webhookToken: newToken(16), webhookSecret: newToken(24) }).returning()
  return row!
}

function inboundView(r: typeof inboundAddress.$inferSelect) {
  const k = config()
  return { email: `add+${r.emailToken}@${k.INBOUND_EMAIL_DOMAIN}`, webhookUrl: `${k.WEB_PUBLIC_URL}/api/webhook/${r.webhookToken}`, webhookSecret: r.webhookSecret, rotatedAt: r.rotatedAt.toISOString() }
}

meRoutes.get('/inbound', async (c) => c.json(inboundView(await inboundFor(requireHost(c).id))))
meRoutes.post('/inbound/rotate', async (c) => {
  const h = requireHost(c)
  const [row] = await getDb().update(inboundAddress).set({ emailToken: newToken(12), webhookToken: newToken(16), webhookSecret: newToken(24), rotatedAt: new Date() }).where(eq(inboundAddress.hostId, h.id)).returning()
  return c.json(inboundView(row ?? (await inboundFor(h.id))))
})

/* ── organisation roles (shape reserved; app-side membership claims) ───────── */

meRoutes.get('/roles', async (c) => {
  const h = requireHost(c)
  const rows = await getDb().select().from(orgRole).where(eq(orgRole.hostId, h.id))
  return c.json({ roles: [{ did: h.did, role: 'owner' }, ...rows.map((r) => ({ did: r.did, role: r.role }))] })
})

meRoutes.post('/roles', async (c) => {
  const h = requireHost(c)
  const b = await body(c)
  const role = str(b.role, 'role')
  if (!['owner', 'editor', 'viewer'].includes(role)) throw new ApiError(400, 'InvalidInput', 'role must be owner, editor or viewer.')
  let did = str(b.did, 'did', { optional: true })
  if (!did) {
    const handle = str(b.handle, 'handle').replace(/^@/, '')
    did = (await resolveHandle(handle, config().PDS_URL).catch(() => null)) ?? ''
    if (!did) throw new ApiError(400, 'InvalidInput', 'That handle could not be resolved.')
  }
  await getDb().insert(orgRole).values({ hostId: h.id, did, role }).onConflictDoUpdate({ target: [orgRole.hostId, orgRole.did], set: { role } })
  await recordAudit({ hostId: h.id, actor: h.did, action: 'role.set', subject: did, detail: { role } })
  return c.json({ ok: true })
})

meRoutes.delete('/roles/:did', async (c) => {
  const h = requireHost(c)
  await getDb().delete(orgRole).where(and(eq(orgRole.hostId, h.id), eq(orgRole.did, c.req.param('did'))))
  return c.json({ ok: true })
})
