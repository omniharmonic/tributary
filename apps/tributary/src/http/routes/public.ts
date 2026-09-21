/**
 * Anonymous routes: config, the one-box (detect/preview), the public directory view,
 * calendar feeds, the image proxy, health. Public reads never return unlisted,
 * members, invite or held events; a gated event appears as its teaser only.
 */
import { Hono } from 'hono'
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { toCard, type NormalizedEvent } from '@tributary/event-model'
import { config } from '../../config.js'
import { getDb, getPool } from '../../db/index.js'
import { host, imageCache, sourceEvent } from '../../db/schema.js'
import { getHostByHandle, publicHost } from '../../lib/hosts.js'
import { buildPreview, detect, loadPreview } from '../../lib/preview.js'
import { gate } from '../../pipeline/gate.js'
import { ApiError, clientIp, notFound, rateLimit, requireHost, str, type AppContext, type Vars } from '../context.js'
import { gateVisibility } from './events.js'

export const publicRoutes = new Hono<{ Variables: Vars }>()
/** The one-box: mounted at /api/{detect,preview} per the contract. */
export const oneBoxRoutes = new Hono<{ Variables: Vars }>()

publicRoutes.get('/config', (c) => {
  const k = config()
  return c.json({ region: { slug: k.REGION_SLUG, name: k.REGION_NAME, tz: k.REGION_TZ }, handleDomain: k.handleDomain, brand: k.BRAND_NAME, adapterName: k.ADAPTER_NAME, extraction: !!k.EXTRACT_MODEL_API_KEY })
})

publicRoutes.get('/health', async (c) => {
  const checks: Record<string, string> = {}
  try {
    await getPool().query('select 1')
    checks.postgres = 'ok'
  } catch {
    checks.postgres = 'down'
  }
  try {
    const r = await fetch(`${config().PDS_URL.replace(/\/$/, '')}/xrpc/_health`, { signal: AbortSignal.timeout(4000) })
    checks.pds = r.ok ? 'ok' : 'down'
  } catch {
    checks.pds = 'down'
  }
  try {
    await gate().health()
    checks.gate = 'ok'
  } catch {
    checks.gate = 'down'
  }
  const ok = Object.values(checks).every((v) => v === 'ok')
  return c.json({ status: ok ? 'ok' : 'degraded', checks, version: process.env.TRIBUTARY_VERSION ?? 'dev' }, ok ? 200 : 503)
})

async function readInput(c: AppContext): Promise<{ text?: string; file?: { name: string; mime: string; bytes: Buffer }; match?: unknown }> {
  const ct = c.req.header('content-type') ?? ''
  if (ct.includes('multipart/form-data')) {
    const form = await c.req.formData()
    const f = form.get('file')
    const text = form.get('input')
    const match = form.get('match')
    const file = f && typeof f !== 'string' ? { name: f.name, mime: f.type || 'application/octet-stream', bytes: Buffer.from(await f.arrayBuffer()) } : undefined
    if (file && file.bytes.length > 15 * 1024 * 1024) throw new ApiError(400, 'InvalidInput', 'Files must be under 15 MB.')
    return { text: typeof text === 'string' ? text : undefined, file, match: typeof match === 'string' && match ? JSON.parse(match) : undefined }
  }
  const j = (await c.req.json().catch(() => ({}))) as { input?: string; match?: unknown }
  return { text: j.input, match: j.match }
}

oneBoxRoutes.post('/detect', async (c) => {
  rateLimit(`detect:${clientIp(c)}`, 30, 60_000)
  const { text, file } = await readInput(c)
  if (!text?.trim() && !file) throw new ApiError(400, 'InvalidInput', 'Paste a link, drop a file, or describe an event.')
  const matches = await detect({ text: text?.trim(), file })
  return c.json({ matches, preview: null })
})

oneBoxRoutes.post('/preview', async (c) => {
  rateLimit(`preview:${clientIp(c)}`, 20, 60_000)
  const { file, match } = await readInput(c)
  if (!match || typeof match !== 'object') throw new ApiError(400, 'InvalidInput', 'A detect match is required.')
  const m = match as { type?: string }
  if (!m.type) throw new ApiError(400, 'InvalidInput', 'A detect match is required.')
  const { previewId, summary, expiresAt } = await buildPreview(match as never, file)
  return c.json({ previewId, ...summary, expiresAt: expiresAt.toISOString() })
})

