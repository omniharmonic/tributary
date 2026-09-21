/**
 * One sync of one source: ingest → parse → normalize → enrich → classify → reconcile →
 * publish → observe. The scheduler guarantees a source never runs concurrently with
 * itself; everything here is written so a crash mid-run leaves the ledger consistent
 * (each event's row is updated only after its record write succeeded).
 */
import { and, eq } from 'drizzle-orm'
import { connectorFor, defaultWindow, ConnectorError, type FetchCtx, type RawEvent } from '@tributary/connectors'
import { PUSH_SOURCE_TYPES } from '@tributary/connectors'
import { normalize, NormalizeError, toCard, type NormalizedEvent, type Visibility } from '@tributary/event-model'
import { tid, unwrapSecret } from '@tributary/identity'
import { fetchAndPrepareImage, publishEvent, unpublishEvent, WriterAuthError, type PreparedImage } from '@tributary/publisher'
import { applyClassification, classify, isPublicLevel, type VisibilityRule } from '@tributary/visibility'
import { config } from '../config.js'
import { getDb } from '../db/index.js'
import { imageCache, pendingConfirmation, pushedEvent, source, sourceEvent, syncRun, visibilityRule } from '../db/schema.js'
import { getHost, HostPausedError, pauseHost, writerFor, type HostRow } from '../lib/hosts.js'
import { httpClient } from '../lib/http-client.js'
import { id } from '../lib/ids.js'
import { describeError, log } from '../lib/logging.js'
import { deletePermissioned, writePermissioned } from './gate.js'
import { enrich } from './enrich.js'
import { planReconcile, type Action, type LedgerRow } from './reconcile.js'

export const INTERVAL_FLOOR_MS = 10 * 60_000
export const INTERVAL_CEILING_MS = 6 * 3_600_000
export const PAUSE_AFTER_FAILING_MS = 14 * 86_400_000

type SourceRow = typeof source.$inferSelect
type EventRow = typeof sourceEvent.$inferSelect

export interface SyncSummary {
  ok: boolean
  notModified: boolean
  fetched: number
  published: number
  updated: number
  unchanged: number
  cancelled: number
  removed: number
  held: number
  failed: number
  pending: number
  error?: { code: string; message: string }
}

function plainError(err: unknown): { code: string; message: string } {
  if (err instanceof ConnectorError) {
    const messages: Record<string, string> = {
      NotFound: 'Your calendar could not be found at that address any more.',
      Gone: 'Your calendar has been removed at the source.',
      Forbidden: 'Your calendar is no longer public.',
      RateLimited: 'The source asked us to slow down; we will try again later.',
      Unparseable: 'We could not read what the source sent back.',
      Unsupported: 'This source is not supported yet.',
      Network: 'We could not reach the source.',
      TooLarge: 'The feed is too large to read.',
      Other: 'Something went wrong reading the source.',
    }
    return { code: err.code === 'Forbidden' || err.code === 'NotFound' || err.code === 'Gone' ? 'SourceUnreachable' : err.code === 'Unsupported' ? 'SourceUnsupported' : 'SourceUnreachable', message: messages[err.code] ?? messages.Other! }
  }
  if (err instanceof HostPausedError) return { code: 'HostPaused', message: err.reason === 'credential-rejected' ? 'Your account no longer lets us publish. Reconnect from Settings.' : 'Publishing is paused for this account.' }
  if (err instanceof WriterAuthError) return { code: 'HostPaused', message: 'Your account no longer lets us publish. Reconnect from Settings.' }
  return { code: 'Internal', message: 'Something went wrong on our side. We will try again.' }
}

/** Raw events for push sources come from the pushed-event table, deletes as cancellations. */
async function pushedRawEvents(sourceId: string): Promise<RawEvent[]> {
  const rows = await getDb().select().from(pushedEvent).where(eq(pushedEvent.sourceId, sourceId))
  return rows.map((r) => {
    const raw = r.raw as unknown as RawEvent
    return r.deleted ? { ...raw, status: 'cancelled' as const } : raw
  })
}

