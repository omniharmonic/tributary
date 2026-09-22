/**
 * The builder surface (B1–B3) and push channels: API keys, the inbound webhook, the
 * inbound email worker. All idempotent by `externalId`.
 */
import { Hono } from 'hono'
import { and, eq, inArray } from 'drizzle-orm'
import { hmacHex, safeEqual } from '@tributary/identity'
import type { RawEvent, Visibility } from '@tributary/event-model'
import { config } from '../../config.js'
import { getDb } from '../../db/index.js'
import { host, inboundAddress, sourceEvent } from '../../db/schema.js'
import { recordAudit } from '../../lib/audit.js'
import { getHost, type HostRow } from '../../lib/hosts.js'
import { enqueueSync } from '../../jobs/index.js'
import { describeError, log } from '../../lib/logging.js'
import { detect } from '../../lib/preview.js'
import { connectSource, markPushedDeleted, pushRawEvents, pushSourceFor, SourceError } from '../../lib/sources.js'
import { ApiError, body, rateLimit, requireHost, type Vars } from '../context.js'
import { ledgerView } from './events.js'
import { queueExtraction } from './confirmations.js'
import { parseIcs } from '@tributary/connectors/ics'
import { defaultWindow } from '@tributary/connectors'

export const v1Routes = new Hono<{ Variables: Vars }>()

const VIS: Visibility[] = ['public', 'unlisted', 'gated', 'members', 'invite', 'held']

function toRaw(x: Record<string, unknown>): RawEvent {
  if (typeof x.externalId !== 'string' || !x.externalId) throw new ApiError(400, 'InvalidInput', 'externalId is required.')
  if (typeof x.name !== 'string' || !x.name.trim()) throw new ApiError(400, 'InvalidInput', 'name is required.')
  if (typeof x.start !== 'string') throw new ApiError(400, 'InvalidInput', 'start (ISO 8601) is required.')
  const raw: RawEvent = {
    externalId: x.externalId.slice(0, 200),
    name: x.name.trim().slice(0, 300),
    description: typeof x.description === 'string' ? x.description.slice(0, 20_000) : undefined,
    descriptionIsHtml: x.descriptionIsHtml === true,
    start: x.start,
    end: typeof x.end === 'string' ? x.end : undefined,
    tz: typeof x.tz === 'string' ? x.tz : undefined,
    allDay: x.allDay === true,
    status: typeof x.status === 'string' && ['scheduled', 'cancelled', 'postponed', 'rescheduled', 'planned'].includes(x.status) ? (x.status as RawEvent['status']) : undefined,
    mode: typeof x.mode === 'string' && ['inperson', 'virtual', 'hybrid'].includes(x.mode) ? (x.mode as RawEvent['mode']) : undefined,
    location: typeof x.location === 'string' ? x.location.slice(0, 500) : undefined,
    locations: Array.isArray(x.locations) ? (x.locations as RawEvent['locations']) : undefined,
    geo: typeof x.geo === 'object' && x.geo ? (x.geo as RawEvent['geo']) : undefined,
    url: typeof x.url === 'string' ? x.url : undefined,
    links: Array.isArray(x.links) ? (x.links as RawEvent['links']) : undefined,
    imageUrl: typeof x.imageUrl === 'string' ? x.imageUrl : undefined,
    organizerName: typeof x.organizerName === 'string' ? x.organizerName.slice(0, 200) : undefined,
    priceText: typeof x.priceText === 'string' ? x.priceText.slice(0, 100) : undefined,
    isFree: typeof x.isFree === 'boolean' ? x.isFree : undefined,
    tags: Array.isArray(x.tags) ? (x.tags as string[]).slice(0, 20) : undefined,
    category: typeof x.category === 'string' ? x.category : undefined,
    sourcePrivacy: x.visibility === 'held' ? 'private' : undefined,
    extra: typeof x.visibility === 'string' && VIS.includes(x.visibility as Visibility) ? { visibility: x.visibility, audience: x.audience, gatedFields: x.gatedFields } : undefined,
  }
  return raw
}

