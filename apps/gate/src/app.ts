/**
 * The Gate's HTTP surface (architecture §9.3). Every request is service-authenticated
 * (`X-Gate-Service`) and carries the viewer as `X-Viewer-Did` or is anonymous. There
 * is no unauthenticated path to a permissioned record, and not-found and
 * not-permitted answer with byte-identical bodies.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { Hono, type Context } from 'hono'
import type pg from 'pg'
import { z } from 'zod'
import { parsePolicy, ROLE } from '@tributary/policy'
import {
  NotFoundError,
  PostgresSpaceStore,
  SpaceAccessError,
  parseRecordUri,
  parseSpaceUri,
  signBlobUrl,
  verifyBlobSig,
  type BlobStorage,
  type Did,
} from '@tributary/spaces-shim'
import { PostgresClaims } from './claims.js'
import { describeError, log } from './logging.js'

export interface GateOptions {
  pool: pg.Pool
  serviceSecret: string
  blobs: BlobStorage
  /** The Gate's own public base, used in signed blob URLs. */
  publicUrl: string
}

const NOT_FOUND = { error: 'NotFound' } as const
const DID_RE = /^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/

const inviteSchema = z.object({
  kind: z.enum(['join', 'read', 'read-join']),
  expiresInHours: z.number().positive().max(24 * 365).default(72),
  maxUses: z.number().int().positive().nullable().default(null),
  role: z.number().int().min(0).max(99).default(ROLE.member),
})

const createSpaceSchema = z.object({
  authority: z.string().regex(DID_RE),
  spaceType: z.string().regex(/^[a-z0-9-]+(\.[a-z0-9-]+){2,}$/),
  skey: z.string().regex(/^[A-Za-z0-9._:~-]{1,64}$/),
  readPolicy: z.unknown(),
  writePolicy: z.unknown(),
})

type Env = { Variables: { viewer: Did | null } }

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