async function fetchCtx(s: SourceRow): Promise<FetchCtx> {
  const c = config()
  const secrets: Record<string, string> = {}
  if (c.GOOGLE_API_KEY) secrets.GOOGLE_API_KEY = c.GOOGLE_API_KEY
  if (s.secretsCiphertext && s.secretsKeyVersion) {
    try {
      Object.assign(secrets, JSON.parse(unwrapSecret({ keyVersion: s.secretsKeyVersion, blob: s.secretsCiphertext }, c.custodyKeys)))
    } catch (err) {
      log.warn('could not unwrap source secrets', { detail: describeError(err) })
    }
  }
  return { http: httpClient(), secrets, log, window: defaultWindow(), etag: s.etag ?? undefined, lastModified: s.lastModified ?? undefined, defaultTz: s.tz }
}

function toLedgerRow(r: EventRow): LedgerRow {
  return {
    id: r.id,
    externalId: r.externalId,
    occurrence: r.occurrence,
    contentHash: r.contentHash,
    state: r.state as LedgerRow['state'],
    visibility: r.visibility as Visibility,
    visibilitySource: r.visibilitySource,
    atUri: r.atUri,
    spaceUri: r.spaceUri,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    missingSince: r.missingSince,
    missingRuns: r.missingRuns,
    cancelledAt: r.cancelledAt,
    override: r.override ?? null,
    normalized: r.normalized as unknown as NormalizedEvent,
  }
}

async function loadRules(sourceId: string): Promise<VisibilityRule[]> {
  const rows = await getDb().select().from(visibilityRule).where(eq(visibilityRule.sourceId, sourceId)).orderBy(visibilityRule.position)
  return rows.map((r) => ({ match: r.match as VisibilityRule['match'], level: r.level as Visibility, audience: (r.audience as VisibilityRule['audience']) ?? undefined, gatedFields: (r.gatedFields as VisibilityRule['gatedFields']) ?? undefined }))
}

/** Resolve the image bytes for an event: cached by hash, fetched by URL. */
async function imageFor(e: NormalizedEvent): Promise<PreparedImage | null> {
  const db = getDb()
  if (e.image?.bytesRef) {
    const rows = await db.select().from(imageCache).where(eq(imageCache.hash, e.image.bytesRef)).limit(1)
    const r = rows[0]
    if (r) return { bytes: r.bytes, mime: r.mime as PreparedImage['mime'], width: r.width, height: r.height, hash: r.hash, sourceHash: r.sourceHash ?? r.hash }
  }
  if (e.image?.url) {
    const rows = await db.select().from(imageCache).where(eq(imageCache.sourceUrl, e.image.url)).limit(1)
    const r = rows[0]
    if (r) return { bytes: r.bytes, mime: r.mime as PreparedImage['mime'], width: r.width, height: r.height, hash: r.hash, sourceHash: r.sourceHash ?? r.hash }
    const prepared = await fetchAndPrepareImage(e.image.url, httpClient()).catch(() => undefined)
    if (!prepared) return null
    await db
      .insert(imageCache)
      .values({ hash: prepared.hash, sourceUrl: e.image.url, sourceHash: prepared.sourceHash, mime: prepared.mime, width: prepared.width, height: prepared.height, bytes: prepared.bytes })
      .onConflictDoUpdate({ target: imageCache.hash, set: { sourceUrl: e.image.url } })
    return prepared
  }
  return null
}

/** State of a ledger row for a published level. */
function stateFor(e: NormalizedEvent): EventRow['state'] {
  if (e.visibility === 'held') return 'held'
  return e.status === 'cancelled' ? 'cancelled' : 'live'
}

/**
 * Put an event where its level says it goes, tearing down whatever an older placement
 * left behind. Returns the ledger fields to store.
 */
