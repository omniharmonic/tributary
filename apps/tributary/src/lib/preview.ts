/**
 * The one-box (PRD §5): detect what we were given, fetch it once, and show real cards
 * before asking for anything. Previews are short-lived rows so the identity step can
 * publish without re-fetching.
 */
import { and, eq, gt } from 'drizzle-orm'
import { connectorFor, defaultWindow, PUSH_SOURCE_TYPES, type DetectMatch, type RawEvent } from '@tributary/connectors'
import { parseIcs } from '@tributary/connectors/ics'
import { detect as detectInput, describeMatch, type DetectFile } from '@tributary/detect'
import { normalize, toCard, type EventCard, type NormalizedEvent, type Visibility } from '@tributary/event-model'
import { applyClassification, classify } from '@tributary/visibility'
import { config } from '../config.js'
import { getDb } from '../db/index.js'
import { preview, source } from '../db/schema.js'
import { ApiError } from '../http/context.js'
import { enrich } from '../pipeline/enrich.js'
import { httpClient } from './http-client.js'
import { id } from './ids.js'
import { log } from './logging.js'
import { extractEvents, type ExtractedEvent } from './extract.js'

export const PREVIEW_TTL_MS = 2 * 3_600_000

export async function detect(input: { text?: string; file?: DetectFile }): Promise<Array<DetectMatch & { label: string }>> {
  const matches = await detectInput(input, { http: httpClient(), log })
  return matches.map((m) => ({ ...m, label: describeMatch(m) }))
}

export interface PreviewSummary {
  source: { type: string; platform: string; label: string; fingerprint: string; tz: string; alreadyConnected: boolean }
  count: number
  upcoming: number
  cards: EventCard[]
  notes: string[]
  defaultVisibility: Visibility
  signals: { private: number; conferenceLinks: number; noImage: number; inferredTz: number }
  needsConfirmation: boolean
  extracted?: ExtractedEvent[]
}

