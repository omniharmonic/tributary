/**
 * The Gate over HTTP, against a real Postgres. The F27 viewer matrix is table-driven:
 * anonymous / non-member / member / removed-member × gated-detail / members / invite.
 */
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { GATED_DETAIL_READ, INVITE_READ, MEMBERS_READ, MEMBERS_WRITE, AUTHORITY_ONLY, ROLE } from '@tributary/policy'
import { MemoryBlobStorage } from '@tributary/spaces-shim'
import { createGateApp, runRetention } from '../src/app.js'
import { migrate } from '../src/migrate.js'

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/tributary_test'
const pool = new pg.Pool({ connectionString: url, max: 4 })
const SECRET = 'test-secret-that-is-at-least-32-characters-long'
const { app } = createGateApp({ pool, serviceSecret: SECRET, blobs: new MemoryBlobStorage(), publicUrl: 'http://gate.test' })

const AUTH = 'did:plc:authority'
const MEMBER = 'did:plc:member'
const STEWARD = 'did:plc:steward'
const GUEST = 'did:plc:guest'
const REMOVED = 'did:plc:removed'
const STRANGER = 'did:plc:stranger'

const enc = encodeURIComponent

async function call(method: string, path: string, viewer: string | null, body?: unknown, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { 'x-gate-service': SECRET, ...extra }
  if (viewer) headers['x-viewer-did'] = viewer
  if (body !== undefined && !extra['content-type']) headers['content-type'] = 'application/json'
  const res = await app.request(path, { method, headers, body: body === undefined ? undefined : extra['content-type'] ? (body as BodyInit) : JSON.stringify(body) })
  const text = await res.text()
  return { status: res.status, text, json: text ? JSON.parse(text) : null, headers: res.headers }
}

beforeAll(async () => {
  await migrate(pool)
})
afterAll(async () => {
  await pool.end()
})
beforeEach(async () => {
  await pool.query('truncate gate.space cascade')
  await pool.query('truncate gate.gate_audit')
})

async function mkSpace(spaceType: string, skey: string, readPolicy: unknown, writePolicy: unknown = AUTHORITY_ONLY) {
  const r = await call('POST', '/spaces', AUTH, { authority: AUTH, spaceType, skey, readPolicy, writePolicy })
  expect(r.status).toBe(201)
  return r.json.uri as string
}

describe('auth', () => {
  it('refuses without the service secret, and with a wrong one', async () => {
    const r1 = await app.request('/spaces', { method: 'POST' })
    expect(r1.status).toBe(401)
    const r2 = await app.request('/spaces', { method: 'POST', headers: { 'x-gate-service': 'nope' } })
    expect(r2.status).toBe(401)
  })
  it('health needs no secret', async () => {
    const r = await app.request('/health')
    expect(r.status).toBe(200)
  })
  it('a space may only be created by its authority', async () => {
    const r = await call('POST', '/spaces', STRANGER, { authority: AUTH, spaceType: 'a.b.c', skey: 'k', readPolicy: AUTHORITY_ONLY, writePolicy: AUTHORITY_ONLY })
    expect(r.status).toBe(404)
  })
})