oneBoxRoutes.get('/preview/:id', async (c) => {
  const p = await loadPreview(c.req.param('id'))
  if (!p) throw notFound()
  return c.json({ previewId: p.id, ...(p.summary as object), expiresAt: p.expiresAt.toISOString() })
})

/* ── the directory view ─────────────────────────────────────────────────────── */

const PUBLIC_VIS = ['public', 'gated']

export function imageUrlFor(row: { atUri: string | null; blob: unknown; imageHash: string | null; normalized: unknown }): string | undefined {
  const n = row.normalized as NormalizedEvent
  if (row.imageHash) return `/api/public/cache-img/${row.imageHash}`
  return n.image?.url
}

export function publicCard(row: typeof sourceEvent.$inferSelect, h: typeof host.$inferSelect) {
  const n = row.normalized as unknown as NormalizedEvent
  const card = toCard({ ...n, status: row.state === 'cancelled' ? 'cancelled' : n.status }, imageUrlFor(row))
  const rkey = row.atUri?.split('/').pop() ?? null
  return { ...card, did: h.did, rkey, atUri: row.atUri, host: { did: h.did, handle: h.handle, displayName: h.displayName, provenanceLevel: h.provenanceLevel }, audienceName: null }
}

publicRoutes.get('/events', async (c) => {
  const k = config()
  const region = c.req.query('region') ?? k.REGION_SLUG
  const from = c.req.query('from') ? new Date(c.req.query('from')!) : new Date(Date.now() - 3 * 3_600_000)
  const to = c.req.query('to') ? new Date(c.req.query('to')!) : new Date(Date.now() + 120 * 86_400_000)
  const category = c.req.query('category')
  const q = c.req.query('q')?.trim().toLowerCase()
  const limit = Math.min(Number(c.req.query('limit') ?? 200), 500)
  const rows = await getDb()
    .select({ e: sourceEvent, h: host })
    .from(sourceEvent)
    .innerJoin(host, eq(host.id, sourceEvent.hostId))
    .where(and(eq(host.region, region), inArray(sourceEvent.state, ['live', 'cancelled']), inArray(sourceEvent.visibility, PUBLIC_VIS), gte(sourceEvent.startsAt, from), lte(sourceEvent.startsAt, to)))
    .orderBy(sourceEvent.startsAt)
    .limit(limit)
  let cards = rows.map(({ e, h }) => publicCard(e, h))
  if (category) cards = cards.filter((x) => x.category === category || x.tags.includes(category))
  if (q) cards = cards.filter((x) => `${x.name} ${x.place ?? ''} ${x.excerpt ?? ''} ${x.host.displayName}`.toLowerCase().includes(q))
  c.header('Cache-Control', 'public, max-age=60')
  return c.json({ events: cards, cursor: null })
})

async function findPublicEvent(did: string, rkey: string) {
  const rows = await getDb()
    .select({ e: sourceEvent, h: host })
    .from(sourceEvent)
    .innerJoin(host, eq(host.id, sourceEvent.hostId))
    .where(and(eq(host.did, did), eq(sourceEvent.atUri, `at://${did}/community.lexicon.calendar.event/${rkey}`), inArray(sourceEvent.state, ['live', 'cancelled'])))
    .limit(1)
  const r = rows[0]
  if (!r || !['public', 'gated', 'unlisted'].includes(r.e.visibility)) return null
  return r
}