async function place(h: HostRow, s: SourceRow, e: NormalizedEvent, existing: EventRow | null): Promise<Partial<EventRow>> {
  const c = config()
  const rkey = existing?.rkey ?? tid()
  const level = e.visibility
  const needsPublic = isPublicLevel(level)
  const needsGate = level === 'gated' || level === 'members' || level === 'invite'
  const patch: Partial<EventRow> = { rkey, visibility: level, visibilitySource: e.visibilitySource ?? null, state: stateFor(e), contentHash: e.contentHash, normalized: e as unknown as Record<string, unknown>, lastSeen: new Date(), missingSince: null, missingRuns: 0, lastError: null, startsAt: new Date(e.start.instant), endsAt: e.end ? new Date(e.end.instant) : null }

  // Narrowing executes at once: withdraw the public record BEFORE writing anywhere else.
  if (existing?.atUri && !needsPublic) {
    const writer = await writerFor(h)
    await unpublishEvent(writer, rkey)
    patch.atUri = null
    patch.atCid = null
    patch.blob = null
    patch.imageHash = null
    patch.teaserAtUri = null
  }
  if (existing?.spaceUri && (!needsGate || existing.visibility !== level)) {
    await deletePermissioned(h.did as `did:${string}`, existing)
    patch.spaceUri = null
    patch.spaceRecordUri = null
  }

  if (needsPublic) {
    const writer = await writerFor(h)
    const image = e.status === 'cancelled' && existing?.blob ? null : await imageFor(e)
    const prior = existing?.atUri && existing.atCid ? { cid: existing.atCid, createdAt: existing.recordCreatedAt ?? undefined, blob: (existing.blob as never) ?? undefined, imageHash: existing.imageHash ?? undefined } : null
    const res = await publishEvent(writer, { event: e, rkey, existing: prior, image, createdWith: c.createdWith, defaultCountry: c.REGION_COUNTRY, teaser: level === 'gated' })
    patch.atUri = res.uri
    patch.atCid = res.cid
    patch.recordCreatedAt = res.record.createdAt
    patch.blob = (res.blob as never) ?? null
    patch.imageHash = res.imageHash ?? null
    patch.recordVersion = 1
    if (level === 'gated') patch.teaserAtUri = res.uri
    if (res.casRetried) log.warn('record was edited elsewhere; our version won on retry', { source: s.id })
  }
  if (needsGate) {
    const w = await writePermissioned(h.did as `did:${string}`, e, rkey, existing ?? undefined)
    patch.spaceUri = w.spaceUri
    patch.spaceRecordUri = w.recordUri
  }
  return patch
}