describe('F27 viewer matrix', () => {
  type Level = 'gated' | 'members' | 'invite'
  type Viewer = 'anonymous' | 'non-member' | 'member' | 'removed-member'
  const cases: Array<{ level: Level; viewer: Viewer; sees: boolean }> = [
    { level: 'gated', viewer: 'anonymous', sees: false },
    { level: 'gated', viewer: 'non-member', sees: false },
    { level: 'gated', viewer: 'member', sees: true },
    { level: 'gated', viewer: 'removed-member', sees: false },
    { level: 'members', viewer: 'anonymous', sees: false },
    { level: 'members', viewer: 'non-member', sees: false },
    { level: 'members', viewer: 'member', sees: true },
    { level: 'members', viewer: 'removed-member', sees: false },
    { level: 'invite', viewer: 'anonymous', sees: false },
    { level: 'invite', viewer: 'non-member', sees: false },
    { level: 'invite', viewer: 'member', sees: true },
    { level: 'invite', viewer: 'removed-member', sees: false },
  ]

  async function setup(level: Level) {
    let uri: string
    let recordUri: string
    if (level === 'gated') {
      uri = await mkSpace('coop.lexicon.space.event.detail', 'evt', GATED_DETAIL_READ)
      // "member" of a gated detail space = a confirmed guest (approved request)
      await call('POST', `/spaces/${enc(uri)}/requests`, MEMBER)
      await call('POST', `/spaces/${enc(uri)}/requests`, REMOVED)
      const reqs = (await call('GET', `/spaces/${enc(uri)}/requests`, AUTH)).json.requests as Array<{ id: string; did: string }>
      for (const q of reqs) await call('POST', `/requests/${q.id}`, AUTH, { action: 'approve' })
      const rec = await call('POST', `/spaces/${enc(uri)}/records`, AUTH, { collection: 'coop.lexicon.event.detail', value: { exactLocation: '123 Elm St' } })
      recordUri = rec.json.uri
    } else if (level === 'members') {
      uri = await mkSpace('coop.lexicon.space.group.calendar', 'members', MEMBERS_READ(ROLE.member), MEMBERS_WRITE)
      await call('PUT', `/spaces/${enc(uri)}/members/${enc(MEMBER)}`, AUTH, { role: ROLE.member })
      await call('PUT', `/spaces/${enc(uri)}/members/${enc(REMOVED)}`, AUTH, { role: ROLE.member })
      const rec = await call('POST', `/spaces/${enc(uri)}/records`, AUTH, { collection: 'community.lexicon.calendar.event', value: { name: 'Workday' } })
      recordUri = rec.json.uri
    } else {
      uri = await mkSpace('coop.lexicon.space.event.invite', 'party', INVITE_READ, MEMBERS_WRITE)
      const inv = await call('POST', `/spaces/${enc(uri)}/invites`, AUTH, { kind: 'read-join', expiresInHours: 1, maxUses: 5 })
      expect(inv.status).toBe(201)
      expect((await call('POST', '/invites/redeem', MEMBER, { token: inv.json.token })).status).toBe(200)
      expect((await call('POST', '/invites/redeem', REMOVED, { token: inv.json.token })).status).toBe(200)
      const rec = await call('POST', `/spaces/${enc(uri)}/records`, AUTH, { collection: 'community.lexicon.calendar.event', value: { name: 'Potluck' } })
      recordUri = rec.json.uri
    }
    // The removed member: seat and every grant go at once.
    await call('DELETE', `/spaces/${enc(uri)}/members/${enc(REMOVED)}`, AUTH)
    // Belt and braces for the invite case: the redemption row is the "invited" claim.
    await pool.query('delete from gate.invite_redemption where did = $1', [REMOVED])
    return { uri, recordUri }
  }

  const viewerDid: Record<Viewer, string | null> = { anonymous: null, 'non-member': STRANGER, member: MEMBER, 'removed-member': REMOVED }

  for (const tc of cases) {
    it(`${tc.level} × ${tc.viewer} → ${tc.sees ? 'sees' : 'nothing'}`, async () => {
      const { uri, recordUri } = await setup(tc.level)
      const v = viewerDid[tc.viewer]
      const space = await call('GET', `/spaces/${enc(uri)}`, v)
      const rec = await call('GET', `/records/${enc(recordUri)}`, v)
      const list = await call('GET', `/spaces/${enc(uri)}/records`, v)
      if (tc.sees) {
        expect(space.status).toBe(200)
        expect(rec.status).toBe(200)
        expect(list.status).toBe(200)
        expect(list.json.records.length).toBe(1)
      } else {
        expect(space.status).toBe(404)
        expect(rec.status).toBe(404)
        expect(list.status).toBe(404)
        expect(space.text).toBe('{"error":"NotFound"}')
        expect(rec.text).toBe('{"error":"NotFound"}')
        expect(list.text).toBe('{"error":"NotFound"}')
      }
    })
  }

  it('not-found and not-permitted are byte-identical', async () => {
    const { uri, recordUri } = await setup('members')
    const missing = await call('GET', `/spaces/${enc('at://did:plc:authority/coop.lexicon.space.group.calendar/nope')}`, STRANGER)
    const denied = await call('GET', `/spaces/${enc(uri)}`, STRANGER)
    expect(missing.status).toBe(denied.status)
    expect(missing.text).toBe(denied.text)
    const missingRec = await call('GET', `/records/${enc(recordUri.replace(/[^/]+$/, 'zzz'))}`, MEMBER)
    const deniedRec = await call('GET', `/records/${enc(recordUri)}`, STRANGER)
    expect(missingRec.text).toBe(deniedRec.text)
    expect(missingRec.status).toBe(404)
    const garbage = await call('GET', `/records/${enc('not a uri')}`, MEMBER)
    expect(garbage.text).toBe(deniedRec.text)
  })
})

