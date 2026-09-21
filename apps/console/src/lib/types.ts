/**
 * Types for the API contract in docs/api.md. Only types are imported from the event
 * model (its runtime pulls Node-only libraries).
 */
import type { Audience, EventCard, GatedField, RawEvent, SourceType, Visibility, VisibilitySource } from '@tributary/event-model'

export type { Audience, EventCard, GatedField, RawEvent, SourceType, Visibility, VisibilitySource }

export type ErrorCode =
  | 'InvalidInput'
  | 'NotFound'
  | 'Unauthorized'
  | 'Forbidden'
  | 'RateLimited'
  | 'SourceUnreachable'
  | 'SourceUnsupported'
  | 'NeedsConfirmation'
  | 'Conflict'
  | 'PdsRejected'
  | 'Internal'
  | 'Network'

export interface ApiErrorBody {
  error: ErrorCode | string
  message: string
}

export interface PublicConfig {
  region: { slug: string; name: string; tz: string }
  handleDomain: string
  brand: string
  adapterName: string
}

export interface DetectMatch {
  type: SourceType
  platform: string
  confidence: number
  label: string
  hint: Record<string, unknown>
  note?: string | null
}

export interface DetectResponse {
  matches: DetectMatch[]
  preview: null
}

export type PreviewCard = EventCard & {
  confidence?: Record<string, number>
  needsConfirmation?: boolean
}

/** CSV uploads: how the file's columns map onto event fields, so the host can correct it. */
export type CsvField = 'name' | 'start' | 'startTime' | 'end' | 'endTime' | 'location' | 'description' | 'url' | 'image' | 'price' | 'tags' | 'id'
export const CSV_FIELDS: CsvField[] = ['name', 'start', 'startTime', 'end', 'endTime', 'location', 'description', 'url', 'image', 'price', 'tags', 'id']
export interface CsvInfo {
  headers: string[]
  mapping: Partial<Record<CsvField, string | null>>
  sample: Array<Record<string, string>>
  unmapped: string[]
}

export interface Preview {
  previewId: string
  source: {
    type: SourceType
    platform: string
    label: string
    fingerprint: string
    tz: string
    alreadyConnected: boolean
  }
  count: number
  upcoming: number
  cards: PreviewCard[]
  notes: string[]
  defaultVisibility: Visibility
  signals: { private: number; conferenceLinks: number }
  expiresAt: string
  /** Extracted (flyer, text, page) previews: nothing publishes until a person confirms. */
  needsConfirmation?: boolean
  /** Present for CSV uploads and Google Sheets. */
  csv?: CsvInfo
}

export type ProvenanceLevel = 'email' | 'source' | 'domain' | 'listed'

export interface Host {
  id: string
  did: string
  handle: string
  displayName: string
  email: string
  door: 'custodial' | 'oauth'
  provenanceLevel: ProvenanceLevel
  region: string
  logoUrl?: string | null
  createdAt: string
}

export interface Me {
  host: Host
  capabilities: { canSetPassword: boolean; canMigrate: boolean }
}

export interface SignupResponse {
  did: string | null
  handle: string
  status: 'check-your-email'
  verifyUrl?: string
}

export interface HandleCheck {
  ok: boolean
  reason?: 'invalid' | 'reserved' | 'taken'
  suggestions?: string[]
}

export type SourceStatus = 'active' | 'paused' | 'failing' | 'held'

export interface Source {
  id: string
  type: SourceType
  platform: string
  label: string
  url?: string
  status: SourceStatus
  defaultVisibility: Visibility
  audience?: Audience | null
  lastSyncAt?: string | null
  lastSuccessAt?: string | null
  nextRunAt?: string | null
  consecutiveFailures: number
  lastError: { code: string; message: string } | null
  counts: { live: number; cancelled: number; held: number }
  claimed: boolean
  createdAt: string
  tz?: string
  interval?: number
}

/** Proving control of a source: the token goes in the calendar's title or description. */
export interface VerifyToken {
  token: string
  instructions: string
}
export type VerifyCheck = { verified: true; provenanceLevel: ProvenanceLevel } | { verified: false; reason: string }

export interface SyncRun {
  startedAt: string
  finishedAt?: string | null
  ok: boolean
  fetched: number
  published: number
  updated: number
  cancelled: number
  removed: number
  held: number
  error?: { code: string; message: string } | null
}

