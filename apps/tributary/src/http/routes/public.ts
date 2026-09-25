/**
 * Anonymous routes: config, the one-box (detect/preview), the public directory view,
 * calendar feeds, the image proxy, health. Public reads never return unlisted,
 * members, invite or held events; a gated event appears as its teaser only.
 */
import { Hono } from 'hono'
import { DateTime } from 'luxon'
import { and, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm'
import { groupDuplicates, toCard, type NormalizedEvent } from '@tributary/event-model'
import { config } from '../../config.js'
import { getDb, getPool } from '../../db/index.js'
import { host, imageCache, sourceEvent } from '../../db/schema.js'
import { getHostByHandle, publicHost } from '../../lib/hosts.js'
import { buildPreview, detect, loadPreview } from '../../lib/preview.js'
import { gate } from '../../pipeline/gate.js'
import { parseNear, searchEvents, searchHealth } from '../../search/index.js'
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
    const base = (config().PDS_INTERNAL_URL || config().PDS_URL).replace(/\/$/, '')
    const r = await fetch(`${base}/xrpc/_health`, { signal: AbortSignal.timeout(4000) })
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
  // Search is optional: 'off' must not make the deployment look unhealthy.
  checks.search = await searchHealth()
  const ok = Object.entries(checks).every(([k, v]) => v === 'ok' || (k === 'search' && v === 'off'))
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

export interface PublicEvent {
  card: ReturnType<typeof toCard>
  host: { did: string; handle: string; displayName: string; provenanceLevel: string }
  did: string
  rkey: string | null
  atUri: string | null
  audienceName: string | null
}

/** The shape the console reads: the card, plus where it lives and who published it. */
export function publicCard(row: typeof sourceEvent.$inferSelect, h: typeof host.$inferSelect): PublicEvent {
  const n = row.normalized as unknown as NormalizedEvent
  const card = toCard({ ...n, status: row.state === 'cancelled' ? 'cancelled' : n.status }, imageUrlFor(row))
  return {
    card,
    host: { did: h.did, handle: h.handle, displayName: h.displayName, provenanceLevel: h.provenanceLevel },
    did: h.did,
    rkey: row.atUri?.split('/').pop() ?? null,
    atUri: row.atUri,
    audienceName: null,
  }
}

/**
 * A keyset cursor over `(startsAt, id)`.
 *
 * Browsing used to answer one `limit`-sized slice and report `cursor: null`, so on a
 * directory of nineteen hundred events a visitor saw the soonest two hundred and the
 * calendar appeared to stop about three weeks out. The ledger held eight months.
 *
 * `startsAt` alone cannot be the key: twenty things start at 7pm on a Friday, and a
 * cursor that is not unique either repeats that Friday forever or skips most of it.
 * The ledger id breaks the tie, so every row is visited exactly once.
 */
export function encodeCursor(startsAt: Date, id: string): string {
  return Buffer.from(`${startsAt.toISOString()}|${id}`, 'utf8').toString('base64url')
}

export function decodeCursor(raw: string | undefined): { startsAt: Date; id: string } | undefined {
  if (!raw) return undefined
  const [iso, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|')
  if (!iso || !id) return undefined
  const startsAt = new Date(iso)
  // A cursor is opaque to the caller, so a mangled one is a normal thing to receive.
  // Treat it as "start from the beginning" rather than failing the whole page.
  if (Number.isNaN(startsAt.getTime())) return undefined
  return { startsAt, id }
}

/** The chronological page: the requested window, resumed after the cursor. */
function pageWindow(from: Date, to: Date, cursor: string | undefined): SQL | undefined {
  const after = decodeCursor(cursor)
  // A row-value comparison is the whole point: `startsAt > x OR (startsAt = x AND id > y)`
  // written out by hand reads the same but does not use the (state, starts_at) index.
  const keyset = after ? sql`(${sourceEvent.startsAt}, ${sourceEvent.id}) > (${after.startsAt.toISOString()}::timestamptz, ${after.id})` : undefined
  return and(gte(sourceEvent.startsAt, from), lte(sourceEvent.startsAt, to), ...(keyset ? [keyset] : []))
}

/**
 * The cursor for the next page, or null at the end.
 *
 * A short page means the ledger is exhausted. A full page might also be the end, but
 * saying "there may be more" and answering the follow-up with nothing is cheap;
 * stopping one page early hides events, which is the bug this replaces.
 */
function lastCursor(rows: Array<{ e: typeof sourceEvent.$inferSelect }>, limit: number): string | null {
  if (rows.length < limit) return null
  // Only correct because `fetchRows` orders by `(startsAt, id)`: the last row must be the
  // greatest under the same comparison the next page's keyset uses.
  const last = rows[rows.length - 1]
  return last ? encodeCursor(last.e.startsAt, last.e.id) : null
}

publicRoutes.get('/events', async (c) => {
  const k = config()
  const region = c.req.query('region') ?? k.REGION_SLUG
  const from = c.req.query('from') ? new Date(c.req.query('from')!) : new Date(Date.now() - 3 * 3_600_000)
  const to = c.req.query('to') ? new Date(c.req.query('to')!) : new Date(Date.now() + 120 * 86_400_000)
  const category = c.req.query('category')
  const q = c.req.query('q')?.trim().toLowerCase()
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 100) || 100, 1), 500)
  const cursorParam = c.req.query('cursor') || undefined
  // `near=lat,lon` with an optional `radiusKm`. The index carries coordinates for public
  // events only — a gated event is indexed without `_geo` — so a radius search can
  // never disclose a withheld address, and there is no separate check to forget.
  const near = parseNear(c.req.query('near'))
  const radiusKm = near ? Math.min(Math.max(Number(c.req.query('radiusKm') ?? 25) || 25, 0.1), 200) : undefined

  // Postgres always re-asserts region, state and visibility, whatever the index said, so
  // a bug in the indexing path can never widen what a stranger sees.
  const guards = [eq(host.region, region), inArray(sourceEvent.state, ['live', 'cancelled']), inArray(sourceEvent.visibility, PUBLIC_VIS)] as const
  const fetchRows = (extra: SQL | undefined, ordered: boolean) => {
    const query = getDb()
      .select({ e: sourceEvent, h: host })
      .from(sourceEvent)
      .innerJoin(host, eq(host.id, sourceEvent.hostId))
      .where(and(...guards, ...(extra ? [extra] : [])))
    // The sort must match the cursor exactly, `id` included. Ordering by `startsAt`
    // alone leaves ties in whatever order Postgres felt like, so the last row of a page
    // is not necessarily the largest id among the rows sharing its instant — and then
    // the next page both repeats some of that instant and skips the rest of it. Caught
    // by walking all 1,329 events in production and finding one shown twice.
    return ordered ? query.orderBy(sourceEvent.startsAt, sourceEvent.id).limit(limit) : query.limit(limit)
  }

  // Ranking must drive the fetch, not filter it. Selecting a chronological page and then
  // intersecting it with the hits throws away every match that falls later than the page
  // reaches, so on a directory of any size a search for a real word returns almost
  // nothing. Ask the index first, then read exactly those rows.
  let rows: Awaited<ReturnType<typeof fetchRows>>
  let rank: Map<string, number> | undefined
  // The index pages by offset and the ledger pages by key, so the two produce different
  // cursors. Both are opaque to the caller, and a cursor is only ever replayed against
  // the same filters that produced it, so they never meet.
  let nextCursor: string | null = null
  if (q || near) {
    const found = await searchEvents({ q, region, category, from, to, limit, near, radiusKm, cursor: cursorParam })
    if (found.available) {
      nextCursor = found.cursor
      const ids = found.hits.map((h) => h.id)
      rank = new Map(ids.map((id, i) => [id, i]))
      rows = ids.length === 0 ? [] : await fetchRows(inArray(sourceEvent.id, ids), false)
    } else {
      // The index is down. A text query falls back to a substring scan of the
      // chronological page rather than showing an empty directory; a radius cannot be
      // done at all without the index, so a geo-only request degrades to that plain page.
      const all = await fetchRows(pageWindow(from, to, cursorParam), true)
      rows = q
        ? all.filter(({ e, h }) => {
            const p = publicCard(e, h)
            return `${p.card.name} ${p.card.place ?? ''} ${p.card.excerpt ?? ''} ${p.host.displayName}`.toLowerCase().includes(q)
          })
        : all
      nextCursor = lastCursor(all, limit)
    }
  } else {
    rows = await fetchRows(pageWindow(from, to, cursorParam), true)
    nextCursor = lastCursor(rows, limit)
  }

  // Group duplicates on the card's own fields, then carry the winner's whole event through.
  const byKey = new Map(rows.map(({ e, h }) => [e.id, publicCard(e, h)]))
  const grouped = groupDuplicates(
    rows.map(({ e, h }) => {
      const p = byKey.get(e.id)!
      return { key: e.id, name: p.card.name, startsAt: p.card.startsAt, timezone: p.card.timezone, sourceUrl: p.card.sourceUrl, platform: p.card.platform, rank: h.door === 'listed' ? 1 : 0, publishedAt: e.firstSeen.toISOString() }
    }),
  )
  // `key` is the ledger id: keep it beside the event so the search ranking can join on it.
  let cards = grouped.map((g) => ({ id: g.key, event: { ...byKey.get(g.key)!, alsoOn: g.alsoOn } }))
  // The index already applied the category for a search; this covers the browse path.
  if (category && !rank) cards = cards.filter((x) => x.event.card.category === category || x.event.card.tags.includes(category))
  if (rank) cards.sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER))
  // A radius with no words is browsing, not searching: put it back in time order.
  if (near && !q) cards.sort((a, b) => a.event.card.startsAt.localeCompare(b.event.card.startsAt))
  c.header('Cache-Control', 'public, max-age=60')
  return c.json({ events: cards.map((x) => x.event), cursor: nextCursor })
})