describe('invites', () => {
  it('honours expiry and use limits; tokens are stored hashed and shown once', async () => {
    const uri = await mkSpace('coop.lexicon.space.event.invite', 'p', INVITE_READ, MEMBERS_WRITE)
    const inv = await call('POST', `/spaces/${enc(uri)}/invites`, AUTH, { kind: 'read', expiresInHours: 1, maxUses: 1 })
    const token = inv.json.token as string
    const stored = await pool.query<{ token_hash: string }>('select token_hash from gate.invite where id = $1', [inv.json.id])
    expect(stored.rows[0]!.token_hash).not.toBe(token)
    const listed = await call('GET', `/spaces/${enc(uri)}/invites`, AUTH)
    expect(JSON.stringify(listed.json)).not.toContain(token)
    expect(listed.json.invites[0].uses).toBe(0)

    expect((await call('POST', '/invites/redeem', GUEST, { token })).status).toBe(200)
    // Same person again is idempotent, does not consume a second use.
    expect((await call('POST', '/invites/redeem', GUEST, { token })).status).toBe(200)
    // A second person hits the limit.
    expect((await call('POST', '/invites/redeem', STRANGER, { token })).status).toBe(404)
    expect((await call('GET', `/spaces/${enc(uri)}`, GUEST)).status).toBe(200)
    expect((await call('GET', `/spaces/${enc(uri)}`, STRANGER)).status).toBe(404)
    // `read` kind grants a read claim, not a seat.
    const members = await call('GET', `/spaces/${enc(uri)}/members`, AUTH)
    expect(members.json.members).toEqual([])

    // Expired
    const inv2 = await call('POST', `/spaces/${enc(uri)}/invites`, AUTH, { kind: 'join', expiresInHours: 1 })
    await pool.query(`update gate.invite set expires_at = now() - interval '1 minute' where id = $1`, [inv2.json.id])
    expect((await call('POST', '/invites/redeem', STRANGER, { token: inv2.json.token })).status).toBe(404)

    // Revoked
    const inv3 = await call('POST', `/spaces/${enc(uri)}/invites`, AUTH, { kind: 'join', expiresInHours: 1 })
    expect((await call('DELETE', `/invites/${inv3.json.id}`, AUTH)).status).toBe(204)
    expect((await call('POST', '/invites/redeem', STRANGER, { token: inv3.json.token })).status).toBe(404)

    // Unknown token, anonymous
    expect((await call('POST', '/invites/redeem', null, { token: 'x'.repeat(24) })).status).toBe(404)
    expect((await call('POST', '/invites/redeem', STRANGER, { token: 'x'.repeat(24) })).status).toBe(404)
  })

  it('join invites seat the redeemer at the invite role; only managers create or list invites', async () => {
    const uri = await mkSpace('coop.lexicon.space.group.calendar', 'm', MEMBERS_READ(10), MEMBERS_WRITE)
    const inv = await call('POST', `/spaces/${enc(uri)}/invites`, AUTH, { kind: 'join', expiresInHours: 2, role: 10 })
    expect((await call('POST', '/invites/redeem', GUEST, { token: inv.json.token })).json.role).toBe(10)
    expect((await call('GET', `/spaces/${enc(uri)}/records`, GUEST)).status).toBe(200)
    expect((await call('POST', `/spaces/${enc(uri)}/invites`, GUEST, { kind: 'join' })).status).toBe(404)
    expect((await call('GET', `/spaces/${enc(uri)}/invites`, GUEST)).status).toBe(404)
    expect((await call('GET', `/spaces/${enc(uri)}/invites`, STRANGER)).status).toBe(404)
  })

  it('shares grant a read claim to a named DID', async () => {
    const uri = await mkSpace('coop.lexicon.space.event.invite', 's', INVITE_READ, MEMBERS_WRITE)
    expect((await call('GET', `/spaces/${enc(uri)}`, GUEST)).status).toBe(404)
    expect((await call('PUT', `/spaces/${enc(uri)}/shares/${enc(GUEST)}`, AUTH)).status).toBe(204)
    expect((await call('GET', `/spaces/${enc(uri)}`, GUEST)).status).toBe(200)
    expect((await call('DELETE', `/spaces/${enc(uri)}/shares/${enc(GUEST)}`, AUTH)).status).toBe(204)
    expect((await call('GET', `/spaces/${enc(uri)}`, GUEST)).status).toBe(404)
    expect((await call('PUT', `/spaces/${enc(uri)}/shares/${enc(STRANGER)}`, GUEST)).status).toBe(404)
  })
})

