/**
 * `RawEvent` → `NormalizedEvent` (pipeline stage 3). Timezone resolution, all-day
 * handling, description → markdown, conference-link extraction, contact redaction,
 * mode inference, and the content hash. Enrichment (images, geocoding, categories)
 * and classification (visibility) happen after this and reassign fields.
 */
import { DateTime, IANAZone } from 'luxon'
import { contentHash } from './hash.js'
import { canonicalUrl, extractJoinUrl, extractUrls, redactContacts, toMarkdown } from './text.js'
import type { EventLocation, EventMode, NormalizedEvent, RawEvent, SourceType } from './types.js'

export interface NormalizeContext {
  sourceId: string
  sourceType: SourceType
  /** Human label for the platform: 'luma', 'meetup', 'google', 'wordpress', 'squarespace', ... */
  platform: string
  /** The source-level default zone (configure-time), used for floating times. */
  defaultTz: string
  /** Where to point when the event carries no URL of its own (the feed's page, the host's site). */
  fallbackUrl: string
  fetchedAt?: string
  confidence?: 'structured' | 'extracted-confirmed'
}

export class NormalizeError extends Error {
  constructor(message: string, readonly externalId: string) {
    super(message)
    this.name = 'NormalizeError'
  }
}

export function isValidZone(tz: string | undefined): tz is string {
  return !!tz && IANAZone.isValidZone(tz)
}

const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/

/**
 * Parse a source timestamp. An explicit offset wins; a wall-clock string is read in
 * `zone`. Returns the instant (UTC ISO) and whether the zone was inferred.
 */
export function resolveInstant(value: string, zone: string): DateTime {
  const s = value.trim()
  if (HAS_OFFSET.test(s)) {
    const dt = DateTime.fromISO(s, { setZone: true })
    if (dt.isValid) return dt.setZone(zone)
  }
  const dt = DateTime.fromISO(s, { zone })
  if (!dt.isValid) throw new Error(`unparseable timestamp: ${s}`)
  return dt
}

function inferMode(raw: RawEvent, joinUrl: string | undefined, hasPlace: boolean): EventMode {
  if (raw.mode) return raw.mode
  if (joinUrl && !hasPlace) return 'virtual'
  if (joinUrl && hasPlace) return 'hybrid'
  if (!hasPlace && /\b(online|virtual|zoom|webinar|livestream)\b/i.test(`${raw.name} ${raw.location ?? ''}`)) return 'virtual'
  return 'inperson'
}

function locationsFrom(raw: RawEvent): EventLocation[] {
  const out: EventLocation[] = []
  for (const l of raw.locations ?? []) {
    out.push({ precision: 'exact', private: false, ...l })
  }
  if (out.length === 0 && raw.location?.trim()) {
    out.push({ name: raw.location.trim(), precision: 'exact', private: false })
  }
  if (raw.geo && out.length > 0 && out[0] && out[0].lat === undefined) {
    out[0].lat = raw.geo.lat
    out[0].lon = raw.geo.lon
  } else if (raw.geo && out.length === 0) {
    out.push({ lat: raw.geo.lat, lon: raw.geo.lon, precision: 'exact', private: false })
  }
  return out
}

