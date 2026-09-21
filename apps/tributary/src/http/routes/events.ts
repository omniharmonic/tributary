/**
 * The ledger view, per-event overrides, republish, and the audience (invites, requests)
 * of permissioned events through the Gate.
 */
import { Hono } from 'hono'
import { and, desc, eq, gte, lte, lt, sql } from 'drizzle-orm'
import { toCard, type NormalizedEvent, type Visibility } from '@tributary/event-model'
import { resolveHandle } from '@tributary/identity'
import { isWidening } from '@tributary/visibility'
import { config } from '../../config.js'
import { getDb } from '../../db/index.js'
import { pendingConfirmation, sourceEvent } from '../../db/schema.js'
import { recordAudit } from '../../lib/audit.js'
import { id } from '../../lib/ids.js'
import { enqueueSync } from '../../jobs/index.js'
import { COLLECTIONS, gate } from '../../pipeline/gate.js'
import { ApiError, body, notFound, requireHost, str, type Vars } from '../context.js'
import { imageUrlFor } from './public.js'

export const eventRoutes = new Hono<{ Variables: Vars }>()

type Row = typeof sourceEvent.$inferSelect

export function ledgerView(r: Row) {
  const n = r.normalized as unknown as NormalizedEvent
  return {
    id: r.id,
    sourceId: r.sourceId,
    externalId: r.externalId,
    occurrence: r.occurrence || null,
    state: r.state,
    visibility: r.visibility,
    visibilitySource: r.visibilitySource,
    card: toCard({ ...n, status: r.state === 'cancelled' ? 'cancelled' : n.status }, imageUrlFor(r)),
    atUri: r.atUri,
    atCid: r.atCid,
    spaceUri: r.spaceUri,
    teaserAtUri: r.teaserAtUri,
    firstSeen: r.firstSeen.toISOString(),
    lastSeen: r.lastSeen.toISOString(),
    missingSince: r.missingSince?.toISOString() ?? null,
    override: r.override ?? null,
    lastError: r.lastError,
  }
}

async function ownEvent(hostId: string, eventId: string): Promise<Row> {
  const rows = await getDb().select().from(sourceEvent).where(and(eq(sourceEvent.id, eventId), eq(sourceEvent.hostId, hostId))).limit(1)
  if (!rows[0]) throw notFound()
  return rows[0]
}

eventRoutes.get('/', async (c) => {
  const h = requireHost(c)
  const sourceId = c.req.query('sourceId')
  const state = c.req.query('state')
  const from = c.req.query('from') ? new Date(c.req.query('from')!) : new Date(Date.now() - 7 * 86_400_000)
  const to = c.req.query('to') ? new Date(c.req.query('to')!) : null
  const cursor = c.req.query('cursor')
  const limit = Math.min(Number(c.req.query('limit') ?? 100), 500)
  const conds = [eq(sourceEvent.hostId, h.id), gte(sourceEvent.startsAt, from)]
  if (sourceId) conds.push(eq(sourceEvent.sourceId, sourceId))
  if (state) conds.push(eq(sourceEvent.state, state))
  if (to) conds.push(lte(sourceEvent.startsAt, to))
  if (cursor) conds.push(sql`(${sourceEvent.startsAt}, ${sourceEvent.id}) > (${new Date(cursor.split('|')[0]!)}, ${cursor.split('|')[1] ?? ''})`)
  const rows = await getDb()
    .select()
    .from(sourceEvent)
    .where(and(...conds))
    .orderBy(sourceEvent.startsAt, sourceEvent.id)
    .limit(limit + 1)
  const page = rows.slice(0, limit)
  const next = rows.length > limit ? `${page[page.length - 1]!.startsAt.toISOString()}|${page[page.length - 1]!.id}` : null
  return c.json({ events: page.map(ledgerView), cursor: next })
})

eventRoutes.get('/:id', async (c) => {
  const h = requireHost(c)
  const r = await ownEvent(h.id, c.req.param('id'))
  return c.json(ledgerView(r))
})