async function execute(h: HostRow, s: SourceRow, action: Action, byId: Map<string, EventRow>, summary: SyncSummary): Promise<void> {
  const db = getDb()
  const now = new Date()
  switch (action.kind) {
    case 'create': {
      const e = action.event
      if (e.visibility === 'held') {
        await db
          .insert(sourceEvent)
          .values({ id: id('ev'), sourceId: s.id, hostId: h.id, externalId: e.identity.externalId, occurrence: e.identity.occurrence ?? '', contentHash: e.contentHash, normalized: e as never, state: 'held', visibility: 'held', visibilitySource: e.visibilitySource, startsAt: new Date(e.start.instant), endsAt: e.end ? new Date(e.end.instant) : null })
          .onConflictDoNothing()
        summary.held++
        return
      }
      const patch = await place(h, s, e, null)
      await db
        .insert(sourceEvent)
        .values({ id: id('ev'), sourceId: s.id, hostId: h.id, externalId: e.identity.externalId, occurrence: e.identity.occurrence ?? '', ...(patch as Record<string, unknown>) } as never)
        .onConflictDoUpdate({ target: [sourceEvent.sourceId, sourceEvent.externalId, sourceEvent.occurrence], set: patch as never })
      summary.published++
      return
    }
    case 'update':
    case 'rekey': {
      const row = byId.get(action.row.id)!
      const e = action.event
      if (e.visibility === 'held') {
        // Held: withdraw anything published, keep the row.
        const patch = await place(h, s, e, row)
        await db.update(sourceEvent).set({ ...patch, externalId: e.identity.externalId, occurrence: e.identity.occurrence ?? '', state: 'held' } as never).where(eq(sourceEvent.id, row.id))
        summary.held++
        return
      }
      const patch = await place(h, s, e, row)
      await db.update(sourceEvent).set({ ...patch, externalId: e.identity.externalId, occurrence: e.identity.occurrence ?? '', cancelledAt: e.status === 'cancelled' ? (row.cancelledAt ?? now) : null } as never).where(eq(sourceEvent.id, row.id))
      if (e.status === 'cancelled') summary.cancelled++
      else summary.updated++
      return
    }
    case 'touch': {
      await db.update(sourceEvent).set({ lastSeen: now, missingSince: null, missingRuns: 0 }).where(eq(sourceEvent.id, action.row.id))
      summary.unchanged++
      return
    }
    case 'widen-pending': {
      await db.update(sourceEvent).set({ lastSeen: now, missingSince: null, missingRuns: 0 }).where(eq(sourceEvent.id, action.row.id))
      const open = await db
        .select({ id: pendingConfirmation.id })
        .from(pendingConfirmation)
        .where(and(eq(pendingConfirmation.hostId, h.id), eq(pendingConfirmation.kind, 'widen'), eq(pendingConfirmation.sourceId, s.id)))
      const already = open.length > 0 && (await db.select().from(pendingConfirmation).where(and(eq(pendingConfirmation.hostId, h.id), eq(pendingConfirmation.kind, 'widen')))).some((p) => (p.payload as { eventId?: string }).eventId === action.row.id && !p.resolvedAt)
      if (!already) {
        await db.insert(pendingConfirmation).values({ id: id('pc'), hostId: h.id, sourceId: s.id, kind: 'widen', payload: { eventId: action.row.id, from: action.from, to: action.to, card: toCard(action.event) }, expiresAt: new Date(now.getTime() + 30 * 86_400_000) })
      }
      summary.pending++
      return
    }
    case 'cancel': {
      const row = byId.get(action.row.id)!
      const e: NormalizedEvent = { ...(row.normalized as unknown as NormalizedEvent), status: 'cancelled' }
      if (row.atUri || row.spaceUri) {
        const patch = await place(h, s, e, row)
        await db.update(sourceEvent).set({ ...patch, state: 'cancelled', cancelledAt: now } as never).where(eq(sourceEvent.id, row.id))
      } else {
        await db.update(sourceEvent).set({ state: 'cancelled', cancelledAt: now }).where(eq(sourceEvent.id, row.id))
      }
      summary.cancelled++
      return
    }
    case 'missing': {
      await db.update(sourceEvent).set({ missingSince: action.row.missingSince ?? now, missingRuns: action.row.missingRuns + 1 }).where(eq(sourceEvent.id, action.row.id))
      return
    }
    case 'remove': {
      const row = byId.get(action.row.id)!
      if (row.atUri && row.rkey) {
        const writer = await writerFor(h)
        await unpublishEvent(writer, row.rkey)
      }
      if (row.spaceUri) await deletePermissioned(h.did as `did:${string}`, row)
      await db.update(sourceEvent).set({ state: 'removed', atUri: null, atCid: null, spaceUri: null, spaceRecordUri: null, teaserAtUri: null, blob: null, imageHash: null }).where(eq(sourceEvent.id, row.id))
      summary.removed++
      return
    }
    case 'leave':
      return
  }
}