publicRoutes.get('/events/:did/:rkey', async (c) => {
  const rkeyParam = c.req.param('rkey')
  const wantsIcs = rkeyParam.endsWith('.ics')
  const rkey = rkeyParam.replace(/\.ics$/, '')
  const found = await findPublicEvent(c.req.param('did'), rkey)
  if (!found) throw notFound()
  const { e, h } = found
  const n = e.normalized as unknown as NormalizedEvent
  if (wantsIcs) {
    c.header('Content-Type', 'text/calendar; charset=utf-8')
    return c.body(icsFor([{ n, uid: `${rkey}@${new URL(config().WEB_PUBLIC_URL).hostname}`, cancelled: e.state === 'cancelled' }], n.name))
  }
  const viewer = c.get('host')
  const card = publicCard(e, h)
  const coarse = n.visibility === 'gated' || (n.gatedFields ?? []).includes('exactLocation')
  const locations = n.locations.map((l) => (coarse && !l.private ? { name: l.locality, locality: l.locality, region: l.region, coarse: true } : coarse ? { locality: l.locality, region: l.region, coarse: true } : { name: l.name, street: l.street, locality: l.locality, region: l.region, coarse: false }))
  let revealed: Record<string, unknown> | null = null
  let requestState: string | null = null
  if (n.visibility === 'gated' && e.spaceUri) {
    const g = await gateVisibility(e, viewer?.did ?? null)
    revealed = g.revealed
    requestState = g.requestState
  }
  c.header('Cache-Control', viewer ? 'private, no-store' : 'public, max-age=60')
  return c.json({ ...card, descriptionMd: n.descriptionMd ?? null, locations, links: n.links, revealed, requestState, cancelled: e.state === 'cancelled' })
})


publicRoutes.post('/events/:did/:rkey/request', async (c) => {
  const viewer = requireHost(c)
  const found = await findPublicEvent(c.req.param('did'), c.req.param('rkey'))
  if (!found || !found.e.spaceUri) throw notFound()
  const r = await gate().requestAccess(found.e.spaceUri, viewer.did as `did:${string}`)
  return c.json({ state: r.state })
})

publicRoutes.get('/hosts/:handle', async (c) => {
  const h = await getHostByHandle(c.req.param('handle'))
  if (!h) throw notFound()
  const rows = await getDb()
    .select()
    .from(sourceEvent)
    .where(and(eq(sourceEvent.hostId, h.id), inArray(sourceEvent.state, ['live', 'cancelled']), inArray(sourceEvent.visibility, PUBLIC_VIS), gte(sourceEvent.startsAt, new Date(Date.now() - 3 * 3_600_000))))
    .orderBy(sourceEvent.startsAt)
    .limit(200)
  c.header('Cache-Control', 'public, max-age=60')
  return c.json({ host: { ...publicHost(h), email: undefined, paused: undefined, about: null }, events: rows.map((e) => publicCard(e, h)) })
})