describe('approvals (gated details)', () => {
  it('approval reveals the detail to that DID only; denial and removal take effect at once', async () => {
    const uri = await mkSpace('coop.lexicon.space.event.detail', 'house', GATED_DETAIL_READ)
    const rec = await call('POST', `/spaces/${enc(uri)}/records`, AUTH, { collection: 'coop.lexicon.event.detail', value: { exactLocation: '123 Elm St' } })
    const a = await call('POST', `/spaces/${enc(uri)}/requests`, GUEST)
    const b = await call('POST', `/spaces/${enc(uri)}/requests`, STRANGER)
    expect(a.status).toBe(202)
    expect(b.status).toBe(202)
    // Requesting against a space that does not exist looks exactly the same.
    const ghost = await call('POST', `/spaces/${enc('at://did:plc:authority/coop.lexicon.space.event.detail/ghost')}/requests`, GUEST)
    expect(ghost.status).toBe(202)
    expect(Object.keys(ghost.json).sort()).toEqual(Object.keys(a.json).sort())

    expect((await call('GET', `/records/${enc(rec.json.uri)}`, GUEST)).status).toBe(404)
    const pending = await call('GET', `/spaces/${enc(uri)}/requests`, AUTH)
    expect(pending.json.requests.map((r: { state: string }) => r.state)).toEqual(['pending', 'pending'])
    expect((await call('GET', `/spaces/${enc(uri)}/requests`, GUEST)).status).toBe(404)

    expect((await call('POST', `/requests/${a.json.id}`, AUTH, { action: 'approve' })).json.state).toBe('approved')
    expect((await call('POST', `/requests/${b.json.id}`, AUTH, { action: 'deny' })).json.state).toBe('denied')
    expect((await call('GET', `/records/${enc(rec.json.uri)}`, GUEST)).status).toBe(200)
    expect((await call('GET', `/records/${enc(rec.json.uri)}`, STRANGER)).status).toBe(404)
    expect((await call('POST', `/requests/${a.json.id}`, GUEST, { action: 'approve' })).status).toBe(404)

    // Removing the guest revokes the approval immediately.
    expect((await call('DELETE', `/spaces/${enc(uri)}/members/${enc(GUEST)}`, AUTH)).status).toBe(204)
    expect((await call('GET', `/records/${enc(rec.json.uri)}`, GUEST)).status).toBe(404)

    const audit = await call('GET', `/audit?space=${enc(uri)}`, AUTH)
    const actions = audit.json.entries.map((e: { action: string }) => e.action)
    expect(actions).toContain('request.approved')
    expect(actions).toContain('request.denied')
    expect(actions).toContain('member.remove')
    expect(JSON.stringify(audit.json)).not.toContain('Elm St')
    expect((await call('GET', `/audit?space=${enc(uri)}`, GUEST)).status).toBe(404)
  })

  it('a going RSVP in the space also counts as confirmed', async () => {
    const uri = await mkSpace('coop.lexicon.space.event.detail', 'rsvp', GATED_DETAIL_READ, MEMBERS_WRITE)
    const detail = await call('POST', `/spaces/${enc(uri)}/records`, AUTH, { collection: 'coop.lexicon.event.detail', value: { exactLocation: 'x' } })
    await call('PUT', `/spaces/${enc(uri)}/members/${enc(GUEST)}`, AUTH, { role: 10 })
    expect((await call('GET', `/records/${enc(detail.json.uri)}`, GUEST)).status).toBe(404)
    const r = await call('POST', `/spaces/${enc(uri)}/records`, GUEST, { collection: 'community.lexicon.calendar.rsvp', value: { status: 'community.lexicon.calendar.rsvp#going' } })
    expect(r.status).toBe(201)
    expect((await call('GET', `/records/${enc(detail.json.uri)}`, GUEST)).status).toBe(200)
  })
})