eventRoutes.patch('/:id', async (c) => {
  const h = requireHost(c)
  const r = await ownEvent(h.id, c.req.param('id'))
  const b = await body(c)
  const override: Record<string, unknown> = { ...(r.override ?? {}) }
  if (typeof b.hidden === 'boolean') override.hidden = b.hidden
  if (typeof b.category === 'string') override.category = b.category
  if (b.imageUrl === null) delete override.imageUrl
  else if (typeof b.imageUrl === 'string') override.imageUrl = b.imageUrl
  if (Array.isArray(b.gatedFields)) override.gatedFields = b.gatedFields
  if (typeof b.audience === 'object' && b.audience) override.audience = b.audience
  let pending: string | null = null
  if (typeof b.visibility === 'string') {
    const to = b.visibility as Visibility
    if (isWidening(r.visibility as Visibility, to)) {
      const [p] = await getDb()
        .insert(pendingConfirmation)
        .values({ id: id('pc'), hostId: h.id, sourceId: r.sourceId, kind: 'widen', payload: { eventId: r.id, from: r.visibility, to, card: toCard(r.normalized as unknown as NormalizedEvent) }, expiresAt: new Date(Date.now() + 30 * 86_400_000) })
        .returning({ id: pendingConfirmation.id })
      pending = p!.id
    } else {
      override.visibility = to
      delete override.allowWidenTo
      await recordAudit({ hostId: h.id, actor: (c.get('actor') ?? h).did, action: 'event.narrowed', subject: r.id, detail: { from: r.visibility, to } })
    }
  }
  await getDb().update(sourceEvent).set({ override }).where(eq(sourceEvent.id, r.id))
  await enqueueSync(r.sourceId, 'manual')
  if (pending) return c.json({ pendingConfirmation: pending }, 202)
  return c.json({ ok: true })
})

eventRoutes.post('/:id/republish', async (c) => {
  const h = requireHost(c)
  const r = await ownEvent(h.id, c.req.param('id'))
  await getDb().update(sourceEvent).set({ contentHash: `force-${Date.now()}` }).where(eq(sourceEvent.id, r.id))
  await enqueueSync(r.sourceId, 'manual')
  return c.json({ ok: true }, 202)
})

/* ── audience ───────────────────────────────────────────────────────────────── */

/** What a viewer may see of a gated event: the detail record if the Gate says yes; the request state otherwise. */
export async function gateVisibility(r: Row, viewer: string | null): Promise<{ revealed: Record<string, unknown> | null; requestState: string | null }> {
  if (!r.spaceUri) return { revealed: null, requestState: null }
  const v = viewer as `did:${string}` | null
  try {
    const recs = await gate().listRecords<Record<string, unknown>>(r.spaceUri, v, COLLECTIONS.detail)
    const d = recs[0]?.value
    if (d) return { revealed: { exactLocation: d.exactLocation ?? null, exactPin: d.exactPin ?? null, joinUrl: d.joinUrl ?? null, attendeeNotes: d.attendeeNotes ?? null }, requestState: 'approved' }
  } catch {
    /* not permitted looks like not found */
  }
  if (!v) return { revealed: null, requestState: null }
  return { revealed: null, requestState: null }
}

eventRoutes.get('/:id/audience', async (c) => {
  const h = requireHost(c)
  const r = await ownEvent(h.id, c.req.param('id'))
  if (!r.spaceUri) throw new ApiError(400, 'InvalidInput', 'This event is not permissioned.')
  const did = h.did as `did:${string}`
  const [space, members, invites, requests] = await Promise.all([gate().getSpace(r.spaceUri, did), gate().listMembers(r.spaceUri, did).catch(() => []), gate().listInvites(r.spaceUri, did).catch(() => ({ invites: [] })), gate().listRequests(r.spaceUri, did).catch(() => ({ requests: [] }))])
  const withHandles = await Promise.all(
    requests.requests.map(async (q) => ({ ...q, handle: await handleFor(q.did) })),
  )
  return c.json({ spaceUri: r.spaceUri, policy: space?.readPolicy ?? null, members: members.length, invites: invites.invites, requests: withHandles })
})

async function handleFor(did: string): Promise<string | null> {
  try {
    const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) return null
    return ((await res.json()) as { handle?: string }).handle ?? null
  } catch {
    return null
  }
}

eventRoutes.post('/:id/invites', async (c) => {
  const h = requireHost(c)
  const r = await ownEvent(h.id, c.req.param('id'))
  if (!r.spaceUri) throw new ApiError(400, 'InvalidInput', 'This event is not permissioned.')
  const b = await body(c)
  const kind = (str(b.kind, 'kind', { optional: true }) || 'read-join') as 'join' | 'read' | 'read-join'
  const inv = await gate().createInvite(r.spaceUri, h.did as `did:${string}`, { kind, expiresInHours: typeof b.expiresInHours === 'number' ? b.expiresInHours : 72, maxUses: typeof b.maxUses === 'number' ? b.maxUses : 20 })
  await recordAudit({ hostId: h.id, actor: (c.get('actor') ?? h).did, action: 'invite.created', subject: r.id, detail: { kind } })
  const rkey = r.atUri?.split('/').pop() ?? r.rkey
  return c.json({ id: inv.id, url: `${config().WEB_PUBLIC_URL}/join/${inv.token}?e=${encodeURIComponent(`${h.did}/${rkey}`)}`, expiresAt: inv.expiresAt }, 201)
})