export async function runSource(sourceId: string, opts: { trigger?: 'schedule' | 'manual' | 'push' | 'first' } = {}): Promise<SyncSummary> {
  const db = getDb()
  const summary: SyncSummary = { ok: false, notModified: false, fetched: 0, published: 0, updated: 0, unchanged: 0, cancelled: 0, removed: 0, held: 0, failed: 0, pending: 0 }
  const [s] = await db.select().from(source).where(eq(source.id, sourceId)).limit(1)
  if (!s) return { ...summary, error: { code: 'NotFound', message: 'no such source' } }
  if (s.status === 'paused' && opts.trigger !== 'manual' && opts.trigger !== 'first') return { ...summary, ok: true }
  const h = await getHost(s.hostId)
  if (!h) return { ...summary, error: { code: 'NotFound', message: 'no such host' } }

  const runId = id('run')
  await db.insert(syncRun).values({ id: runId, sourceId })
  const startedAt = Date.now()
  let changed = false
  try {
    const connector = connectorFor(s.type as never)
    const isPush = PUSH_SOURCE_TYPES.has(s.type)
    let raws: RawEvent[]
    let complete = true
    let window: { from?: Date; to?: Date } = {}
    let cursor: unknown = s.cursor
    let etag = s.etag
    let lastModified = s.lastModified
    if (isPush) {
      raws = await pushedRawEvents(s.id)
    } else {
      const ctx = await fetchCtx(s)
      const res = await connector.fetch(s.config, s.cursor, ctx)
      if (res.notModified) {
        summary.notModified = true
        summary.ok = true
        await finishRun(runId, summary)
        await afterRun(s, { ok: true, changed: false, cursor, etag, lastModified, window })
        return summary
      }
      raws = res.events
      complete = res.complete
      window = res.window ?? ctx.window
      cursor = res.cursor
      etag = res.etag ?? null
      lastModified = res.lastModified ?? null
    }
    summary.fetched = raws.length

    const fallbackUrl = String((s.config as { url?: string; pageUrl?: string }).url ?? (s.config as { pageUrl?: string }).pageUrl ?? config().WEB_PUBLIC_URL)
    const normalized: NormalizedEvent[] = []
    for (const raw of raws) {
      try {
        normalized.push(normalize(raw, { sourceId: s.id, sourceType: s.type as never, platform: s.platform, defaultTz: s.tz, fallbackUrl, confidence: s.type === 'extract' ? 'extracted-confirmed' : 'structured' }))
      } catch (err) {
        summary.failed++
        if (!(err instanceof NormalizeError)) log.warn('normalize failed', { detail: describeError(err) })
      }
    }

    const enriched = await enrich(normalized, { pageBudget: opts.trigger === 'first' ? 300 : 120, hostLogoHash: h.logoImageHash })

    const rows = await db.select().from(sourceEvent).where(eq(sourceEvent.sourceId, s.id))
    const byId = new Map(rows.map((r) => [r.id, r]))
    const byKey = new Map(rows.map((r) => [`${r.externalId} ${r.occurrence}`, r]))
    const rules = await loadRules(s.id)
    const classified = enriched.map((e) => {
      const row = byKey.get(`${e.identity.externalId} ${e.identity.occurrence ?? ''}`)
      const cls = classify(e, { sourceDefault: s.defaultVisibility as Visibility, sourceAudience: (s.audience as never) ?? undefined, sourceMappedToSpace: !!s.audience, rules, override: (row?.override as never) ?? null, calendarName: String((s.config as { title?: string }).title ?? '') })
      return applyClassification(e, cls)
    })

    const plan = planReconcile({ rows: rows.map(toLedgerRow), events: classified, complete, window, now: new Date() })
    if (plan.uidChurn && s.identityMode !== 'hash') {
      await db.update(source).set({ identityMode: 'hash' }).where(eq(source.id, s.id))
      log.warn('source regenerates UIDs; switched identity mode', { source: s.id })
    }
    for (const action of plan.actions) {
      try {
        await execute(h, s, action, byId, summary)
        if (action.kind !== 'touch' && action.kind !== 'leave' && action.kind !== 'missing') changed = true
      } catch (err) {
        if (err instanceof WriterAuthError || err instanceof HostPausedError) throw err
        summary.failed++
        log.warn('event action failed', { kind: action.kind, detail: describeError(err) })
        if ('row' in action) await db.update(sourceEvent).set({ lastError: describeError(err) }).where(eq(sourceEvent.id, action.row.id))
      }
    }
    summary.ok = true
    await finishRun(runId, summary)
    await afterRun(s, { ok: true, changed, cursor, etag, lastModified, window })
    log.info('sync ok', { source: s.id, type: s.type, fetched: summary.fetched, published: summary.published, updated: summary.updated, cancelled: summary.cancelled, held: summary.held, ms: Date.now() - startedAt })
  } catch (err) {
    const plain = plainError(err)
    summary.error = plain
    if (err instanceof WriterAuthError) await pauseHost(h.id, 'credential-rejected')
    await finishRun(runId, summary)
    await afterRun(s, { ok: false, changed, cursor: s.cursor, etag: s.etag, lastModified: s.lastModified, window: {}, error: plain })
    log.warn('sync failed', { source: s.id, type: s.type, code: plain.code, detail: describeError(err) })
  }
  return summary
}

