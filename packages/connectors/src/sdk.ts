/**
 * The connector SDK (architecture §4). One interface. A connector declares what it can
 * do; the runtime (apps/tributary) handles scheduling, politeness, retries, storage and
 * everything after `parse`.
 *
 * Connectors cannot open sockets any other way than `ctx.http` (the SSRF-safe client).
 * They must not import `undici`, `http`, `https` or use global `fetch`.
 */
import type { RawEvent, SourceType } from '@tributary/event-model'
import type { HttpClient } from '@tributary/ssrf-fetch'

export type { RawEvent, SourceType }

export interface DetectInput {
  /** The pasted string, verbatim (URL, embed code, a sentence). */
  text?: string
  /** A parsed URL when `text` is one. */
  url?: URL
  /** A file, when the host dropped one. */
  file?: { name: string; mime: string; bytes: Buffer }
  /** The fetched page/feed for `url`, when the detector already fetched it. */
  fetched?: { contentType?: string; body: string; finalUrl: string }
}

export interface DetectMatch {
  type: SourceType
  /** 0..1 — the runtime ranks matches. */
  confidence: number
  /** Human platform label ('luma', 'meetup', 'google', 'wordpress', ...). */
  platform: string
  /** What `configure` needs: the resolved feed URL, calendar id, group slug, page URL... */
  hint: Record<string, unknown>
  /** Something the console should tell the host ("this page has no structured data"). */
  note?: string
}

export interface UserConfig {
  /** Free-form fields from the console's manual configuration or the API. */
  [k: string]: unknown
}

export interface FetchCtx {
  http: HttpClient
  /** The source's own credentials (API key, OAuth token), when it has any. */
  secrets: Record<string, string>
  log: { info(msg: string, fields?: Record<string, string | number | boolean>): void; warn(msg: string, fields?: Record<string, string | number | boolean>): void }
  /** The rolling window the runtime wants (90 days ahead, 1 day back by default). */
  window: { from: Date; to: Date }
  /** Conditional GET state from the previous run. */
  etag?: string
  lastModified?: string
  /** Source-level default zone, resolved at configure time. */
  defaultTz: string
}

export interface FetchResult<Cursor = unknown> {
  events: RawEvent[]
  cursor: Cursor | null
  /** true = this is the full current set within `window` (enables missing-detection). */
  complete: boolean
  /** What time range the source actually covers. Missing-detection applies only inside it. */
  window?: { from?: Date; to?: Date }
  notModified?: boolean
  etag?: string
  lastModified?: string
  /** Feed-level metadata worth showing the host. */
  meta?: { title?: string; tz?: string; url?: string }
}

export interface PushPayload {
  headers: Record<string, string>
  body: unknown
  raw?: Buffer
}

export interface Connector<Cfg = Record<string, unknown>, Cursor = unknown> {
  type: SourceType
  platform: string
  capabilities: {
    live: 'poll' | 'push' | 'none'
    delta: boolean
    explicitDeletes: boolean
    images: 'native' | 'via-page' | 'none'
    requiresAuth: 'none' | 'apiKey' | 'oauth'
  }
  /** Cheap, offline when possible: does this input belong to me? */
  detect?(input: DetectInput, ctx: Pick<FetchCtx, 'http' | 'log'>): Promise<DetectMatch | null>
  /** Resolve a match (or manual config) into the durable source config, e.g. a Luma page → its ICS URL. */
  configure(input: DetectMatch | UserConfig, ctx: Pick<FetchCtx, 'http' | 'log'>): Promise<Cfg>
  fetch(cfg: Cfg, cursor: Cursor | null, ctx: FetchCtx): Promise<FetchResult<Cursor>>
  /** Webhooks, email, bot messages. */
  handlePush?(req: PushPayload, cfg: Cfg, ctx: FetchCtx): Promise<RawEvent[]>
  /** Milliseconds between polls at the default cadence. */
  defaultInterval: number
  /** A stable fingerprint of a configured source, for claims and duplicate detection. */
  fingerprint(cfg: Cfg): string
  /** A human label for the source ("Luma calendar cal-abc", "Google Calendar ..."). */
  label(cfg: Cfg): string
}

export class ConnectorError extends Error {
  constructor(
    message: string,
    /** A short stable code the console maps to plain language. */
    readonly code: 'NotFound' | 'Gone' | 'Forbidden' | 'RateLimited' | 'Unparseable' | 'Unsupported' | 'Network' | 'TooLarge' | 'Other',
    readonly retryable = true,
  ) {
    super(message)
    this.name = 'ConnectorError'
  }
}

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

/** The runtime's default rolling window (architecture §4.2). */
export function defaultWindow(now = new Date()): { from: Date; to: Date } {
  return { from: new Date(now.getTime() - DAY), to: new Date(now.getTime() + 90 * DAY) }
}