describe('blobs', () => {
  it('serves bytes only with a valid, unexpired, viewer-bound signature', async () => {
    const uri = await mkSpace('coop.lexicon.space.group.calendar', 'b', MEMBERS_READ(10), MEMBERS_WRITE)
    await call('PUT', `/spaces/${enc(uri)}/members/${enc(MEMBER)}`, AUTH, { role: 10 })
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])
    const up = await call('POST', `/spaces/${enc(uri)}/blobs`, AUTH, png, { 'content-type': 'image/png' })
    expect(up.status).toBe(201)
    const id = up.json.id as string
    expect((await call('GET', `/blobs/${id}/url`, STRANGER)).status).toBe(404)
    expect((await call('GET', `/blobs/${id}/url`, null)).status).toBe(404)
    const signed = await call('GET', `/blobs/${id}/url`, MEMBER)
    expect(signed.status).toBe(200)
    const u = new URL(signed.json.url)
    expect(u.origin).toBe('http://gate.test')
    // Bytes route needs no service header, only the signature.
    const ok = await app.request(u.pathname + u.search)
    expect(ok.status).toBe(200)
    expect(ok.headers.get('cache-control')).toContain('no-store')
    expect(Buffer.from(await ok.arrayBuffer())).toEqual(png)
    // Tampered viewer, tampered expiry, expired.
    const tv = new URL(u.toString())
    tv.searchParams.set('viewer', STRANGER)
    expect((await app.request(tv.pathname + tv.search)).status).toBe(404)
    const te = new URL(u.toString())
    te.searchParams.set('exp', String(Date.now() + 10 * 3_600_000))
    expect((await app.request(te.pathname + te.search)).status).toBe(404)
    const exp = Number(u.searchParams.get('exp'))
    expect(exp - Date.now()).toBeLessThanOrEqual(5 * 60_000)
    expect((await call('POST', `/spaces/${enc(uri)}/blobs`, AUTH, Buffer.from('x'), { 'content-type': 'text/plain' })).status).toBe(400)
  })
})

describe('retention', () => {
  it('purges expired invites and denies stale requests', async () => {
    const uri = await mkSpace('coop.lexicon.space.event.invite', 'r', INVITE_READ)
    const inv = await call('POST', `/spaces/${enc(uri)}/invites`, AUTH, { kind: 'read', expiresInHours: 1 })
    await pool.query(`update gate.invite set expires_at = now() - interval '2 days' where id = $1`, [inv.json.id])
    await call('POST', `/spaces/${enc(uri)}/requests`, GUEST)
    await pool.query(`update gate.access_request set requested_at = now() - interval '31 days'`)
    const r = await runRetention(pool)
    expect(r.invites).toBe(1)
    expect(r.requests).toBe(1)
    expect((await call('GET', `/spaces/${enc(uri)}/invites`, AUTH)).json.invites).toEqual([])
  })
})
