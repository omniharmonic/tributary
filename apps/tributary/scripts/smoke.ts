/**
 * End-to-end smoke (architecture §18): boot the Gate and Tributary against a local
 * Postgres and a local reference PDS, serve a golden fixture feed from loopback, then
 * paste → detect → preview → signup → verify → connect → publish → verify on the PDS →
 * edit at the source → re-sync → record updated → cancel → cancelled record.
 *
 *   PDS_ADMIN_PASSWORD=… pnpm --filter @tributary/tributary smoke
 *
 * Requires: Postgres at $DATABASE_URL (default tributary_smoke), a PDS at $PDS_URL
 * (default http://localhost:3000, handle domain `test`).
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertValidEventRecord } from '@tributary/event-model'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const DB = process.env.DATABASE_URL ?? 'postgres://localhost:5432/tributary_smoke'
const PDS = process.env.PDS_URL ?? 'http://localhost:3000'
const ADMIN = process.env.PDS_ADMIN_PASSWORD ?? ''
const SECRET = 'smoke-gate-secret-smoke-gate-secret-0123456789'
const T = 'http://localhost:4199'
const G = 'http://localhost:4299'

function fail(msg: string): never {
  console.error(`SMOKE FAIL: ${msg}`)
  process.exit(1)
}
function ok(msg: string): void {
  console.log(`  ok  ${msg}`)
}

async function waitFor(url: string, ms = 60_000): Promise<void> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    try {
      const r = await fetch(url)
      if (r.ok || r.status === 503) return
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  fail(`${url} did not come up`)
}

function child(name: string, app: string, env: Record<string, string>): ChildProcess {
  const cwd = path.join(root, 'apps', app)
  const p = spawn(path.join(cwd, 'node_modules/.bin/tsx'), ['src/index.ts'], { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  p.stdout?.on('data', (d) => process.stdout.write(`[${name}] ${d}`))
  p.stderr?.on('data', (d) => process.stderr.write(`[${name}] ${d}`))
  return p
}

async function main(): Promise<void> {
  if (!ADMIN) fail('PDS_ADMIN_PASSWORD is required')
  // 0. Reset the smoke database.
  const pg = await import('pg')
  const pool = new pg.default.Pool({ connectionString: DB })
  await pool.query('drop schema if exists public cascade; create schema public; drop schema if exists gate cascade; drop schema if exists pgboss cascade; drop schema if exists drizzle cascade;')
  await pool.end()

  // 1. A fixture feed on loopback we can mutate between syncs.
  let feed = readFileSync(path.join(root, 'fixtures/ics/google-basic.ics'), 'utf8')
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/feed.ics')) {
      res.writeHead(200, { 'content-type': 'text/calendar; charset=utf-8' })
      res.end(feed)
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const port = (server.address() as { port: number }).port
  const feedUrl = `http://127.0.0.1:${port}/feed.ics`

  // 2. Boot the Gate and Tributary.
  const gate = child('gate', 'gate', { GATE_PORT: '4299', DATABASE_URL: DB, GATE_SERVICE_SECRET: SECRET, GATE_BLOB_DIR: path.join(root, 'tmp/gate-blobs') })
  const trib = child('tributary', 'tributary', {
    NODE_ENV: 'development',
    TRIBUTARY_PORT: '4199',
    DATABASE_URL: DB,
    PDS_URL: PDS,
    PDS_ADMIN_PASSWORD: ADMIN,
    PDS_HANDLE_DOMAIN: 'test',
    PDS_ALLOW_PRIVATE: '1',
    TRIBUTARY_ALLOW_PRIVATE_FETCH: '1',
    TRIBUTARY_MIN_SPACING_MS: '0',
    GATE_URL: G,
    GATE_SERVICE_SECRET: SECRET,
    TRIBUTARY_NO_JOBS: '1',
    WEB_PUBLIC_URL: T,
    DEV_MAIL_LOG: path.join(root, 'tmp/smoke-mail.log'),
  })
  const cleanup = () => {
    gate.kill()
    trib.kill()
    server.close()
  }
  process.on('exit', cleanup)
  try {
    await waitFor(`${G}/health`)
    await waitFor(`${T}/api/public/health`)
    ok('gate and tributary are up')

    const json = async (method: string, url: string, body?: unknown, cookie?: string) => {
      const r = await fetch(url, { method, headers: { 'content-type': 'application/json', 'x-requested-with': 'tributary', accept: 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined })
      const text = await r.text()
      let data: unknown
      try {
        data = JSON.parse(text)
      } catch {
        data = text
      }
      return { status: r.status, data: data as Record<string, unknown>, headers: r.headers }
    }

    // 3. Detect and preview.
    const det = await json('POST', `${T}/api/detect`, { input: feedUrl })
    const match = (det.data.matches as Array<Record<string, unknown>>)?.[0]
    if (!match || match.type !== 'ics') fail(`detect did not pick ics: ${JSON.stringify(det.data).slice(0, 300)}`)
    ok(`detect → ${match.label}`)
    const pv = await json('POST', `${T}/api/preview`, { match })
    if (pv.status !== 200 || !(pv.data.count as number) || !(pv.data.cards as unknown[]).length) fail(`preview failed: ${JSON.stringify(pv.data).slice(0, 400)}`)
    ok(`preview → ${pv.data.count} events, ${(pv.data.cards as unknown[]).length} cards, notes: ${JSON.stringify(pv.data.notes)}`)

    // 4. Door B.
    const label = `smoke${Date.now().toString(36).slice(-6)}`
    const su = await json('POST', `${T}/api/auth/signup`, { email: `${label}@example.org`, displayName: 'Smoke Test Org', handle: label, previewId: pv.data.previewId, visibility: 'public' })
    if (su.status !== 202 || !su.data.verifyUrl) fail(`signup failed: ${JSON.stringify(su.data)}`)
    ok(`signup → ${su.data.handle} (magic link in dev sink)`)
    const verify = await fetch((su.data.verifyUrl as string).replace('/auth/verify', '/api/auth/verify'), { headers: { accept: 'application/json' }, redirect: 'manual' })
    const setCookie = verify.headers.get('set-cookie') ?? ''
    const cookie = setCookie.split(';')[0] ?? ''
    const vbody = (await verify.json()) as Record<string, unknown>
    if (!vbody.ok || !cookie) fail(`verify failed: ${JSON.stringify(vbody)}`)
    ok(`verify → account minted, session set, redirect ${vbody.redirect}`)

    // 5. The source was connected and synced inline (no jobs).
    const me = await json('GET', `${T}/api/me`, undefined, cookie)
    const did = (me.data.host as { did: string }).did
    const srcs = await json('GET', `${T}/api/sources`, undefined, cookie)
    const src = (srcs.data.sources as Array<Record<string, unknown>>)[0]
    if (!src) fail('no source after verify')
    const counts = src.counts as { live: number }
    if (!counts.live) fail(`source has no live events: ${JSON.stringify(src)}`)
    ok(`source ${src.label}: ${counts.live} live, status ${src.status}`)
    const ev = await json('GET', `${T}/api/events`, undefined, cookie)
    const events = ev.data.events as Array<Record<string, unknown>>
    const published = events.filter((e) => e.atUri)
    if (published.length === 0) fail('no events with atUri')
    ok(`ledger: ${events.length} rows, ${published.length} published`)

    // 6. Verify on the PDS: every record validates and carries attribution.
    const list = await fetch(`${PDS}/xrpc/com.atproto.repo.listRecords?repo=${did}&collection=community.lexicon.calendar.event&limit=100`).then((r) => r.json() as Promise<{ records: Array<{ uri: string; value: unknown }> }>)
    if (list.records.length !== published.length) fail(`PDS has ${list.records.length} records, ledger says ${published.length}`)
    for (const r of list.records) assertValidEventRecord(r.value)
    const first = list.records[0]!.value as Record<string, unknown>
    ok(`PDS: ${list.records.length} records validate; createdWith=${first.createdWith}; timezone=${first.timezone}`)

    // 7. Public directory view.
    const pub = await json('GET', `${T}/api/public/events`)
    if (!(pub.data.events as unknown[]).length) fail('public events empty')
    ok(`public directory shows ${(pub.data.events as unknown[]).length} cards`)
    const card = (pub.data.events as Array<Record<string, unknown>>)[0]!
    const one = await json('GET', `${T}/api/public/events/${card.did}/${card.rkey}`)
    if (one.status !== 200) fail('public event page 404')
    const ics = await fetch(`${T}/api/public/regions/boulder/calendar.ics`).then((r) => r.text())
    if (!ics.includes('BEGIN:VEVENT')) fail('region ics feed empty')
    ok('event page and region webcal feed respond')

    // 8. No-change re-sync produces zero writes (F9).
    const before = list.records.map((r) => (r as { cid?: string }).cid ?? JSON.stringify(r.value))
    await json('POST', `${T}/api/sources/${src.id}/sync`, {}, cookie)
    const src2 = await json('GET', `${T}/api/sources/${src.id}`, undefined, cookie)
    const lastRun = (src2.data.syncRuns as Array<Record<string, number>>)[0]!
    if (lastRun.published !== 0 || lastRun.updated !== 0) fail(`re-sync wrote: ${JSON.stringify(lastRun)}`)
    ok(`re-sync: unchanged=${lastRun.unchanged}, zero writes`)
    void before

    // 9. Edit at the source → updated record (F8).
    const firstName = (list.records[0]!.value as { name: string }).name
    feed = feed.replace(`SUMMARY:${firstName}`, `SUMMARY:${firstName} (renamed)`)
    if (!feed.includes('(renamed)')) fail(`could not rename ${firstName} in the fixture`)
    await new Promise((r) => setTimeout(r, 61_000)) // per-source manual sync rate limit
    await json('POST', `${T}/api/sources/${src.id}/sync`, {}, cookie)
    const list2 = await fetch(`${PDS}/xrpc/com.atproto.repo.listRecords?repo=${did}&collection=community.lexicon.calendar.event&limit=100`).then((r) => r.json() as Promise<{ records: Array<{ value: { name: string } }> }>)
    if (!list2.records.some((r) => r.value.name.endsWith('(renamed)'))) fail('renamed event not updated on the PDS')
    ok('source edit propagated to the repo')

    // 9b. Verified source: token placed in the feed → provenance rises.
    const tok = await json('POST', `${T}/api/sources/${src.id}/verify`, {}, cookie)
    if (!tok.data.token) fail(`no verification token: ${JSON.stringify(tok.data)}`)
    const miss = await json('POST', `${T}/api/sources/${src.id}/verify/check`, {}, cookie)
    if (miss.data.verified !== false) fail('verification passed before the token was placed')
    feed = feed.replace(/^X-WR-CALNAME:(.*)$/m, `X-WR-CALNAME:$1\nX-WR-CALDESC:Verified with ${tok.data.token}`)
    const hit = await json('POST', `${T}/api/sources/${src.id}/verify/check`, {}, cookie)
    if (hit.data.verified !== true) fail(`verification failed: ${JSON.stringify(hit.data)}`)
    const me2 = await json('GET', `${T}/api/me`, undefined, cookie)
    if ((me2.data.host as { provenanceLevel: string }).provenanceLevel !== 'source') fail('provenance did not rise to source')
    ok('verified source: token found in the feed, provenance is now "source"')

    // 10. Narrow to unlisted at once, then delete everything.
    const target = events.find((e) => e.atUri)!
    const patch = await json('PATCH', `${T}/api/events/${target.id}`, { visibility: 'unlisted' }, cookie)
    if (patch.status !== 200) fail(`narrowing failed: ${JSON.stringify(patch.data)}`)
    const rec = await fetch(`${PDS}/xrpc/com.atproto.repo.getRecord?repo=${did}&collection=community.lexicon.calendar.event&rkey=${(target.atUri as string).split('/').pop()}`).then((r) => r.json() as Promise<{ value: { preferences: { showInDiscovery: boolean } } }>)
    if (rec.value.preferences.showInDiscovery !== false) fail('unlisted did not set showInDiscovery=false')
    ok('narrowing to unlisted applied immediately')
    const del = await json('POST', `${T}/api/me/delete`, { confirm: 'delete everything' }, cookie)
    if (del.status !== 200) fail(`delete failed: ${JSON.stringify(del.data)}`)
    const gone = await fetch(`${PDS}/xrpc/com.atproto.repo.listRecords?repo=${did}&collection=community.lexicon.calendar.event`)
    ok(`delete everything → records removed=${del.data.removed}, repo status ${gone.status}`)
    console.log('SMOKE PASS')
    cleanup()
    process.exit(0)
  } catch (err) {
    console.error(err)
    cleanup()
    process.exit(1)
  }
}

void main()