/**
 * How many events fall on each day, for the week strip and the month grid.
 *
 * The strip used to count whatever the page had loaded, which made it quietly lie: with
 * a hundred events loaded it reported "nothing on Wednesday" while thirty things were
 * listed, because the page simply had not reached Wednesday yet. A count is either
 * counted over everything or it is not a count.
 *
 * Grouping happens in the region's own zone, so "Friday" means the Friday a reader in
 * Boulder is looking at, not a UTC day that starts at 6pm on Thursday.
 */
publicRoutes.get('/events/counts', async (c) => {
  const k = config()
  const region = c.req.query('region') ?? k.REGION_SLUG
  const from = c.req.query('from') ? new Date(c.req.query('from')!) : new Date(Date.now() - 3 * 3_600_000)
  const to = c.req.query('to') ? new Date(c.req.query('to')!) : new Date(Date.now() + 120 * 86_400_000)
  const category = c.req.query('category')
  const tz = k.REGION_TZ
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new ApiError(400, 'InvalidInput', 'from and to must be dates.')

  const rows = await getDb()
    .select({
      day: sql<string>`to_char(${sourceEvent.startsAt} at time zone ${tz}, 'YYYY-MM-DD')`,
      n: sql<number>`count(*)::int`,
    })
    .from(sourceEvent)
    .innerJoin(host, eq(host.id, sourceEvent.hostId))
    .where(
      and(
        eq(host.region, region),
        inArray(sourceEvent.state, ['live', 'cancelled']),
        inArray(sourceEvent.visibility, PUBLIC_VIS),
        gte(sourceEvent.startsAt, from),
        lte(sourceEvent.startsAt, to),
        // The category chip matches an assigned category or any source tag, exactly as
        // the listing does, so the count and the list can never disagree.
        // `jsonb_exists` rather than the `?` operator: a bare `?` in a query string is too
        // easy to mistake for a placeholder by anything that rewrites SQL on the way past.
        ...(category ? [sql`(${sourceEvent.normalized}->>'category' = ${category} or jsonb_exists(${sourceEvent.normalized}->'tags', ${category}))`] : []),
      ),
    )
    .groupBy(sql`1`)

  const days: Record<string, number> = {}
  for (const r of rows) days[r.day] = Number(r.n)
  c.header('Cache-Control', 'public, max-age=120')
  return c.json({ days })
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
  const ev = publicCard(e, h)
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
  return c.json({ ...ev, descriptionMd: n.descriptionMd ?? null, locations, links: n.links, revealed, requestState, cancelled: e.state === 'cancelled' })
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
/**
 * The subscribable feed. Google Calendar, Apple Calendar and Outlook all poll a URL
 * like this one, so two details matter more than they look:
 *
 *  - an all-day event is written `VALUE=DATE`, not as a UTC instant. Written as an
 *    instant, "all day Saturday" arrives in a reader east of us as Friday night;
 *  - `REFRESH-INTERVAL` is the only way to ask a subscriber to come back sooner than
 *    its own default, which in Google's case is measured in many hours.
 */
export function icsFor(items: Array<{ n: NormalizedEvent; uid: string; cancelled: boolean }>, name: string, opts: { url?: string } = {}): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${config().ADAPTER_NAME}//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(name)}`,
    `NAME:${icsEscape(name)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT2H',
    'X-PUBLISHED-TTL:PT2H',
    ...(opts.url ? [`SOURCE;VALUE=URI:${opts.url}`, `URL:${opts.url}`] : []),
  ]
  for (const { n, uid, cancelled } of items) {
    const l = n.locations[0]
    const place = n.visibility === 'gated' ? [l?.locality, l?.region].filter(Boolean).join(', ') : [l?.name, l?.street, l?.locality, l?.region].filter(Boolean).join(', ')
    lines.push('BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${icsDate(n.provenance.fetchedAt)}`)
    if (n.start.allDay) {
      const startDay = DateTime.fromISO(n.start.instant, { zone: 'utc' }).setZone(n.start.tz).startOf('day')
      // DTEND is exclusive for a date value, and the model's `end` is exclusive too
      // (`formatWhen` subtracts a day to name the last one). A source that gives an
      // all-day event an end on its own start date would otherwise produce
      // `DTEND == DTSTART` — a zero-length event that readers drop on the floor.
      const endDay = n.end ? DateTime.fromISO(n.end.instant, { zone: 'utc' }).setZone(n.start.tz).startOf('day') : startDay
      const exclusive = endDay > startDay ? endDay : startDay.plus({ days: 1 })
      lines.push(`DTSTART;VALUE=DATE:${startDay.toFormat('yyyyLLdd')}`)
      lines.push(`DTEND;VALUE=DATE:${exclusive.toFormat('yyyyLLdd')}`)
    } else {
      lines.push(`DTSTART:${icsDate(n.start.instant)}`)
      if (n.end) lines.push(`DTEND:${icsDate(n.end.instant)}`)
    }
    lines.push(`SUMMARY:${icsEscape(n.name)}`)
    if (place) lines.push(`LOCATION:${icsEscape(place)}`)
    // Only an exact, public place becomes a coordinate, for the same reason the card does.
    if (n.visibility !== 'gated' && !l?.private && l?.precision === 'exact' && l.lat !== undefined && l.lon !== undefined) lines.push(`GEO:${l.lat};${l.lon}`)
    lines.push(`URL:${n.sourceUrl}`)
    if (n.category || n.tags.length) lines.push(`CATEGORIES:${icsEscape([n.category, ...n.tags].filter(Boolean).join(','))}`)
    if (n.descriptionMd) lines.push(`DESCRIPTION:${icsEscape(n.descriptionMd.slice(0, 2000))}`)
    if (cancelled || n.status === 'cancelled') lines.push('STATUS:CANCELLED')
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map((l) => (l.length > 74 ? (l.match(/.{1,73}/g) ?? [l]).join('\r\n ') : l)).join('\r\n') + '\r\n'
}