async function ingest(h: HostRow, channel: 'api' | 'webhook' | 'mcp', items: Record<string, unknown>[]): Promise<Array<{ externalId: string; action: string; atUri: string | null }>> {
  if (items.length > 200) throw new ApiError(400, 'InvalidInput', 'At most 200 events per call.')
  const src = await pushSourceFor(h, channel)
  const raws = items.map(toRaw)
  const before = await getDb().select({ externalId: sourceEvent.externalId, contentHash: sourceEvent.contentHash, atUri: sourceEvent.atUri }).from(sourceEvent).where(and(eq(sourceEvent.sourceId, src.id), inArray(sourceEvent.externalId, raws.map((r) => r.externalId))))
  await pushRawEvents(src.id, raws)
  // Per-event visibility from the API lands as a per-event override (narrowing rule still applies in reconcile).
  for (const r of raws) {
    const vis = r.extra?.visibility as Visibility | undefined
    if (vis) {
      const rows = await getDb().select().from(sourceEvent).where(and(eq(sourceEvent.sourceId, src.id), eq(sourceEvent.externalId, r.externalId))).limit(1)
      const override = { ...(rows[0]?.override ?? {}), visibility: vis, audience: r.extra?.audience, gatedFields: r.extra?.gatedFields }
      if (rows[0]) await getDb().update(sourceEvent).set({ override }).where(eq(sourceEvent.id, rows[0].id))
      else await getDb().insert(sourceEvent).values({ id: `ev_${Math.random().toString(36).slice(2, 14)}`, sourceId: src.id, hostId: h.id, externalId: r.externalId, occurrence: '', contentHash: '', normalized: {}, state: 'held', visibility: 'held', startsAt: new Date(r.start), override }).onConflictDoNothing()
    }
  }
  await enqueueSync(src.id, 'push')
  const after = await getDb().select({ externalId: sourceEvent.externalId, contentHash: sourceEvent.contentHash, atUri: sourceEvent.atUri, state: sourceEvent.state }).from(sourceEvent).where(and(eq(sourceEvent.sourceId, src.id), inArray(sourceEvent.externalId, raws.map((r) => r.externalId))))
  const prev = new Map(before.map((b) => [b.externalId, b]))
  return raws.map((r) => {
    const now = after.find((a) => a.externalId === r.externalId)
    const was = prev.get(r.externalId)
    const action = now?.state === 'held' ? 'held' : !was ? 'created' : was.contentHash === now?.contentHash ? 'unchanged' : 'updated'
    return { externalId: r.externalId, action, atUri: now?.atUri ?? null }
  })
}

/** Per-host budget for the builder surface: 600 writes an hour, 60 source connects. */
v1Routes.use('*', async (c, next) => {
  const h = requireHost(c)
  if (c.req.method !== 'GET') rateLimit(`v1:${h.id}`, 600, 3_600_000)
  await next()
})

v1Routes.post('/events', async (c) => {
  const h = requireHost(c)
  const b = await body<Record<string, unknown>>(c)
  const items = Array.isArray(b.events) ? (b.events as Record<string, unknown>[]) : [b]
  const results = await ingest(h, c.get('auth') === 'apikey' ? 'api' : 'api', items)
  return c.json({ results })
})

v1Routes.put('/events/:externalId', async (c) => {
  const h = requireHost(c)
  const b = await body<Record<string, unknown>>(c)
  const results = await ingest(h, 'api', [{ ...b, externalId: c.req.param('externalId') }])
  return c.json(results[0])
})

v1Routes.delete('/events/:externalId', async (c) => {
  const h = requireHost(c)
  const src = await pushSourceFor(h, 'api')
  const found = await markPushedDeleted(src.id, c.req.param('externalId'))
  if (!found) throw new ApiError(404, 'NotFound', 'No event with that externalId.')
  if (c.req.query('hard') === '1') {
    const rows = await getDb().select().from(sourceEvent).where(and(eq(sourceEvent.sourceId, src.id), eq(sourceEvent.externalId, c.req.param('externalId'))))
    for (const r of rows) await getDb().update(sourceEvent).set({ cancelledAt: new Date(Date.now() - 8 * 86_400_000), state: r.state === 'live' ? 'cancelled' : r.state }).where(eq(sourceEvent.id, r.id))
  }
  await enqueueSync(src.id, 'push')
  return c.json({ action: 'cancelled' })
})