export function normalize(raw: RawEvent, ctx: NormalizeContext): NormalizedEvent {
  const name = raw.name?.trim()
  if (!name) throw new NormalizeError('event has no name', raw.externalId)

  const tz = isValidZone(raw.tz) ? raw.tz : ctx.defaultTz
  // The zone is only a guess when the source gave a wall-clock time with no zone and no
  // offset. An explicit offset pins the instant; the display zone is then the region's.
  const tzInferred = !isValidZone(raw.tz) && !raw.allDay && !HAS_OFFSET.test(raw.start.trim())
  let start: DateTime
  let end: DateTime | undefined
  try {
    if (raw.allDay) {
      start = DateTime.fromISO(raw.start.slice(0, 10), { zone: tz }).startOf('day')
      end = raw.end ? DateTime.fromISO(raw.end.slice(0, 10), { zone: tz }).startOf('day') : start.plus({ days: 1 })
    } else {
      start = resolveInstant(raw.start, tz)
      end = raw.end ? resolveInstant(raw.end, tz) : undefined
    }
  } catch (err) {
    throw new NormalizeError(err instanceof Error ? err.message : 'bad timestamp', raw.externalId)
  }
  if (!start.isValid) throw new NormalizeError('invalid start', raw.externalId)
  if (end && (!end.isValid || end < start)) end = undefined

  const descriptionMd = toMarkdown(raw.description, raw.descriptionIsHtml)
  const { joinUrl, scrubbed } = extractJoinUrl([descriptionMd, raw.location])
  const scrubbedDescription = redactContacts(scrubbed[0])
  const scrubbedLocation = scrubbed[1]

  // A "location" that is a bare URL (Luma and Meetup do this for online events) is a
  // link, not a place.
  const locationIsUrl = !!scrubbedLocation && /^https?:\/\/\S+$/i.test(scrubbedLocation.trim())
  const locations = locationsFrom({ ...raw, location: locationIsUrl ? undefined : scrubbedLocation })
  const hasPlace = locations.some((l) => l.name || l.street || l.locality || l.lat !== undefined)

  const sourceUrl =
    canonicalUrl(raw.url) ??
    (locationIsUrl ? canonicalUrl(scrubbedLocation) : undefined) ??
    extractUrls(raw.description).map(canonicalUrl).find((u): u is string => !!u) ??
    canonicalUrl(ctx.fallbackUrl) ??
    ctx.fallbackUrl

  const links = [...(raw.links ?? [])]
    .map((l) => ({ uri: canonicalUrl(l.uri) ?? l.uri, name: l.name }))
    .filter((l, i, arr) => l.uri !== sourceUrl && arr.findIndex((x) => x.uri === l.uri) === i)

  const partial: Omit<NormalizedEvent, 'contentHash'> = {
    identity: { sourceId: ctx.sourceId, externalId: raw.externalId, occurrence: raw.occurrence },
    name,
    descriptionMd: scrubbedDescription,
    start: { instant: start.toUTC().toISO()!, tz, allDay: !!raw.allDay, tzInferred },
    end: end ? { instant: end.toUTC().toISO()! } : undefined,
    status: raw.status ?? 'scheduled',
    mode: inferMode(raw, joinUrl ?? (locationIsUrl && !hasPlace ? scrubbedLocation : undefined), hasPlace),
    locations,
    joinUrl,
    sourceUrl,
    links,
    image: raw.imageUrl ? { url: raw.imageUrl, alt: raw.imageAlt, origin: 'source' } : undefined,
    organizerName: raw.organizerName?.trim() || undefined,
    priceText: raw.priceText?.trim() || undefined,
    isFree: raw.isFree ?? (raw.priceText ? /^(free|\$?0(\.00)?)$/i.test(raw.priceText.trim()) : undefined),
    tags: [...new Set((raw.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))],
    category: raw.category,
    series: raw.seriesKey ? { key: raw.seriesKey, index: raw.seriesIndex } : undefined,
    provenance: {
      platform: ctx.platform,
      method: ctx.sourceType,
      fetchedAt: ctx.fetchedAt ?? new Date().toISOString(),
      confidence: ctx.confidence ?? 'structured',
    },
    visibility: 'public',
    visibilitySource: 'host-default',
    sourcePrivacy: raw.sourcePrivacy,
  }
  return { ...partial, contentHash: contentHash(partial) }
}

/** Recompute the hash after enrichment or classification changed fields. */
export function rehash(e: NormalizedEvent): NormalizedEvent {
  const { contentHash: _old, ...rest } = e
  return { ...rest, contentHash: contentHash(rest) }
}
