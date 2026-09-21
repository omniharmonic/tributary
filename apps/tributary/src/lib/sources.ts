/**
 * Sources: connect, configure, conflict-check, enqueue.
 */
import { and, eq } from 'drizzle-orm'
import { connectorFor, PUSH_SOURCE_TYPES, type DetectMatch, type RawEvent } from '@tributary/connectors'
import type { Audience, SourceType, Visibility } from '@tributary/event-model'
import { wrapSecret } from '@tributary/identity'
import { config } from '../config.js'
import { getDb } from '../db/index.js'
import { pushedEvent, removalBlock, source } from '../db/schema.js'
import { httpClient } from './http-client.js'
import { id } from './ids.js'
import { log } from './logging.js'
import { recordAudit } from './audit.js'
import { enqueueSync } from '../jobs/index.js'
import type { HostRow } from './hosts.js'

export class SourceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message)
    this.name = 'SourceError'
  }
}

export type SourceRow = typeof source.$inferSelect

export interface ConnectInput {
  type: SourceType
  platform: string
  /** Already-configured connector config (from a preview) or a detect match to configure now. */
  config?: Record<string, unknown>
  match?: DetectMatch
  defaultVisibility?: Visibility
  audience?: Audience
  tz?: string
  /** For push sources: the initial raw events (an upload, a confirmed extraction). */
  rawEvents?: RawEvent[]
  label?: string
  /** Source-side credentials (Eventbrite token, ...), encrypted at rest and handed to the connector as `ctx.secrets`. */
  secrets?: Record<string, string>
}

export async function configureFromMatch(match: DetectMatch): Promise<{ config: Record<string, unknown>; fingerprint: string; label: string; tz: string; platform: string }> {
  const connector = connectorFor(match.type)
  const cfg = (await connector.configure(match, { http: httpClient(), log })) as Record<string, unknown>
  const c = config()
  return { config: cfg, fingerprint: connector.fingerprint(cfg), label: connector.label(cfg), tz: String(cfg.tz ?? c.REGION_TZ), platform: match.platform || connector.platform }
}

export async function connectSource(h: HostRow, input: ConnectInput): Promise<{ source: SourceRow; created: boolean }> {
  const c = config()
  const connector = connectorFor(input.type)
  const ctx = { http: httpClient(), log, secrets: input.secrets ?? {}, window: { from: new Date(), to: new Date(Date.now() + 90 * 86_400_000) }, defaultTz: c.REGION_TZ }
  const cfg = input.config ?? ((await connector.configure(input.match ?? (input.secrets ? { secrets: input.secrets } : {}), ctx)) as Record<string, unknown>)
  const fingerprint = connector.fingerprint(cfg)
  const wrapped = input.secrets && Object.keys(input.secrets).length ? wrapSecret(JSON.stringify(input.secrets), c.custodyKeys, c.CUSTODY_KEY_VERSION) : null

  const blocked = await getDb().select().from(removalBlock).where(eq(removalBlock.fingerprint, fingerprint)).limit(1)
  if (blocked[0]) throw new SourceError('The owner of this source asked not to be listed here.', 403, 'Forbidden')

  const existing = await getDb().select().from(source).where(eq(source.fingerprint, fingerprint)).limit(1)
  if (existing[0]) {
    if (existing[0].hostId !== h.id) throw new SourceError('This source is already connected by another host. If it is yours, claim it from the event page.', 409, 'Conflict')
    return { source: existing[0], created: false }
  }

  const tz = input.tz ?? String(cfg.tz ?? c.REGION_TZ)
  const [row] = await getDb()
    .insert(source)
    .values({
      id: id('src'),
      hostId: h.id,
      type: input.type,
      platform: input.platform || connector.platform,
      label: input.label ?? connector.label(cfg),
      fingerprint,
      config: cfg,
      tz,
      intervalMs: connector.defaultInterval || 0,
      nextRunAt: new Date(),
      defaultVisibility: input.defaultVisibility ?? 'public',
      audience: input.audience ?? null,
      status: 'active',
      secretsKeyVersion: wrapped?.keyVersion ?? null,
      secretsCiphertext: wrapped?.blob ?? null,
    })
    .returning()
  if (input.rawEvents?.length && PUSH_SOURCE_TYPES.has(input.type)) {
    await pushRawEvents(row!.id, input.rawEvents)
  }
  await recordAudit({ hostId: h.id, actor: h.did, action: 'source.connected', subject: row!.id, detail: { type: input.type, visibility: row!.defaultVisibility } })
  await enqueueSync(row!.id, 'first')
  return { source: row!, created: true }
}