eventRoutes.delete('/:id/invites/:inviteId', async (c) => {
  const h = requireHost(c)
  await ownEvent(h.id, c.req.param('id'))
  await gate().revokeInvite(c.req.param('inviteId'), h.did as `did:${string}`)
  return c.json({ ok: true })
})

eventRoutes.post('/:id/invite-people', async (c) => {
  const h = requireHost(c)
  const r = await ownEvent(h.id, c.req.param('id'))
  if (!r.spaceUri) throw new ApiError(400, 'InvalidInput', 'This event is not permissioned.')
  const b = await body(c)
  const handles = Array.isArray(b.handles) ? (b.handles as string[]).slice(0, 50) : []
  const emails = Array.isArray(b.emails) ? (b.emails as string[]).slice(0, 50) : []
  const resolved: Array<{ handle: string; did: string }> = []
  for (const raw of handles) {
    const handle = raw.trim().toLowerCase().replace(/^@/, '')
    const did = await resolveHandle(handle, config().PDS_URL).catch(() => null)
    const remote = did ?? (await fetch(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`).then((x) => (x.ok ? x.json() : null)).then((j) => (j as { did?: string } | null)?.did ?? null).catch(() => null))
    if (remote) {
      await gate().share(r.spaceUri, h.did as `did:${string}`, remote as `did:${string}`)
      resolved.push({ handle, did: remote })
    }
  }
  // Email invitations become a DID at redemption: send each address a join link.
  const pendingEmails: string[] = []
  if (emails.length) {
    const inv = await gate().createInvite(r.spaceUri, h.did as `did:${string}`, { kind: 'read-join', expiresInHours: 24 * 14, maxUses: emails.length })
    const { sendMail } = await import('../../lib/mail.js')
    const rkey = r.atUri?.split('/').pop() ?? r.rkey
    const n = r.normalized as unknown as NormalizedEvent
    for (const e of emails) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) continue
      await sendMail({ to: e, subject: `${h.displayName} invited you: ${n.name}`, text: `${h.displayName} has invited you to ${n.name}.\n\nSee the details and RSVP:\n${config().WEB_PUBLIC_URL}/join/${inv.token}?e=${encodeURIComponent(`${h.did}/${rkey}`)}\n\nThis link expires in two weeks.\n` })
      pendingEmails.push(e)
    }
  }
  await recordAudit({ hostId: h.id, actor: (c.get('actor') ?? h).did, action: 'invite.people', subject: r.id, detail: { handles: resolved.length, emails: pendingEmails.length } })
  return c.json({ resolved, pendingEmails })
})

eventRoutes.post('/:id/requests/:requestId', async (c) => {
  const h = requireHost(c)
  const r = await ownEvent(h.id, c.req.param('id'))
  const b = await body(c)
  const action = str(b.action, 'action')
  if (action !== 'approve' && action !== 'deny') throw new ApiError(400, 'InvalidInput', 'action must be approve or deny.')
  const res = await gate().decideRequest(c.req.param('requestId'), h.did as `did:${string}`, action)
  await recordAudit({ hostId: h.id, actor: (c.get('actor') ?? h).did, action: `request.${action}`, subject: r.id })
  return c.json(res)
})

/** Redeem a join link as the signed-in viewer. */
export const joinRoutes = new Hono<{ Variables: Vars }>()
joinRoutes.post('/:token', async (c) => {
  const viewer = requireHost(c)
  const res = await gate().redeemInvite(c.req.param('token'), viewer.did as `did:${string}`)
  return c.json(res)
})

/** Old pending widenings are irrelevant once the event has passed. */
export async function expireStaleWidenings(): Promise<void> {
  await getDb().update(pendingConfirmation).set({ resolvedAt: new Date(), resolution: 'expired' }).where(and(eq(pendingConfirmation.kind, 'widen'), lt(pendingConfirmation.expiresAt, new Date())))
}

void desc