v1Routes.get('/events', async (c) => {
  const h = requireHost(c)
  const rows = await getDb().select().from(sourceEvent).where(eq(sourceEvent.hostId, h.id)).orderBy(sourceEvent.startsAt).limit(500)
  return c.json({ events: rows.map(ledgerView), cursor: null })
})

v1Routes.post('/sources', async (c) => {
  const h = requireHost(c)
  rateLimit(`v1-sources:${h.id}`, 60, 3_600_000)
  const b = await body(c)
  const input = typeof b.input === 'string' ? b.input.trim() : ''
  if (!input) throw new ApiError(400, 'InvalidInput', 'input is required.')
  const matches = await detect({ text: input })
  const m = matches[0]
  if (!m || m.confidence === 0 || m.type === 'extract') throw new ApiError(400, 'SourceUnsupported', m?.note ?? 'No structured source found at that address.')
  try {
    const r = await connectSource(h, { type: m.type, platform: m.platform, match: m, defaultVisibility: (typeof b.defaultVisibility === 'string' ? b.defaultVisibility : 'public') as Visibility })
    return c.json({ sourceId: r.source.id, created: r.created, label: r.source.label }, 202)
  } catch (err) {
    if (err instanceof SourceError) throw new ApiError(err.status, err.code as never, err.message)
    throw err
  }
})

/* ── the inbound webhook (Zapier, Make, n8n) ────────────────────────────────── */

export const webhookRoutes = new Hono<{ Variables: Vars }>()

webhookRoutes.post('/:token', async (c) => {
  const rows = await getDb().select().from(inboundAddress).where(eq(inboundAddress.webhookToken, c.req.param('token'))).limit(1)
  const addr = rows[0]
  if (!addr) throw new ApiError(404, 'NotFound', 'Not found.')
  const h = await getHost(addr.hostId)
  if (!h) throw new ApiError(404, 'NotFound', 'Not found.')
  const raw = await c.req.text()
  const sig = c.req.header('x-tributary-signature')?.replace(/^sha256=/, '')
  const signed = !!sig && safeEqual(sig, hmacHex(addr.webhookSecret, raw))
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new ApiError(400, 'InvalidInput', 'Expected a JSON body.')
  }
  const items = Array.isArray(parsed.events) ? (parsed.events as Record<string, unknown>[]) : [parsed]
  if (!signed) {
    // Unsigned: hold for a person rather than publish.
    const extracted = items.map((x) => ({ raw: toRaw(x), confidence: {}, evidence: {}, flags: ['unsigned-webhook'] }))
    const pid = await queueExtraction(h.id, extracted, ['This arrived by webhook without a valid signature, so it waits for your confirmation.'], 'console')
    return c.json({ status: 'held', confirmationId: pid }, 202)
  }
  const results = await ingest(h, 'webhook', items)
  return c.json({ results })
})

/* ── inbound email (Cloudflare Email Worker → signed webhook) ───────────────── */

export const inboundEmailRoutes = new Hono<{ Variables: Vars }>()

