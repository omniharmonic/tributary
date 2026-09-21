/**
 * The shared event model. Every input method — feed, page, file, email, flyer, text,
 * API — ends up here after `parse` + `normalize`, and everything downstream (classify,
 * reconcile, publish, the console preview, the discovery view) reads only this shape.
 *
 * Architecture §5.1. Kept dependency-free so the console can import it too.
 */

export type SourceType =
  | 'ics'
  | 'gcal-public'
  | 'luma'
  | 'meetup'
  | 'tribe'
  | 'squarespace'
  | 'localist'
  | 'mobilize'
  | 'jsonld-page'
  | 'eventbrite'
  | 'gcal-oauth'
  | 'msgraph'
  | 'discord'
  | 'email'
  | 'upload'
  | 'sheet'
  | 'extract'
  | 'manual'
  | 'api'

export type EventStatus = 'scheduled' | 'cancelled' | 'postponed' | 'rescheduled' | 'planned'
export type EventMode = 'inperson' | 'virtual' | 'hybrid'

/** PRD §8.1: the five levels plus Held. */
export type Visibility = 'public' | 'unlisted' | 'gated' | 'members' | 'invite' | 'held'
export type VisibilitySource = 'host-default' | 'rule' | 'source-signal' | 'per-event' | 'api'
export type GatedField = 'exactLocation' | 'joinUrl' | 'attendeeNotes' | 'contacts'
export type SourcePrivacy = 'public' | 'private' | 'confidential' | 'unlisted'

export interface Audience {
  /** The group DID whose members may see a `members` event. */
  group?: string
  /** Minimum role for `members` (Techne roles: 10 member, 20 steward). */
  minRole?: number
  /** The invite list (invite space skey) for an `invite` event. */
  inviteListId?: string
  /** Whether a gated event reveals details on request (`approval`) or to anyone who asks (`open`). */
  approval?: 'open' | 'approval'
}

export interface EventLocation {
  name?: string
  street?: string
  locality?: string
  region?: string
  postalCode?: string
  country?: string
  lat?: number
  lon?: number
  /** How exact the published location is allowed to be. */
  precision: 'exact' | 'neighborhood' | 'city'
  /** A home or otherwise private address: publishes coarse (locality + H3 cell). */
  private: boolean
}

export interface EventImage {
  url?: string
  /** A reference into the image cache (content hash) once fetched and re-encoded. */
  bytesRef?: string
  alt?: string
  width?: number
  height?: number
  origin: 'source' | 'host-logo' | 'placeholder'
}

export interface EventProvenance {
  /** Human platform label: 'luma', 'meetup', 'google', 'wordpress', ... */
  platform: string
  method: SourceType
  fetchedAt: string
  confidence: 'structured' | 'extracted-confirmed'
}

export interface NormalizedEvent {
  identity: {
    sourceId: string
    /** Stable per-source id (ICS UID, API id, hash fallback). */
    externalId: string
    /** For expanded recurrences: the original start in UTC (`UID#<start>` identity). */
    occurrence?: string
  }
  name: string
  descriptionMd?: string
  start: { instant: string; tz: string; allDay: boolean; tzInferred: boolean }
  end?: { instant: string }
  status: EventStatus
  mode: EventMode
  locations: EventLocation[]
  /** A conference link (Zoom, Meet, ...) pulled out of the description/location. Gated by default. */
  joinUrl?: string
  /** Canonical page for this event; the RSVP target. */
  sourceUrl: string
  links: Array<{ uri: string; name?: string }>
  image?: EventImage
  organizerName?: string
  priceText?: string
  isFree?: boolean
  tags: string[]
  category?: string
  series?: { key: string; index?: number }
  provenance: EventProvenance
  visibility: Visibility
  visibilitySource?: VisibilitySource
  audience?: Audience
  gatedFields?: GatedField[]
  /** What the source itself said (ICS CLASS, Google visibility, platform flags). */
  sourcePrivacy?: SourcePrivacy
  /** Sha-256 over the publishable content; equal hashes mean no write. */
  contentHash: string
}

/**
 * What a connector's `parse` hands to `normalize`. Deliberately loose: every field is
 * optional except the identity and the name, and dates are whatever the source said
 * plus the timezone it said them in.
 */
export interface RawEvent {
  externalId: string
  /** ISO instant of the original occurrence start, when this is an expanded recurrence. */
  occurrence?: string
  name: string
  /** HTML or plain text; `descriptionIsHtml` tells the normalizer which. */
  description?: string
  descriptionIsHtml?: boolean
  /** ISO 8601. With offset when the source gave one; a wall-clock string otherwise. */
  start: string
  end?: string
  /** IANA zone the start/end are in. Absent means "floating" (interpreted in the source default). */
  tz?: string
  allDay?: boolean
  status?: EventStatus
  mode?: EventMode
  /** Free-text location, structured pieces, or both. */
  location?: string
  locations?: Partial<EventLocation>[]
  geo?: { lat: number; lon: number }
  url?: string
  links?: Array<{ uri: string; name?: string }>
  imageUrl?: string
  imageAlt?: string
  organizerName?: string
  priceText?: string
  isFree?: boolean
  tags?: string[]
  category?: string
  seriesKey?: string
  seriesIndex?: number
  /** Source privacy signal, already mapped (ICS CLASS, Google visibility, platform flag). */
  sourcePrivacy?: SourcePrivacy
  /** Sequence/modified markers, for change detection debugging. Not published. */
  sequence?: number
  lastModified?: string
  /** Free-form source facts the connector wants to carry to `additionalData`. Small. */
  extra?: Record<string, unknown>
}

/** The record profile version stamped into `externalSource.profile`. Bump on any change to `buildEventRecord`. */
export const RECORD_PROFILE_VERSION = 1

export const EVENT_COLLECTION = 'community.lexicon.calendar.event'
