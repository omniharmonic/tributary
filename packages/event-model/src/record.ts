/**
 * The published record (architecture §6). Follows atmo's writer field for field so
 * stock atmo.rsvp renders the card completely: inline `media`, `timezone`,
 * `preferences`, `additionalData.externalSource`.
 */
import { DateTime } from 'luxon'
import { latLngToCell } from 'h3-js'
import { linkFacets } from './text.js'
import { EVENT_COLLECTION, RECORD_PROFILE_VERSION, type EventLocation, type NormalizedEvent } from './types.js'

/** A blob reference in its JSON (lex) form, as returned by `uploadBlob` once serialized. */
export interface JsonBlobRef {
  $type: 'blob'
  ref: { $link: string }
  mimeType: string
  size: number
}

export interface MediaInput {
  blob: JsonBlobRef | { toJSON?: () => unknown }
  width?: number
  height?: number
  alt?: string
}

export interface BuildRecordOptions {
  /** The adapter's public origin: `createdWith`. */
  createdWith: string
  /** Uploaded cover image, when the publisher has one. */
  media?: MediaInput
  /** Preserve the original creation time on updates. */
  createdAt?: string
  /** Publish this as a gated teaser (coarse location, no join link, `additionalData.gated`). */
  teaser?: boolean
  syncedAt?: string
  /** The address lexicon requires `country`; a source that omits it gets the region's. Default 'US'. */
  defaultCountry?: string
}

export interface EventRecord {
  $type: typeof EVENT_COLLECTION
  name: string
  description?: string
  facets?: ReturnType<typeof linkFacets>
  createdAt: string
  startsAt: string
  endsAt?: string
  timezone: string
  mode: string
  status: string
  locations?: unknown[]
  uris: Array<{ uri: string; name?: string }>
  media?: unknown[]
  preferences: { showInDiscovery: boolean }
  createdWith: string
  additionalData: Record<string, unknown>
  [k: string]: unknown
}

export const RSVP_LABELS: Record<string, string> = {
  luma: 'RSVP on Luma',
  meetup: 'RSVP on Meetup',
  eventbrite: 'Tickets on Eventbrite',
  google: 'View on Google Calendar',
  wordpress: 'Details and RSVP',
  squarespace: 'Details and RSVP',
  humanitix: 'Tickets on Humanitix',
  dandelion: 'RSVP on Dandelion',
}

function localIso(instant: string, tz: string): string {
  const dt = DateTime.fromISO(instant, { zone: 'utc' }).setZone(tz)
  return dt.toISO({ suppressMilliseconds: false })!
}

/** H3 resolution 7 is ~5 km2: a neighborhood, not a block. */
export const NEIGHBORHOOD_H3_RESOLUTION = 7

export function publishedLocations(locations: EventLocation[], coarse: boolean, defaultCountry = 'US'): unknown[] {
  const out: unknown[] = []
  for (const l of locations) {
    const isCoarse = coarse || l.private || l.precision !== 'exact'
    if (isCoarse) {
      const addr: Record<string, string> = { $type: 'community.lexicon.location.address' }
      if (l.locality) addr.locality = l.locality
      if (l.region) addr.region = l.region
      addr.country = l.country ?? defaultCountry
      if (l.locality) addr.name = l.locality
      if (Object.keys(addr).length > 2) out.push(addr)
      if (l.lat !== undefined && l.lon !== undefined) {
        out.push({ $type: 'community.lexicon.location.hthree', value: latLngToCell(l.lat, l.lon, NEIGHBORHOOD_H3_RESOLUTION), name: l.locality ?? l.name })
      }
      continue
    }
    const addr: Record<string, string> = { $type: 'community.lexicon.location.address' }
    if (l.name) addr.name = l.name
    if (l.street) addr.street = l.street
    if (l.locality) addr.locality = l.locality
    if (l.region) addr.region = l.region
    if (l.postalCode) addr.postalCode = l.postalCode
    addr.country = l.country ?? defaultCountry
    if (Object.keys(addr).length > 2) out.push(addr)
    if (l.lat !== undefined && l.lon !== undefined) {
      const geo: Record<string, string> = { $type: 'community.lexicon.location.geo', latitude: String(l.lat), longitude: String(l.lon) }
      if (l.name) geo.name = l.name
      out.push(geo)
    }
  }
  return out
}