export async function buildPreview(match: DetectMatch, file?: DetectFile): Promise<{ previewId: string; summary: PreviewSummary; expiresAt: Date }> {
  const c = config()
  const http = httpClient()
  const connector = connectorFor(match.type)
  let cfg: Record<string, unknown>
  let raws: RawEvent[] = []
  let extracted: ExtractedEvent[] | undefined
  let tz = c.REGION_TZ
  let notes: string[] = []

  if (match.type === 'extract') {
    const kind = String(match.hint.kind ?? 'text')
    const res = await extractEvents({ kind: kind as never, text: typeof match.hint.text === 'string' ? match.hint.text : undefined, url: typeof match.hint.url === 'string' ? match.hint.url : undefined, file })
    extracted = res.events
    raws = res.events.map((e) => e.raw)
    cfg = { hostKey: 'pending', tz: c.REGION_TZ, kind }
    notes = res.notes
  } else if (match.type === 'upload') {
    if (!file) throw new ApiError(400, 'InvalidInput', 'Upload needs a file.')
    cfg = (await connector.configure(match, { http, log })) as Record<string, unknown>
    if (cfg.kind === 'ics') {
      const parsed = parseIcs(file.bytes.toString('utf8'), { window: defaultWindow(), defaultTz: c.REGION_TZ })
      raws = parsed.events
      if (parsed.meta.tz) tz = parsed.meta.tz
      if (parsed.dropped) notes.push(`${parsed.dropped} entr${parsed.dropped === 1 ? 'y' : 'ies'} could not be read and were skipped.`)
    } else {
      throw new ApiError(400, 'SourceUnsupported', 'Spreadsheet uploads are coming soon. For now, paste a calendar link or upload an .ics file.')
    }
    cfg.tz = tz
  } else {
    cfg = (await connector.configure(match, { http, log })) as Record<string, unknown>
    tz = String(cfg.tz ?? c.REGION_TZ)
    const res = await connector.fetch(cfg, null, { http, secrets: c.GOOGLE_API_KEY ? { GOOGLE_API_KEY: c.GOOGLE_API_KEY } : {}, log, window: defaultWindow(), defaultTz: tz })
    raws = res.events.slice(0, 500)
    if (res.meta?.tz) tz = res.meta.tz
    if (res.meta?.title && !cfg.title) cfg.title = res.meta.title
    cfg.tz = tz
  }

  const fingerprint = match.type === 'extract' ? `extract:pending:${id('x')}` : connector.fingerprint(cfg)
  const label = match.type === 'extract' ? 'Events from what you gave us' : connector.label(cfg)
  const fallbackUrl = String(cfg.url ?? cfg.pageUrl ?? c.WEB_PUBLIC_URL)
  const normalized: NormalizedEvent[] = []
  let dropped = 0
  for (const raw of raws) {
    try {
      normalized.push(normalize(raw, { sourceId: 'preview', sourceType: match.type, platform: match.platform || connector.platform, defaultTz: tz, fallbackUrl, confidence: match.type === 'extract' ? 'extracted-confirmed' : 'structured' }))
    } catch {
      dropped++
    }
  }
  const enriched = await enrich(normalized, { pageBudget: 12 })
  const classified = enriched.map((e) => applyClassification(e, classify(e, { sourceDefault: 'public' })))

  const now = Date.now() - 86_400_000
  const upcomingEvents = classified.filter((e) => new Date(e.end?.instant ?? e.start.instant).getTime() >= now)
  const cards = upcomingEvents.slice(0, 60).map((e) => toCard(e))
  const signals = {
    private: classified.filter((e) => e.sourcePrivacy === 'private' || e.sourcePrivacy === 'confidential').length,
    conferenceLinks: classified.filter((e) => e.joinUrl).length,
    noImage: upcomingEvents.filter((e) => !e.image).length,
    inferredTz: upcomingEvents.filter((e) => e.start.tzInferred).length,
  }
  if (signals.noImage > 0) notes.push(`${signals.noImage} event${signals.noImage === 1 ? ' has' : 's have'} no image; we will use your logo or a placeholder.`)
  if (signals.private > 0) notes.push(`${signals.private} event${signals.private === 1 ? ' is' : 's are'} marked private at the source and will be held, not published.`)
  if (signals.conferenceLinks > 0) notes.push(`${signals.conferenceLinks} event${signals.conferenceLinks === 1 ? ' has' : 's have'} a video link; we share it only with confirmed guests, not publicly.`)
  if (signals.inferredTz > 0 && signals.inferredTz === upcomingEvents.length) notes.push(`The source does not say which time zone it uses; we assumed ${tz}. Check a time before publishing.`)
  if (dropped > 0) notes.push(`${dropped} event${dropped === 1 ? '' : 's'} could not be read.`)
  if (upcomingEvents.length === 0 && classified.length > 0) notes.push('Everything here is in the past. We publish upcoming events only; new ones will appear as they are added at the source.')

  const alreadyConnected = match.type === 'extract' ? false : (await getDb().select({ id: source.id }).from(source).where(eq(source.fingerprint, fingerprint)).limit(1)).length > 0
  const defaultVisibility: Visibility = signals.private > 0 && signals.private === classified.length ? 'held' : 'public'
  const summary: PreviewSummary = {
    source: { type: match.type, platform: match.platform || connector.platform, label, fingerprint, tz, alreadyConnected },
    count: classified.length,
    upcoming: upcomingEvents.length,
    cards,
    notes,
    defaultVisibility,
    signals,
    needsConfirmation: match.type === 'extract',
    extracted,
  }
  const previewId = id('pv')
  const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS)
  await getDb().insert(preview).values({ id: previewId, match: match as unknown as Record<string, unknown>, config: cfg, rawEvents: raws, summary: summary as unknown as Record<string, unknown>, fingerprint, tz, expiresAt })
  return { previewId, summary, expiresAt }
}

export async function loadPreview(previewId: string): Promise<typeof preview.$inferSelect | null> {
  const rows = await getDb()
    .select()
    .from(preview)
    .where(and(eq(preview.id, previewId), gt(preview.expiresAt, new Date())))
    .limit(1)
  return rows[0] ?? null
}

export function isPushPreview(p: typeof preview.$inferSelect): boolean {
  return PUSH_SOURCE_TYPES.has(String((p.match as { type?: string }).type))
}