export interface Rule {
  match: {
    titleContains?: string
    calendar?: string
    category?: string
    locationType?: 'home' | 'venue' | 'online'
    flag?: 'private' | 'membersOnly'
  }
  level: Visibility
  audience?: Audience
  gatedFields?: GatedField[]
}

export interface SourceDetail extends Source {
  rules: Rule[]
  syncRuns: SyncRun[]
}

export type EventState = 'live' | 'cancelled' | 'held' | 'removed'

export interface EventOverride {
  hidden?: boolean
  category?: string
  imageUrl?: string | null
  visibility?: Visibility
  audience?: Audience
  gatedFields?: GatedField[]
}

export interface LedgerEvent {
  id: string
  sourceId: string
  externalId: string
  occurrence?: string | null
  state: EventState
  visibility: Visibility
  visibilitySource?: VisibilitySource
  card: EventCard
  atUri?: string | null
  atCid?: string | null
  spaceUri?: string | null
  teaserAtUri?: string | null
  firstSeen: string
  lastSeen: string
  missingSince?: string | null
  override: EventOverride | null
}

export interface Confirmation {
  id: string
  kind: 'extracted' | 'widen' | 'claim'
  createdAt: string
  expiresAt: string
  channel: 'console' | 'email' | 'telegram'
  sourceId?: string | null
  cards: PreviewCard[]
  proposed: Record<string, unknown>
  evidence: Record<string, string>
  /** For recurrences: the next three expanded dates, so the guess is checkable. */
  nextDates?: string[]
}

export interface ApiKey {
  id: string
  name: string
  createdAt: string
  lastUsedAt?: string | null
  /** Present exactly once, on creation. */
  key?: string
}

export interface Inbound {
  email: string
  webhookUrl: string
  webhookSecret: string
}

export interface PublicHost {
  did: string
  handle: string
  displayName: string
  provenanceLevel: ProvenanceLevel
  logoUrl?: string | null
  about?: string | null
}

export type ReportReason = 'spam' | 'not-an-event' | 'wrong-details' | 'private-information' | 'harassment' | 'copyright' | 'other'
export const REPORT_REASONS: Array<{ value: ReportReason; label: string }> = [
  { value: 'spam', label: 'Spam or advertising' },
  { value: 'not-an-event', label: 'Not an event' },
  { value: 'wrong-details', label: 'Wrong details (time, place, link)' },
  { value: 'private-information', label: 'Shows private information' },
  { value: 'harassment', label: 'Harassment or hate' },
  { value: 'copyright', label: 'Copyright' },
  { value: 'other', label: 'Something else' },
]

export interface PublicEvent {
  card: EventCard
  host: PublicHost
  did: string
  rkey: string
  atUri?: string | null
  /** Present only for a signed-in viewer who is entitled to it. */
  audienceName?: string | null
  locations?: Array<{ name?: string; street?: string; locality?: string; region?: string; coarse?: boolean }>
  descriptionMd?: string | null
  /** For gated events, the revealed details when this viewer is approved. */
  revealed?: { exactLocation?: string; joinUrl?: string; attendeeNotes?: string } | null
  requestState?: 'none' | 'pending' | 'approved' | 'denied'
}

export interface AudienceInfo {
  spaceUri: string
  policy: string
  members: number
  invites: Array<{ id: string; kind: 'join' | 'read' | 'read-join'; expiresAt: string; usesLeft: number | null; url?: string }>
  requests: Array<{ id: string; did: string; handle: string; requestedAt: string; state: 'pending' | 'approved' | 'denied' }>
}

export type OrgRoleName = 'owner' | 'editor' | 'viewer'
export interface OrgRole {
  did: string
  role: OrgRoleName
}

/** A host (other than my own) I hold a role on; `GET /api/me/managed`. */
export interface ManagedHost {
  id: string
  handle: string
  displayName: string
  role: OrgRoleName
}

export interface JoinResult {
  spaceUri: string
  kind: 'join' | 'read' | 'read-join'
  role: number | null
}

/** F19: a report in the steward queue. */
export type ReportAction = 'dismiss' | 'deindex' | 'takedown'
export interface StewardReport {
  id: string
  atUri: string
  reason: ReportReason | string
  details: string | null
  createdAt: string
  resolvedAt: string | null
  resolution: ReportAction | null
  event: { id: string; name: string | null; state: string; visibility: string; hidden: boolean } | null
  host: { handle: string; displayName: string; door: 'custodial' | 'oauth' | 'listed' | string } | null
}