export function buildEventRecord(e: NormalizedEvent, opts: BuildRecordOptions): EventRecord {
  const now = opts.syncedAt ?? new Date().toISOString()
  const teaser = opts.teaser ?? e.visibility === 'gated'
  const gateJoin = teaser || (e.gatedFields ?? []).includes('joinUrl') || e.visibility === 'public' || e.visibility === 'unlisted'
  const gateLocation = teaser || (e.gatedFields ?? []).includes('exactLocation')

  const description = e.descriptionMd
  const record: EventRecord = {
    $type: EVENT_COLLECTION,
    name: e.name,
    ...(description ? { description, facets: linkFacets(description) } : {}),
    createdAt: opts.createdAt ?? now,
    startsAt: localIso(e.start.instant, e.start.tz),
    ...(e.end ? { endsAt: localIso(e.end.instant, e.start.tz) } : {}),
    timezone: e.start.tz,
    mode: `${EVENT_COLLECTION}#${e.mode}`,
    status: `${EVENT_COLLECTION}#${e.status}`,
    uris: [],
    preferences: { showInDiscovery: e.visibility === 'public' },
    createdWith: opts.createdWith,
    additionalData: {},
  }
  if (record.facets && record.facets.length === 0) delete record.facets

  const locations = publishedLocations(e.locations, gateLocation, opts.defaultCountry)
  if (locations.length > 0) record.locations = locations

  const uris: Array<{ uri: string; name?: string }> = []
  if (e.sourceUrl) uris.push({ uri: e.sourceUrl, name: RSVP_LABELS[e.provenance.platform] ?? 'RSVP at the source' })
  if (e.joinUrl && !gateJoin) uris.push({ uri: e.joinUrl, name: 'Join online' })
  for (const l of e.links) if (uris.length < 10) uris.push({ uri: l.uri, ...(l.name ? { name: l.name } : {}) })
  record.uris = uris

  if (opts.media) {
    const blob = typeof (opts.media.blob as { toJSON?: unknown }).toJSON === 'function' ? (opts.media.blob as { toJSON: () => unknown }).toJSON() : opts.media.blob
    record.media = [
      {
        role: 'thumbnail',
        ...(opts.media.alt ?? e.image?.alt ? { alt: opts.media.alt ?? e.image?.alt } : {}),
        content: blob,
        ...(opts.media.width && opts.media.height ? { aspect_ratio: { width: opts.media.width, height: opts.media.height } } : {}),
      },
    ]
  }

  const additional: Record<string, unknown> = {
    externalSource: {
      platform: e.provenance.platform,
      url: e.sourceUrl,
      rsvpMode: 'external_only',
      externalId: e.identity.occurrence ? `${e.identity.externalId}#${e.identity.occurrence}` : e.identity.externalId,
      method: e.provenance.method,
      syncedAt: now,
      profile: RECORD_PROFILE_VERSION,
    },
  }
  if (e.series) additional.series = e.series
  if (e.priceText) additional.priceText = e.priceText
  if (e.isFree !== undefined) additional.isFree = e.isFree
  if (e.tags.length) additional.tags = e.tags
  if (e.category) additional.category = e.category
  if (e.organizerName) additional.organizerName = e.organizerName
  if (e.start.allDay) additional.allDay = true
  if (teaser) additional.gated = true
  if (e.status === 'cancelled') additional.cancelledAt = now
  record.additionalData = additional
  return record
}

/** Strip a record down to the Listed-tier profile (PRD F14). */
export function toListedRecord(record: EventRecord): EventRecord {
  const { description: _d, facets: _f, media: _m, ...rest } = record
  const ext = { ...(rest.additionalData.externalSource as object), listed: true }
  return { ...rest, additionalData: { externalSource: ext } }
}