export async function pushRawEvents(sourceId: string, raws: RawEvent[]): Promise<void> {
  const db = getDb()
  for (const raw of raws) {
    await db
      .insert(pushedEvent)
      .values({ sourceId, externalId: raw.externalId, raw: raw as unknown as Record<string, unknown>, deleted: false, updatedAt: new Date() })
      .onConflictDoUpdate({ target: [pushedEvent.sourceId, pushedEvent.externalId], set: { raw: raw as unknown as Record<string, unknown>, deleted: false, updatedAt: new Date() } })
  }
}

export async function markPushedDeleted(sourceId: string, externalId: string): Promise<boolean> {
  const res = await getDb().update(pushedEvent).set({ deleted: true, updatedAt: new Date() }).where(and(eq(pushedEvent.sourceId, sourceId), eq(pushedEvent.externalId, externalId))).returning({ e: pushedEvent.externalId })
  return res.length > 0
}

/** The host's one push source per channel (api, webhook, mcp, email, manual, extract), created on demand. */
export async function pushSourceFor(h: HostRow, channel: 'api' | 'webhook' | 'mcp' | 'email' | 'manual' | 'extract'): Promise<SourceRow> {
  const type: SourceType = channel === 'manual' ? 'manual' : channel === 'extract' ? 'extract' : 'api'
  const cfg = channel === 'manual' ? { hostKey: h.id, tz: config().REGION_TZ } : { hostKey: h.id, channel, tz: config().REGION_TZ }
  const fingerprint = type === 'manual' ? `manual:${h.id}` : type === 'extract' ? `extract:${h.id}` : `api:${channel}:${h.id}`
  const existing = await getDb().select().from(source).where(eq(source.fingerprint, fingerprint)).limit(1)
  if (existing[0]) return existing[0]
  const [row] = await getDb()
    .insert(source)
    .values({ id: id('src'), hostId: h.id, type, platform: type === 'manual' ? 'manual' : channel, label: type === 'manual' ? 'Events you added by hand' : type === 'extract' ? 'Events from flyers and text' : ({ api: 'API', webhook: 'Webhook', mcp: 'MCP agent', email: 'Forwarded email' } as Record<string, string>)[channel]!, fingerprint, config: cfg, tz: config().REGION_TZ, intervalMs: 0, nextRunAt: new Date(Date.now() + 365 * 86_400_000), defaultVisibility: 'public', status: 'active' })
    .returning()
  return row!
}

export function publicSource(s: SourceRow, counts?: { live: number; cancelled: number; held: number }): Record<string, unknown> {
  return {
    id: s.id,
    type: s.type,
    platform: s.platform,
    label: s.label,
    url: (s.config as { url?: string; pageUrl?: string }).url ?? (s.config as { pageUrl?: string }).pageUrl ?? null,
    status: s.status,
    defaultVisibility: s.defaultVisibility,
    audience: s.audience,
    tz: s.tz,
    intervalMinutes: Math.round(s.intervalMs / 60_000),
    lastSyncAt: s.lastRunAt?.toISOString() ?? null,
    lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null,
    nextRunAt: s.nextRunAt.toISOString(),
    consecutiveFailures: s.consecutiveFailures,
    lastError: s.lastError ?? null,
    counts: counts ?? { live: 0, cancelled: 0, held: 0 },
    claimed: s.claimed,
    createdAt: s.createdAt.toISOString(),
  }
}
