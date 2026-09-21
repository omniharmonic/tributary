/**
 * F29 enforcement, against a real Postgres (tributary_test): viewers read only,
 * editors cannot touch owner-only account actions, owners can, strangers are refused.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { getDb, getPool, closeDb } from '../src/db/index.js'
import { runMigrations } from '../src/db/migrate.js'
import { host, orgRole } from '../src/db/schema.js'
import { createSession } from '../src/lib/sessions.js'
import { createApp } from '../src/http/app.js'

const app = createApp()
let ownerCookie = ''
let editorCookie = ''
let viewerCookie = ''
let strangerCookie = ''
const ORG = 'host_org'

async function req(path: string, cookie: string, init: { method?: string; acting?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { cookie, 'x-requested-with': 'tributary' }
  if (init.acting) headers['x-acting-host'] = init.acting
  if (init.body) headers['content-type'] = 'application/json'
  return app.request(path, { method: init.method ?? 'GET', headers, body: init.body ? JSON.stringify(init.body) : undefined })
}

beforeAll(async () => {
  await getPool().query('drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade;')
  await runMigrations()
  const db = getDb()
  const mk = (id: string, label: string) => ({ id, did: `did:plc:${id}`, handle: `${label}.test`, door: 'custodial', displayName: label, region: 'boulder', pdsUrl: 'http://localhost:3000' })
  await db.insert(host).values([mk(ORG, 'org'), mk('host_editor', 'editor'), mk('host_viewer', 'viewer'), mk('host_stranger', 'stranger')])
  await db.insert(orgRole).values([
    { hostId: ORG, did: 'did:plc:host_editor', role: 'editor' },
    { hostId: ORG, did: 'did:plc:host_viewer', role: 'viewer' },
  ])
  ownerCookie = `tb_session=${(await createSession(ORG)).cookie}`
  editorCookie = `tb_session=${(await createSession('host_editor')).cookie}`
  viewerCookie = `tb_session=${(await createSession('host_viewer')).cookie}`
  strangerCookie = `tb_session=${(await createSession('host_stranger')).cookie}`
})
afterAll(async () => {
  await closeDb()
})

describe('acting on behalf of a host', () => {
  it('lists managed hosts for the person', async () => {
    const r = await req('/api/me/managed', editorCookie)
    expect(r.status).toBe(200)
    const j = (await r.json()) as { hosts: Array<{ id: string; role: string }> }
    expect(j.hosts).toEqual([{ id: ORG, handle: 'org.test', displayName: 'org', role: 'editor' }])
  })
  it('switches the acting host and reports the role', async () => {
    const r = await req('/api/me', editorCookie, { acting: ORG })
    const j = (await r.json()) as { host: { id: string }; acting: { role: string; actorDid: string } }
    expect(j.host.id).toBe(ORG)
    expect(j.acting).toMatchObject({ role: 'editor', actorDid: 'did:plc:host_editor' })
  })
  it('lets a viewer read but not write', async () => {
    expect((await req('/api/sources', viewerCookie, { acting: ORG })).status).toBe(200)
    const r = await req('/api/me', viewerCookie, { acting: ORG, method: 'PATCH', body: { displayName: 'x' } })
    expect(r.status).toBe(403)
  })
  it('keeps owner-only actions from editors', async () => {
    expect((await req('/api/me/keys', editorCookie, { acting: ORG })).status).toBe(403)
    expect((await req('/api/me/roles', editorCookie, { acting: ORG })).status).toBe(403)
    expect((await req('/api/me', editorCookie, { acting: ORG, method: 'PATCH', body: { displayName: 'Renamed by editor' } })).status).toBe(200)
  })
  it('refuses strangers and honours the owner', async () => {
    expect((await req('/api/sources', strangerCookie, { acting: ORG })).status).toBe(403)
    expect((await req('/api/me/keys', ownerCookie)).status).toBe(200)
  })
})