/**
 * The regional feed, narrowed by the same query the directory page uses: `category`,
 * `q`, and `near`/`radiusKm`. Whatever a visitor has filtered to, they can subscribe to
 * exactly that in Google Calendar, Apple Calendar or Outlook — the feed URL carries the
 * filters, so the subscription keeps meaning the same thing as it refills.
 */
publicRoutes.get('/regions/:region/calendar.ics', async (c) => {
  const k = config()
  const region = c.req.param('region')
  const category = c.req.query('category')?.trim().toLowerCase()
  const q = c.req.query('q')?.trim().toLowerCase()
  const near = parseNear(c.req.query('near'))
  const radiusKm = near ? Math.min(Math.max(Number(c.req.query('radiusKm') ?? 25) || 25, 0.1), 200) : undefined
  const from = new Date(Date.now() - 86_400_000)
  const to = new Date(Date.now() + 120 * 86_400_000)
  const LIMIT = 1000

  const guards = [eq(host.region, region), eq(sourceEvent.state, 'live'), inArray(sourceEvent.visibility, PUBLIC_VIS)] as const
  const read = (extra: SQL | undefined) =>
    getDb()
      .select({ e: sourceEvent, h: host })
      .from(sourceEvent)
      .innerJoin(host, eq(host.id, sourceEvent.hostId))
      .where(and(...guards, ...(extra ? [extra] : [])))
      .orderBy(sourceEvent.startsAt)
      .limit(LIMIT)

  let rows: Awaited<ReturnType<typeof read>>
  if (q || near) {
    const found = await searchEvents({ q, region, category, from, to, limit: LIMIT, near, radiusKm })
    rows = found.available ? (found.hits.length ? await read(inArray(sourceEvent.id, found.hits.map((x) => x.id))) : []) : await read(and(gte(sourceEvent.startsAt, from), lte(sourceEvent.startsAt, to)))
  } else {
    rows = await read(and(gte(sourceEvent.startsAt, from), lte(sourceEvent.startsAt, to)))
  }

  const items = rows
    .map(({ e }) => ({ n: e.normalized as unknown as NormalizedEvent, uid: `${e.id}@${new URL(k.WEB_PUBLIC_URL).hostname}`, cancelled: false }))
    // The category chip is applied here too, so it still narrows the feed when the index
    // answered the text half of the query.
    .filter(({ n }) => !category || n.category === category || n.tags.includes(category))
  const label = [k.BRAND_NAME, category, q ? `“${q}”` : undefined, near ? 'nearby' : undefined].filter(Boolean).join(' · ')
  c.header('Content-Type', 'text/calendar; charset=utf-8')
  c.header('Cache-Control', 'public, max-age=900')
  return c.body(icsFor(items, label, { url: `${k.WEB_PUBLIC_URL}/api/public/regions/${encodeURIComponent(region)}/calendar.ics${new URL(c.req.url).search}` }))
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
  return c.body(icsFor(rows.map((e) => ({ n: e.normalized as unknown as NormalizedEvent, uid: `${e.id}@${new URL(config().WEB_PUBLIC_URL).hostname}`, cancelled: false })), h.displayName, { url: `${config().WEB_PUBLIC_URL}/api/public/hosts/${encodeURIComponent(h.handle)}/calendar.ics` }))
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
  const { lastReports } = await import('../../jobs/checks.js')
  return c.json({ hosts: Number(hosts?.n ?? 0), liveUpcoming: Number(live?.n ?? 0), withImage: Number(complete?.n ?? 0), lastPublishedAt: recent[0]?.firstSeen ?? null, checks: lastReports })
})

export { str }
