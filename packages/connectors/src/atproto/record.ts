/**
 * The inverse of `buildEventRecord`: a `community.lexicon.calendar.event` record as it
 * sits in somebody's repo, read back as a `RawEvent`.
 *
 * This reads the lexicon, not our own writer, so a record authored in atmo.rsvp or any
 * other client parses just as well as one of ours. Where the lexicon allows several
 * shapes (locations especially) every shape we have seen in the wild is handled and
 * anything unrecognised is skipped rather than guessed at.
 */
import type { EventMode, EventStatus } from '@tributary/event-model'
import type { RawEvent } from '../sdk.js'

export const EVENT_COLLECTION = 'community.lexicon.calendar.event'

export interface RepoRecord {
  uri: string
  cid?: string
  value: Record<string, unknown>
}

const MODES: EventMode[] = ['inperson', 'virtual', 'hybrid']
const STATUSES: EventStatus[] = ['scheduled', 'cancelled', 'postponed', 'rescheduled', 'planned']

/** `community.lexicon.calendar.event#virtual` → `virtual`. Bare values pass through. */
function suffix(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const i = v.lastIndexOf('#')
  return (i >= 0 ? v.slice(i + 1) : v).toLowerCase() || undefined
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function num(v: unknown): number | undefined {
  // The geo lexicon carries latitude and longitude as strings, on purpose: it refuses to
  // let a float round-trip through JSON and lose a digit. So accept both.
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : undefined
}

export function rkeyOf(uri: string): string {
  return uri.split('/').pop() ?? uri
}

interface ParsedLocations {
  locations: RawEvent['locations']
  geo?: { lat: number; lon: number }
}

export function parseLocations(raw: unknown): ParsedLocations {
  if (!Array.isArray(raw)) return { locations: undefined }
  let address: NonNullable<RawEvent['locations']>[number] | undefined
  let geo: { lat: number; lon: number } | undefined
  const text: string[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const type = String(o.$type ?? '')
    if (type.endsWith('location.address')) {
      address = { name: str(o.name), street: str(o.street), locality: str(o.locality), region: str(o.region), postalCode: str(o.postalCode), country: str(o.country) }
    } else if (type.endsWith('location.geo')) {
      const lat = num(o.latitude)
      const lon = num(o.longitude)
      if (lat !== undefined && lon !== undefined) geo = { lat, lon }
      const n = str(o.name)
      if (n) text.push(n)
    } else if (type.endsWith('location.hthree') || type.endsWith('location.fsq')) {
      // An H3 cell is a deliberately coarse location: the author chose not to say where.
      // Carrying its label keeps the town without inventing a pin inside the cell.
      const n = str(o.name)
      if (n) text.push(n)
    } else {
      const n = str(o.name) ?? str(o.value)
      if (n) text.push(n)
    }
  }
  if (!address && text.length) address = { name: text[0] }
  if (address && !address.name && text.length) address.name = text[0]
  if (address && geo) {
    address.lat = geo.lat
    address.lon = geo.lon
  }
  return { locations: address ? [address] : undefined, geo }
}

export interface ParseOptions {
  /** Where to fetch this repo's blobs from, for cover images. */
  pdsUrl: string
  did: string
}

/** The blob URL for a record's thumbnail, when it has one. */
export function mediaUrl(value: Record<string, unknown>, opts: ParseOptions): { url?: string; alt?: string } {
  const media = Array.isArray(value.media) ? value.media : []
  const thumb = (media.find((m) => (m as Record<string, unknown>)?.role === 'thumbnail') ?? media[0]) as Record<string, unknown> | undefined
  if (!thumb) return {}
  const content = thumb.content as { ref?: { $link?: unknown }; $type?: unknown } | undefined
  const link = content?.ref?.$link
  if (typeof link !== 'string' || !link) return {}
  return { url: `${opts.pdsUrl}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(opts.did)}&cid=${encodeURIComponent(link)}`, alt: str(thumb.alt) }
}

/**
 * One record → one `RawEvent`, or null when it is not an event we should list.
 *
 * Two records are deliberately skipped:
 *
 *  - anything carrying `additionalData.externalSource`, because that record is an
 *    adapter's mirror of an event that lives somewhere else, not something this person
 *    authored. Every record Tributary writes carries it, so this is also what stops the
 *    directory from re-reading its own output: without it, publishing into the repo we
 *    are reading would grow a new copy on every single sync;
 *  - anything without a name or a start, which is not an event at all.
 */
export function toRawEvent(rec: RepoRecord, opts: ParseOptions): RawEvent | null {
  const v = rec.value ?? {}
  const additional = (v.additionalData && typeof v.additionalData === 'object' ? (v.additionalData as Record<string, unknown>) : {}) as Record<string, unknown>
  if (additional.externalSource) return null

  const name = str(v.name)
  const start = str(v.startsAt)
  if (!name || !start) return null

  const mode = suffix(v.mode)
  const status = suffix(v.status)
  const { locations, geo } = parseLocations(v.locations)
  const uris = Array.isArray(v.uris) ? (v.uris as Array<Record<string, unknown>>) : []
  const links = uris.map((u) => ({ uri: str(u.uri) ?? '', name: str(u.name) })).filter((u) => /^https?:\/\//.test(u.uri))
  const { url: imageUrl, alt: imageAlt } = mediaUrl(v, opts)
  const tags = Array.isArray(additional.tags) ? (additional.tags as unknown[]).map(str).filter((t): t is string => !!t) : undefined

  return {
    externalId: rkeyOf(rec.uri),
    name,
    description: str(v.description),
    descriptionIsHtml: false,
    start,
    end: str(v.endsAt),
    tz: str(v.timezone),
    allDay: additional.allDay === true,
    status: status && (STATUSES as string[]).includes(status) ? (status as EventStatus) : undefined,
    mode: mode && (MODES as string[]).includes(mode) ? (mode as EventMode) : undefined,
    locations,
    geo,
    url: links[0]?.uri,
    links: links.slice(1),
    imageUrl,
    imageAlt,
    organizerName: str(additional.organizerName),
    priceText: str(additional.priceText),
    isFree: typeof additional.isFree === 'boolean' ? additional.isFree : undefined,
    tags,
    category: str(additional.category),
    // `showInDiscovery: false` is the author saying "not in the directory". The visibility
    // pipeline turns that into unlisted; it is never silently overridden to public.
    sourcePrivacy: (v.preferences as { showInDiscovery?: unknown } | undefined)?.showInDiscovery === false ? 'unlisted' : undefined,
    lastModified: str(v.createdAt),
  }
}
