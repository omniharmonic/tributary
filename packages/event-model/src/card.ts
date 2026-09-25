/**
 * The card model: what the console preview, the dashboard and the discovery view all
 * render from. Derived from a `NormalizedEvent` so preview and production cannot drift.
 * "Complete" (PRD measure: image + tz + place) is computed here, once.
 */
import { DateTime } from 'luxon'
import type { NormalizedEvent } from './types.js'

export interface EventCard {
  key: string
  name: string
  startsAt: string
  endsAt?: string
  timezone: string
  allDay: boolean
  /** e.g. "Sat, Oct 4 · 10:00 AM – 1:00 PM MDT" */
  when: string
  status: NormalizedEvent['status']
  mode: NormalizedEvent['mode']
  place?: string
  placeCoarse: boolean
  /**
   * Where to put the pin, for the map view. Present only when `placeCoarse` is false,
   * which is the same predicate that decides whether `place` is a street address — so a
   * gated event cannot be mapped to its real address, and there is no second rule here
   * that could be forgotten when the first one changes.
   */
  geo?: { lat: number; lon: number }
  imageUrl?: string
  imageOrigin?: NormalizedEvent['image'] extends infer I ? (I extends { origin: infer O } ? O : never) : never
  sourceUrl: string
  platform: string
  organizerName?: string
  priceText?: string
  tags: string[]
  category?: string
  visibility: NormalizedEvent['visibility']
  excerpt?: string
  missing: Array<'image' | 'place' | 'timezone' | 'description' | 'end'>
  complete: boolean
}

export function formatWhen(startInstant: string, tz: string, endInstant?: string, allDay = false): string {
  const s = DateTime.fromISO(startInstant, { zone: 'utc' }).setZone(tz)
  const e = endInstant ? DateTime.fromISO(endInstant, { zone: 'utc' }).setZone(tz) : undefined
  const day = s.toFormat('ccc, LLL d')
  if (allDay) {
    if (e && e.diff(s, 'days').days > 1) return `${day} – ${e.minus({ days: 1 }).toFormat('ccc, LLL d')} (all day)`
    return `${day} (all day)`
  }
  const t = (d: DateTime) => d.toFormat(d.minute === 0 ? 'h a' : 'h:mm a')
  const zone = s.toFormat('ZZZZ')
  if (!e) return `${day} · ${t(s)} ${zone}`
  if (e.hasSame(s, 'day')) return `${day} · ${t(s)} – ${t(e)} ${zone}`
  return `${day} ${t(s)} – ${e.toFormat('ccc, LLL d')} ${t(e)} ${zone}`
}

export function placeLabel(e: NormalizedEvent): { label?: string; coarse: boolean } {
  const l = e.locations[0]
  if (!l) return { label: e.mode === 'virtual' ? 'Online' : undefined, coarse: false }
  const coarse = e.visibility === 'gated' || l.private || l.precision !== 'exact' || (e.gatedFields ?? []).includes('exactLocation')
  if (coarse) return { label: [l.locality, l.region].filter(Boolean).join(', ') || 'Location shared with confirmed guests', coarse: true }
  const parts = [l.name, l.street, l.locality].filter(Boolean)
  return { label: parts.length ? [...new Set(parts)].join(', ') : undefined, coarse: false }
}

/** The pin, when the event's own place is exact and public. Otherwise nothing. */
function geoFor(e: NormalizedEvent, coarse: boolean): { lat: number; lon: number } | undefined {
  if (coarse) return undefined
  const l = e.locations[0]
  if (!l || l.lat === undefined || l.lon === undefined) return undefined
  return { lat: l.lat, lon: l.lon }
}

export function toCard(e: NormalizedEvent, imageUrl?: string): EventCard {
  const { label, coarse } = placeLabel(e)
  const missing: EventCard['missing'] = []
  if (!e.image && !imageUrl) missing.push('image')
  if (!label && e.mode !== 'virtual') missing.push('place')
  if (e.start.tzInferred) missing.push('timezone')
  if (!e.descriptionMd) missing.push('description')
  if (!e.end) missing.push('end')
  const complete = !missing.includes('image') && !missing.includes('place') && !missing.includes('timezone')
  return {
    key: e.identity.occurrence ? `${e.identity.externalId}#${e.identity.occurrence}` : e.identity.externalId,
    name: e.name,
    startsAt: e.start.instant,
    endsAt: e.end?.instant,
    timezone: e.start.tz,
    allDay: e.start.allDay,
    when: formatWhen(e.start.instant, e.start.tz, e.end?.instant, e.start.allDay),
    status: e.status,
    mode: e.mode,
    place: label,
    placeCoarse: coarse,
    geo: geoFor(e, coarse),
    imageUrl: imageUrl ?? e.image?.url,
    imageOrigin: e.image?.origin as EventCard['imageOrigin'],
    sourceUrl: e.sourceUrl,
    platform: e.provenance.platform,
    organizerName: e.organizerName,
    priceText: e.priceText ?? (e.isFree ? 'Free' : undefined),
    tags: e.tags,
    category: e.category,
    visibility: e.visibility,
    excerpt: e.descriptionMd ? e.descriptionMd.replace(/\s+/g, ' ').slice(0, 200) : undefined,
    missing,
    complete,
  }
}