inboundEmailRoutes.post('/', async (c) => {
  const k = config()
  if (!k.INBOUND_EMAIL_SECRET) throw new ApiError(404, 'NotFound', 'Not found.')
  const raw = await c.req.text()
  const sig = c.req.header('x-tributary-signature')?.replace(/^sha256=/, '')
  if (!sig || !safeEqual(sig, hmacHex(k.INBOUND_EMAIL_SECRET, raw))) throw new ApiError(401, 'Unauthorized', 'Bad signature.')
  const m = JSON.parse(raw) as { to: string; from: string; spf?: string; dkim?: string; dmarc?: string; raw: string }
  const token = /add\+([A-Za-z0-9_-]+)@/.exec(m.to)?.[1]
  if (!token) throw new ApiError(400, 'InvalidInput', 'No inbound token in the recipient.')
  const rows = await getDb().select().from(inboundAddress).where(eq(inboundAddress.emailToken, token)).limit(1)
  if (!rows[0]) throw new ApiError(404, 'NotFound', 'Not found.')
  const h = await getHost(rows[0].hostId)
  if (!h) throw new ApiError(404, 'NotFound', 'Not found.')
  const message = Buffer.from(m.raw, 'base64').toString('utf8')
  const senderAligned = !!h.email && m.from.toLowerCase().includes(h.email.toLowerCase()) && (m.dmarc === 'pass' || m.dkim === 'pass' || m.spf === 'pass')
  // `.ics` parts, by METHOD: REQUEST publishes/updates, CANCEL cancels.
  const icsParts = extractIcsParts(message)
  if (icsParts.length > 0) {
    const src = await pushSourceFor(h, 'email')
    const raws: RawEvent[] = []
    let cancels = 0
    for (const part of icsParts) {
      const parsed = parseIcs(part, { window: defaultWindow(), defaultTz: k.REGION_TZ })
      const isCancel = /^METHOD:CANCEL/im.test(part)
      for (const e of parsed.events) {
        if (isCancel) {
          cancels++
          raws.push({ ...e, status: 'cancelled' })
        } else raws.push(e)
      }
    }
    if (!senderAligned) {
      const pid = await queueExtraction(h.id, raws.map((r) => ({ raw: r, confidence: {}, evidence: {}, flags: ['unrecognized-sender'] })), ['This came from an address we do not recognise as yours, so it waits for your confirmation.'], 'email', src.id)
      return c.json({ status: 'held', confirmationId: pid }, 202)
    }
    await pushRawEvents(src.id, raws)
    await enqueueSync(src.id, 'push')
    await recordAudit({ hostId: h.id, actor: h.did, action: 'email.ics', detail: { events: raws.length, cancels } })
    return c.json({ status: 'published', events: raws.length })
  }
  // No calendar part: extract from the text and ask.
  try {
    const { extractEvents } = await import('../../lib/extract.js')
    const text = message.replace(/^.*?\r?\n\r?\n/s, '').replace(/<[^>]+>/g, ' ').slice(0, 60_000)
    const res = await extractEvents({ kind: 'email', text })
    if (res.events.length === 0) return c.json({ status: 'nothing-found' })
    const pid = await queueExtraction(h.id, res.events, res.notes, 'email')
    if (h.email) {
      const { sendMail } = await import('../../lib/mail.js')
      await sendMail({ to: h.email, subject: `Confirm ${res.events.length} event${res.events.length === 1 ? '' : 's'} from your email`, text: `We read ${res.events.length} event${res.events.length === 1 ? '' : 's'} from the email you forwarded. Nothing is published until you confirm:\n\n${k.WEB_PUBLIC_URL}/confirm/${pid}\n` })
    }
    return c.json({ status: 'held', confirmationId: pid }, 202)
  } catch (err) {
    log.warn('inbound email extraction failed', { detail: describeError(err) })
    return c.json({ status: 'held', confirmationId: null }, 202)
  }
})

/** Pull text/calendar parts out of an RFC822 message (base64 or quoted-printable or plain). */
export function extractIcsParts(message: string): string[] {
  const out: string[] = []
  const re = /Content-Type:\s*text\/calendar[^\n]*\n([\s\S]*?)\n\n([\s\S]*?)(?=\n--|\r?\n\.\r?\n|$)/gi
  for (const m of message.matchAll(re)) {
    const headers = m[1] ?? ''
    let bodyPart = m[2] ?? ''
    if (/Content-Transfer-Encoding:\s*base64/i.test(headers)) bodyPart = Buffer.from(bodyPart.replace(/\s+/g, ''), 'base64').toString('utf8')
    else if (/Content-Transfer-Encoding:\s*quoted-printable/i.test(headers)) bodyPart = bodyPart.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    if (/BEGIN:VCALENDAR/.test(bodyPart)) out.push(bodyPart)
  }
  if (out.length === 0 && /BEGIN:VCALENDAR/.test(message)) out.push(message.slice(message.indexOf('BEGIN:VCALENDAR'), message.indexOf('END:VCALENDAR') + 'END:VCALENDAR'.length))
  return out
}

void host