async function finishRun(runId: string, summary: SyncSummary): Promise<void> {
  await getDb()
    .update(syncRun)
    .set({ finishedAt: new Date(), ok: summary.ok, notModified: summary.notModified, fetched: summary.fetched, published: summary.published, updated: summary.updated, unchanged: summary.unchanged, cancelled: summary.cancelled, removed: summary.removed, held: summary.held, failed: summary.failed, error: summary.error ?? null })
    .where(eq(syncRun.id, runId))
}

/** Adaptive interval (§7): halves after a change (floor 10 min), doubles after 20 unchanged runs (ceiling 6 h), with jitter; exponential backoff on failure. */
async function afterRun(s: SourceRow, r: { ok: boolean; changed: boolean; cursor: unknown; etag: string | null; lastModified: string | null; window: { from?: Date; to?: Date }; error?: { code: string; message: string } }): Promise<void> {
  const now = new Date()
  const isPush = PUSH_SOURCE_TYPES.has(s.type)
  const base = connectorFor(s.type as never).defaultInterval || INTERVAL_CEILING_MS
  let interval = s.intervalMs || base
  let unchangedRuns = s.unchangedRuns
  let failures = s.consecutiveFailures
  let status = s.status
  if (r.ok) {
    failures = 0
    if (r.changed) {
      unchangedRuns = 0
      interval = Math.max(INTERVAL_FLOOR_MS, Math.min(interval, base) / 2)
    } else {
      unchangedRuns++
      if (unchangedRuns >= 20) {
        interval = Math.min(INTERVAL_CEILING_MS, interval * 2)
        unchangedRuns = 0
      }
    }
    if (status === 'failing') status = 'active'
  } else {
    failures++
    if (failures >= 3) status = 'failing'
    interval = Math.min(24 * 3_600_000, Math.max(INTERVAL_FLOOR_MS, base) * 2 ** Math.min(failures, 6))
    if (s.lastSuccessAt && now.getTime() - s.lastSuccessAt.getTime() > PAUSE_AFTER_FAILING_MS) status = 'paused'
  }
  const jitter = Math.floor(Math.random() * Math.min(interval * 0.1, 5 * 60_000))
  await getDb()
    .update(source)
    .set({
      cursor: r.cursor as never,
      etag: r.etag,
      lastModified: r.lastModified,
      lastRunAt: now,
      lastSuccessAt: r.ok ? now : s.lastSuccessAt,
      status,
      consecutiveFailures: failures,
      unchangedRuns,
      intervalMs: interval,
      nextRunAt: isPush ? new Date(now.getTime() + 365 * 86_400_000) : new Date(now.getTime() + interval + jitter),
      lastError: r.ok ? null : (r.error ?? null),
      windowFrom: r.window.from ?? s.windowFrom,
      windowTo: r.window.to ?? s.windowTo,
    })
    .where(eq(source.id, s.id))
}