function constantEq(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export function createGateApp(opts: GateOptions) {
  const { pool } = opts
  const store = new PostgresSpaceStore(pool, {
    claims: new PostgresClaims(pool),
    blobs: opts.blobs,
    signBlobUrl: (id, viewer) => signBlobUrl(opts.publicUrl, opts.serviceSecret, id, viewer),
  })

  async function audit(spaceUri: string, actor: Did | null, action: string, subject: string | null, detail: Record<string, unknown> = {}): Promise<void> {
    await pool.query('insert into gate.gate_audit (space_uri, actor, action, subject, detail) values ($1, $2, $3, $4, $5)', [spaceUri, actor, action, subject, JSON.stringify(detail)])
  }

  /** The viewer may manage (authority or role >= 100)? Answers false for a space they cannot see. */
  async function isManager(spaceUri: string, viewer: Did | null): Promise<boolean> {
    if (!viewer) return false
    const s = await store.getSpace(spaceUri, viewer)
    if (!s) return false
    if (s.authority === viewer) return true
    const r = await pool.query<{ role: number }>('select role from gate.space_member where space_uri = $1 and did = $2', [spaceUri, viewer])
    return (r.rows[0]?.role ?? 0) >= ROLE.manage
  }

  const app = new Hono<Env>()

  // The blob bytes route is signed-URL authenticated (the image tag cannot send headers).
  app.get('/blobs/:id', async (c) => {
    const id = c.req.param('id')
    const viewer = c.req.query('viewer') ?? ''
    const exp = Number(c.req.query('exp'))
    const sig = c.req.query('sig') ?? ''
    if (!verifyBlobSig(opts.serviceSecret, id, viewer, exp, sig)) return c.json(NOT_FOUND, 404)
    const meta = await store.blobMeta(id)
    const bytes = meta ? await opts.blobs.get(id) : null
    if (!meta || !bytes) return c.json(NOT_FOUND, 404)
    c.header('Cache-Control', 'private, no-store')
    c.header('Content-Type', meta.mime)
    c.header('X-Content-Type-Options', 'nosniff')
    return c.body(new Uint8Array(bytes))
  })

  app.get('/health', async (c) => {
    try {
      await pool.query('select 1')
      return c.json({ status: 'ok' })
    } catch {
      return c.json({ status: 'degraded' }, 503)
    }
  })

  app.use('*', async (c, next) => {
    const secret = c.req.header('x-gate-service') ?? ''
    if (!opts.serviceSecret || !constantEq(secret, opts.serviceSecret)) return c.json({ error: 'Unauthorized' }, 401)
    const v = c.req.header('x-viewer-did')?.trim()
    if (v && !DID_RE.test(v)) return c.json({ error: 'InvalidViewer' }, 400)
    c.set('viewer', (v as Did | undefined) ?? null)
    await next()
  })

  app.onError((err, c) => {
    if (err instanceof NotFoundError) return c.json(NOT_FOUND, 404)
    if (err instanceof SpaceAccessError) return c.json({ error: 'Forbidden', message: err.message }, 403)
    if (err instanceof z.ZodError) return c.json({ error: 'InvalidInput' }, 400)
    log.error('unhandled', { detail: describeError(err) })
    return c.json({ error: 'Internal' }, 500)
  })

  const viewerOf = (c: Context<Env>): Did | null => c.get('viewer')
  const requireActor = (c: Context<Env>): Did => {
    const v = viewerOf(c)
    if (!v) throw new NotFoundError()
    return v
  }
  const spaceParam = (c: Context<Env>): string => {
    const uri = c.req.param('uri')
    if (!uri || !parseSpaceUri(uri)) throw new NotFoundError()
    return uri
  }

  /* spaces */

  app.post('/spaces', async (c) => {
    const body = createSpaceSchema.parse(await c.req.json())
    const actor = requireActor(c)
    // Only the authority itself creates its spaces. Nobody mints a space in another's name.
    if (actor !== body.authority) throw new NotFoundError()
    const s = await store.createSpace({
      authority: body.authority as Did,
      spaceType: body.spaceType,
      skey: body.skey,
      readPolicy: parsePolicy(body.readPolicy),
      writePolicy: parsePolicy(body.writePolicy),
    })
    await audit(s.uri, actor, 'space.create', null, { spaceType: s.spaceType })
    return c.json(s, 201)
  })

  app.get('/spaces/:uri', async (c) => {
    const s = await store.getSpace(spaceParam(c), viewerOf(c))
    if (!s) return c.json(NOT_FOUND, 404)
    return c.json(s)
  })

  app.delete('/spaces/:uri', async (c) => {
    const uri = spaceParam(c)
    const actor = requireActor(c)
    await store.deleteSpace(uri, actor)
    await audit(uri, actor, 'space.delete', null)
    return c.body(null, 204)
  })

  /* members */

  app.get('/spaces/:uri/members', async (c) => {
    const members = await store.listMembers(spaceParam(c), requireActor(c))
    return c.json({ members })
  })

  app.put('/spaces/:uri/members/:did', async (c) => {
    const uri = spaceParam(c)
    const actor = requireActor(c)
    const member = c.req.param('did')
    if (!DID_RE.test(member)) throw new NotFoundError()
    const { role } = z.object({ role: z.number().int().min(0).max(1000) }).parse(await c.req.json())
    await store.putMember(uri, actor, member as Did, role)
    await audit(uri, actor, 'member.put', member, { role })
    return c.body(null, 204)
  })

  app.delete('/spaces/:uri/members/:did', async (c) => {
    const uri = spaceParam(c)
    const actor = requireActor(c)
    const member = c.req.param('did')
    if (!DID_RE.test(member)) throw new NotFoundError()
    await store.removeMember(uri, actor, member as Did)
    // Revocation is immediate and app-side: approvals and shares go with the seat.
    await pool.query(`update gate.access_request set state = 'denied', decided_at = now(), decided_by = $3 where space_uri = $1 and did = $2 and state = 'approved'`, [uri, member, actor])
    await pool.query('delete from gate.share where space_uri = $1 and did = $2', [uri, member])
    await audit(uri, actor, 'member.remove', member)
    return c.body(null, 204)
  })

  /* records */

  app.post('/spaces/:uri/records', async (c) => {
    const uri = spaceParam(c)
    const author = requireActor(c)
    const body = z.object({ collection: z.string().regex(/^[a-z0-9-]+(\.[a-z0-9-]+){2,}$/), value: z.unknown(), rkey: z.string().regex(/^[A-Za-z0-9._:~-]{1,64}$/).optional() }).parse(await c.req.json())
    const rec = await store.putRecord(uri, author, body.collection, body.value ?? {}, body.rkey)
    return c.json(rec, 201)
  })

  app.get('/spaces/:uri/records', async (c) => {
    const records = await store.listRecords(spaceParam(c), viewerOf(c), c.req.query('collection') || undefined)
    return c.json({ records })
  })

  app.get('/records/:uri', async (c) => {
    const uri = c.req.param('uri')
    if (!parseRecordUri(uri)) return c.json(NOT_FOUND, 404)
    const rec = await store.getRecord(uri, viewerOf(c))
    if (!rec) return c.json(NOT_FOUND, 404)
    return c.json(rec)
  })

  app.delete('/records/:uri', async (c) => {
    const uri = c.req.param('uri')
    const parsed = parseRecordUri(uri)
    if (!parsed) throw new NotFoundError()
    const spaceUri = c.req.query('space') ?? parsed.spaceUri
    await store.deleteRecord(spaceUri, requireActor(c), uri)
    return c.body(null, 204)
  })

  /* blobs */

  app.post('/spaces/:uri/blobs', async (c) => {
    const uri = spaceParam(c)
    const author = requireActor(c)
    const mime = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
    if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(mime)) return c.json({ error: 'InvalidInput', message: 'image blobs only' }, 400)
    const bytes = Buffer.from(await c.req.arrayBuffer())
    if (bytes.length === 0 || bytes.length > 5 * 1024 * 1024) return c.json({ error: 'InvalidInput', message: 'blob must be 1 byte to 5 MB' }, 400)
    const out = await store.putBlob(uri, author, bytes, mime)
    return c.json(out, 201)
  })

  app.get('/blobs/:id/url', async (c) => {
    const url = await store.getBlobUrl(c.req.param('id'), viewerOf(c))
    if (!url) return c.json(NOT_FOUND, 404)
    return c.json({ url })
  })

  /* invites (architecture §9.3 item 3): hashed single-view tokens with expiry and use counts */

  app.post('/spaces/:uri/invites', async (c) => {
    const uri = spaceParam(c)
    const actor = requireActor(c)
    if (!(await isManager(uri, actor))) throw new NotFoundError()
    const body = inviteSchema.parse(await c.req.json())
    const id = randomBytes(9).toString('base64url')
    const token = randomBytes(24).toString('base64url')
    const expiresAt = new Date(Date.now() + body.expiresInHours * 3_600_000)
    await pool.query(
      `insert into gate.invite (id, space_uri, kind, token_hash, role, expires_at, max_uses, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, uri, body.kind, sha256(token), body.role, expiresAt, body.maxUses, actor],
    )
    await audit(uri, actor, 'invite.create', id, { kind: body.kind, maxUses: body.maxUses, expiresAt: expiresAt.toISOString() })
    return c.json({ id, token, expiresAt: expiresAt.toISOString() }, 201)
  })

  app.get('/spaces/:uri/invites', async (c) => {
    const uri = spaceParam(c)
    const actor = requireActor(c)
    if (!(await isManager(uri, actor))) throw new NotFoundError()
    const r = await pool.query(
      `select id, kind, role, expires_at, max_uses, uses, created_by, created_at, revoked_at from gate.invite where space_uri = $1 order by created_at desc`,
      [uri],
    )
    return c.json({
      invites: r.rows.map((i) => ({
        id: i.id,
        kind: i.kind,
        role: i.role,
        expiresAt: i.expires_at.toISOString(),
        maxUses: i.max_uses,
        uses: i.uses,
        createdBy: i.created_by,
        createdAt: i.created_at.toISOString(),
        revokedAt: i.revoked_at ? i.revoked_at.toISOString() : null,
      })),
    })
  })

  app.delete('/invites/:id', async (c) => {
    const actor = requireActor(c)
    const id = c.req.param('id')
    const r = await pool.query<{ space_uri: string }>('select space_uri from gate.invite where id = $1', [id])
    const row = r.rows[0]
    if (!row || !(await isManager(row.space_uri, actor))) throw new NotFoundError()
    await pool.query('update gate.invite set revoked_at = coalesce(revoked_at, now()) where id = $1', [id])
    await audit(row.space_uri, actor, 'invite.revoke', id)
    return c.body(null, 204)
  })

  app.post('/invites/redeem', async (c) => {
    const viewer = requireActor(c)
    const { token } = z.object({ token: z.string().min(16).max(128) }).parse(await c.req.json())
    const client = await pool.connect()
    try {
      await client.query('begin')
      const r = await client.query<{ id: string; space_uri: string; kind: 'join' | 'read' | 'read-join'; role: number; expires_at: Date; max_uses: number | null; uses: number; revoked_at: Date | null; authority: string }>(
        `select i.*, s.authority from gate.invite i join gate.space s on s.uri = i.space_uri where i.token_hash = $1 for update of i`,
        [sha256(token)],
      )
      const inv = r.rows[0]
      // Expired, revoked or unknown all look the same: nothing to see.
      if (!inv || inv.revoked_at || inv.expires_at.getTime() < Date.now()) {
        await client.query('rollback')
        return c.json(NOT_FOUND, 404)
      }
      const already = await client.query('select 1 from gate.invite_redemption where invite_id = $1 and did = $2', [inv.id, viewer])
      // A person who already redeemed is not a new use; a new person past the limit is refused.
      if ((already.rowCount ?? 0) === 0 && inv.max_uses !== null && inv.uses >= inv.max_uses) {
        await client.query('rollback')
        return c.json(NOT_FOUND, 404)
      }
      if ((already.rowCount ?? 0) === 0) {
        await client.query('insert into gate.invite_redemption (invite_id, space_uri, did) values ($1, $2, $3)', [inv.id, inv.space_uri, viewer])
        await client.query('update gate.invite set uses = uses + 1 where id = $1', [inv.id])
        if (inv.kind === 'join' || inv.kind === 'read-join') {
          await client.query(
            `insert into gate.space_member (space_uri, did, role) values ($1, $2, $3)
             on conflict (space_uri, did) do update set role = greatest(gate.space_member.role, excluded.role)`,
            [inv.space_uri, viewer, inv.role],
          )
        }
      }
      await client.query('commit')
      await audit(inv.space_uri, viewer, 'invite.redeem', inv.id, { kind: inv.kind })
      return c.json({ spaceUri: inv.space_uri, kind: inv.kind, role: inv.kind === 'read' ? null : inv.role })
    } catch (err) {
      await client.query('rollback').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  })

  /* shares: a manager names a DID directly (invitation by handle, resolved upstream) */

  app.put('/spaces/:uri/shares/:did', async (c) => {
    const uri = spaceParam(c)
    const actor = requireActor(c)
    const did = c.req.param('did')
    if (!DID_RE.test(did)) throw new NotFoundError()
    if (!(await isManager(uri, actor))) throw new NotFoundError()
    await pool.query('insert into gate.share (space_uri, did, granted_by) values ($1, $2, $3) on conflict do nothing', [uri, did, actor])
    await audit(uri, actor, 'share.grant', did)
    return c.body(null, 204)
  })

  app.delete('/spaces/:uri/shares/:did', async (c) => {
    const uri = spaceParam(c)
    const actor = requireActor(c)
    const did = c.req.param('did')
    if (!DID_RE.test(did)) throw new NotFoundError()
    if (!(await isManager(uri, actor))) throw new NotFoundError()
    await pool.query('delete from gate.share where space_uri = $1 and did = $2', [uri, did])
    await audit(uri, actor, 'share.revoke', did)
    return c.body(null, 204)
  })

  /* access requests and approvals */

  app.post('/spaces/:uri/requests', async (c) => {
    const uri = spaceParam(c)
    const viewer = requireActor(c)
    // Requests are allowed against a space the viewer cannot yet see (that is the point),
    // but only if the space exists. Existence is not leaked: an unknown space yields the
    // same 202 as a real one, and the request is simply never approvable.
    const exists = await pool.query('select 1 from gate.space where uri = $1', [uri])
    if ((exists.rowCount ?? 0) === 0) return c.json({ id: randomBytes(9).toString('base64url'), state: 'pending' }, 202)
    const id = randomBytes(9).toString('base64url')
    const r = await pool.query<{ id: string; state: string }>(
      `insert into gate.access_request (id, space_uri, did, state) values ($1, $2, $3, 'pending')
       on conflict (space_uri, did) do update set requested_at = case when gate.access_request.state = 'denied' then now() else gate.access_request.requested_at end,
         state = case when gate.access_request.state = 'denied' then 'pending' else gate.access_request.state end
       returning id, state`,
      [id, uri, viewer],
    )
    await audit(uri, viewer, 'request.create', r.rows[0]!.id)
    return c.json({ id: r.rows[0]!.id, state: r.rows[0]!.state }, 202)
  })

  app.get('/spaces/:uri/requests', async (c) => {
    const uri = spaceParam(c)
    const actor = requireActor(c)
    if (!(await isManager(uri, actor))) throw new NotFoundError()
    const r = await pool.query('select id, space_uri, did, state, requested_at, decided_at from gate.access_request where space_uri = $1 order by requested_at desc', [uri])
    return c.json({
      requests: r.rows.map((x) => ({ id: x.id, spaceUri: x.space_uri, did: x.did, state: x.state, requestedAt: x.requested_at.toISOString(), decidedAt: x.decided_at ? x.decided_at.toISOString() : null })),
    })
  })

  app.post('/requests/:id', async (c) => {
    const actor = requireActor(c)
    const id = c.req.param('id')
    const { action } = z.object({ action: z.enum(['approve', 'deny']) }).parse(await c.req.json())
    const r = await pool.query<{ space_uri: string; did: string; state: string; authority: string }>(
      'select a.space_uri, a.did, a.state, s.authority from gate.access_request a join gate.space s on s.uri = a.space_uri where a.id = $1',
      [id],
    )
    const req = r.rows[0]
    if (!req || !(await isManager(req.space_uri, actor))) throw new NotFoundError()
    const state = action === 'approve' ? 'approved' : 'denied'
    await pool.query('update gate.access_request set state = $2, decided_at = now(), decided_by = $3 where id = $1', [id, state, actor])
    if (action === 'approve') {
      await store.putMember(req.space_uri, req.authority as Did, req.did as Did, ROLE.member)
    } else {
      await pool.query('delete from gate.space_member where space_uri = $1 and did = $2 and role <= $3', [req.space_uri, req.did, ROLE.member])
    }
    await audit(req.space_uri, actor, `request.${state}`, req.did)
    return c.json({ id, state })
  })

  /* audit: who was granted what, by whom, when. Never record bodies. */

  app.get('/audit', async (c) => {
    const uri = c.req.query('space') ?? ''
    const actor = requireActor(c)
    if (!parseSpaceUri(uri) || !(await isManager(uri, actor))) throw new NotFoundError()
    const r = await pool.query('select id, at, space_uri, actor, action, subject, detail from gate.gate_audit where space_uri = $1 order by at desc, id desc limit 500', [uri])
    return c.json({
      entries: r.rows.map((e) => ({ id: Number(e.id), at: e.at.toISOString(), spaceUri: e.space_uri, actor: e.actor, action: e.action, subject: e.subject, detail: e.detail })),
    })
  })

  return { app, store }
}

/** Retention (PRD §12): tokens purged at expiry, stale requests denied, audit kept one year. */
export async function runRetention(pool: pg.Pool): Promise<{ invites: number; requests: number; audit: number }> {
  const a = await pool.query(`delete from gate.invite where expires_at < now() - interval '1 day' or (revoked_at is not null and revoked_at < now() - interval '1 day')`)
  const b = await pool.query(`update gate.access_request set state = 'denied', decided_at = now() where state = 'pending' and requested_at < now() - interval '30 days'`)
  const d = await pool.query(`delete from gate.gate_audit where at < now() - interval '1 year'`)
  return { invites: a.rowCount ?? 0, requests: b.rowCount ?? 0, audit: d.rowCount ?? 0 }
}