function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}
function icsDate(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}
export function icsFor(items: Array<{ n: NormalizedEvent; uid: string; cancelled: boolean }>, name: string): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${config().ADAPTER_NAME}//EN`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsEscape(name)}`]
  for (const { n, uid, cancelled } of items) {
    const l = n.locations[0]
    const place = n.visibility === 'gated' ? [l?.locality, l?.region].filter(Boolean).join(', ') : [l?.name, l?.street, l?.locality, l?.region].filter(Boolean).join(', ')
    lines.push('BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${icsDate(n.provenance.fetchedAt)}`, `DTSTART:${icsDate(n.start.instant)}`)
    if (n.end) lines.push(`DTEND:${icsDate(n.end.instant)}`)
    lines.push(`SUMMARY:${icsEscape(n.name)}`)
    if (place) lines.push(`LOCATION:${icsEscape(place)}`)
    lines.push(`URL:${n.sourceUrl}`)
    if (n.descriptionMd) lines.push(`DESCRIPTION:${icsEscape(n.descriptionMd.slice(0, 2000))}`)
    if (cancelled || n.status === 'cancelled') lines.push('STATUS:CANCELLED')
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map((l) => (l.length > 74 ? (l.match(/.{1,73}/g) ?? [l]).join('\r\n ') : l)).join('\r\n') + '\r\n'
}

publicRoutes.get('/regions/:region/calendar.ics', async (c) => {
  const rows = await getDb()
    .select({ e: sourceEvent, h: host })
    .from(sourceEvent)
    .innerJoin(host, eq(host.id, sourceEvent.hostId))
    .where(and(eq(host.region, c.req.param('region')), eq(sourceEvent.state, 'live'), inArray(sourceEvent.visibility, PUBLIC_VIS), gte(sourceEvent.startsAt, new Date(Date.now() - 86_400_000))))
    .orderBy(sourceEvent.startsAt)
    .limit(1000)
  c.header('Content-Type', 'text/calendar; charset=utf-8')
  c.header('Cache-Control', 'public, max-age=900')
  return c.body(icsFor(rows.map(({ e }) => ({ n: e.normalized as unknown as NormalizedEvent, uid: `${e.id}@${new URL(config().WEB_PUBLIC_URL).hostname}`, cancelled: false })), `${config().BRAND_NAME}`))
})

publicRoutes.get('/hosts/:handle/calendar.ics', async (c) => {
  const h = await getHostByHandle(c.req.param('handle'))
  if (!h) throw notFound()
  const rows = await getDb()
    .select()
    .from(sourceEvent)
    .where(and(eq(sourceEvent.hostId, h.id), eq(sourceEvent.state, 'live'), inArray(sourceEvent.visibility, PUBLIC_VIS), gte(sourceEvent.startsAt, new Date(Date.now() - 86_400_000))))
    .orderBy(sourceEvent.startsAt)
    .limit(500)
  c.header('Content-Type', 'text/calendar; charset=utf-8')
  c.header('Cache-Control', 'public, max-age=900')
  return c.body(icsFor(rows.map((e) => ({ n: e.normalized as unknown as NormalizedEvent, uid: `${e.id}@${new URL(config().WEB_PUBLIC_URL).hostname}`, cancelled: false })), h.displayName))
})

/* ── images ─────────────────────────────────────────────────────────────────── */

publicRoutes.get('/cache-img/:hash', async (c) => {
  const rows = await getDb().select().from(imageCache).where(eq(imageCache.hash, c.req.param('hash'))).limit(1)
  const r = rows[0]
  if (!r) throw notFound()
  c.header('Content-Type', r.mime)
  c.header('Cache-Control', 'public, max-age=31536000, immutable')
  return c.body(new Uint8Array(r.bytes))
})

/** The image proxy: `/img/<did>/<cid>` resolves a published blob, from our cache first, then the repo's PDS. */
publicRoutes.get('/img/:did/:cid', async (c) => {
  const did = c.req.param('did')
  const cid = c.req.param('cid')
  const rows = await getDb()
    .select({ imageHash: sourceEvent.imageHash })
    .from(sourceEvent)
    .innerJoin(host, eq(host.id, sourceEvent.hostId))
    .where(and(eq(host.did, did), sql`${sourceEvent.blob}->'ref'->>'$link' = ${cid}`))
    .limit(1)
  if (rows[0]?.imageHash) {
    const img = await getDb().select().from(imageCache).where(eq(imageCache.hash, rows[0].imageHash)).limit(1)
    if (img[0]) {
      c.header('Content-Type', img[0].mime)
      c.header('Cache-Control', 'public, max-age=31536000, immutable')
      return c.body(new Uint8Array(img[0].bytes))
    }
  }
  const h = (await getDb().select().from(host).where(eq(host.did, did)).limit(1))[0]
  if (!h) throw notFound()
  const res = await fetch(`${h.pdsUrl.replace(/\/$/, '')}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw notFound()
  const bytes = Buffer.from(await res.arrayBuffer())
  c.header('Content-Type', res.headers.get('content-type') ?? 'image/jpeg')
  c.header('Cache-Control', 'public, max-age=31536000, immutable')
  return c.body(new Uint8Array(bytes))
})

publicRoutes.get('/stats', async (c) => {
  const k = config()
  if (!k.STEWARD_KEY || c.req.header('x-steward-key') !== k.STEWARD_KEY) throw notFound()
  const [hosts] = await getDb().select({ n: sql<number>`count(*)` }).from(host)
  const [live] = await getDb().select({ n: sql<number>`count(*)` }).from(sourceEvent).where(and(eq(sourceEvent.state, 'live'), gte(sourceEvent.startsAt, new Date())))
  const [complete] = await getDb().select({ n: sql<number>`count(*)` }).from(sourceEvent).where(and(eq(sourceEvent.state, 'live'), gte(sourceEvent.startsAt, new Date()), sql`${sourceEvent.imageHash} is not null`))
  const recent = await getDb().select().from(sourceEvent).orderBy(desc(sourceEvent.firstSeen)).limit(1)
  return c.json({ hosts: Number(hosts?.n ?? 0), liveUpcoming: Number(live?.n ?? 0), withImage: Number(complete?.n ?? 0), lastPublishedAt: recent[0]?.firstSeen ?? null })
})

export { str }
