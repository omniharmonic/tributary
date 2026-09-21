/**
 * App-only state (architecture §5.2). Everything published is rebuildable from repos;
 * this is the ledger, the credentials and the host's choices. Tables are `tb_*`.
 */
import { sql } from 'drizzle-orm'
import { boolean, customType, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (v) => v,
  fromDriver: (v) => (Buffer.isBuffer(v) ? v : Buffer.from(v as Uint8Array)),
})

const now = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

/** One per publishing identity. */
export const host = pgTable(
  'tb_host',
  {
    id: text('id').primaryKey(),
    did: text('did').notNull(),
    handle: text('handle').notNull(),
    /** custodial | oauth | listed */
    door: text('door').notNull(),
    email: text('email'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    displayName: text('display_name').notNull().default(''),
    /** A prepared image hash in tb_image_cache, used as the fallback cover. */
    logoImageHash: text('logo_image_hash'),
    region: text('region').notNull(),
    /** email | source | domain | listed */
    provenanceLevel: text('provenance_level').notNull().default('email'),
    /** The host's PDS endpoint (custodial: ours; oauth: theirs). */
    pdsUrl: text('pds_url').notNull(),
    /** Set when the host took control (password set) or signed in with their own account. */
    ownershipExercisedAt: timestamp('ownership_exercised_at', { withTimezone: true }),
    /** Sync paused for the whole host (credential revoked, OAuth broken). */
    pausedReason: text('paused_reason'),
    createdAt: now(),
  },
  (t) => [uniqueIndex('tb_host_did_idx').on(t.did), uniqueIndex('tb_host_handle_idx').on(t.handle), index('tb_host_email_idx').on(t.email)],
)

/** How we write for a host. AES-256-GCM, keys outside the database. */
export const credential = pgTable('tb_credential', {
  hostId: text('host_id').primaryKey().references(() => host.id, { onDelete: 'cascade' }),
  /** app_password | oauth_session */
  kind: text('kind').notNull(),
  keyVersion: text('key_version').notNull(),
  ciphertext: bytea('ciphertext').notNull(),
  /** For OAuth: the session id in the oauth store; for app passwords: the login identifier. */
  identifier: text('identifier').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** One per connected input. */
export const source = pgTable(
  'tb_source',
  {
    id: text('id').primaryKey(),
    hostId: text('host_id')
      .notNull()
      .references(() => host.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    platform: text('platform').notNull(),
    label: text('label').notNull(),
    fingerprint: text('fingerprint').notNull(),
    config: jsonb('config').notNull().$type<Record<string, unknown>>(),
    /** Source-specific credentials, encrypted like tb_credential. */
    secretsKeyVersion: text('secrets_key_version'),
    secretsCiphertext: bytea('secrets_ciphertext'),
    cursor: jsonb('cursor'),
    etag: text('etag'),
    lastModified: text('last_modified'),
    tz: text('tz').notNull(),
    /** Milliseconds. Adapts between the floor and the ceiling. */
    intervalMs: integer('interval_ms').notNull(),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull().defaultNow(),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    /** active | paused | failing | held */
    status: text('status').notNull().default('active'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    unchangedRuns: integer('unchanged_runs').notNull().default(0),
    lastError: jsonb('last_error').$type<{ code: string; message: string } | null>(),
    /** uid | hash — switches when the source is seen regenerating UIDs. */
    identityMode: text('identity_mode').notNull().default('uid'),
    windowFrom: timestamp('window_from', { withTimezone: true }),
    windowTo: timestamp('window_to', { withTimezone: true }),
    defaultVisibility: text('default_visibility').notNull().default('public'),
    audience: jsonb('audience'),
    claimed: boolean('claimed').notNull().default(true),
    /** Notified the host about a >24 h outage at. */
    outageNotifiedAt: timestamp('outage_notified_at', { withTimezone: true }),
    createdAt: now(),
  },
  (t) => [index('tb_source_host_idx').on(t.hostId), index('tb_source_next_run_idx').on(t.nextRunAt), uniqueIndex('tb_source_fingerprint_idx').on(t.fingerprint)],
)

/** The reconciliation ledger. */
export const sourceEvent = pgTable(
  'tb_source_event',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id')
      .notNull()
      .references(() => source.id, { onDelete: 'cascade' }),
    hostId: text('host_id').notNull(),
    externalId: text('external_id').notNull(),
    occurrence: text('occurrence').notNull().default(''),
    contentHash: text('content_hash').notNull(),
    /** The last NormalizedEvent we computed (what the card renders from). */
    normalized: jsonb('normalized').notNull().$type<Record<string, unknown>>(),
    rkey: text('rkey'),
    atUri: text('at_uri'),
    atCid: text('at_cid'),
    recordCreatedAt: text('record_created_at'),
    blob: jsonb('blob'),
    imageHash: text('image_hash'),
    recordVersion: integer('record_version').notNull().default(0),
    /** live | cancelled | removed | held */
    state: text('state').notNull().default('held'),
    visibility: text('visibility').notNull().default('held'),
    visibilitySource: text('visibility_source'),
    spaceUri: text('space_uri'),
    spaceRecordUri: text('space_record_uri'),
    teaserAtUri: text('teaser_at_uri'),
    override: jsonb('override').$type<Record<string, unknown> | null>(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    firstSeen: timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
    missingSince: timestamp('missing_since', { withTimezone: true }),
    missingRuns: integer('missing_runs').notNull().default(0),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    lastError: text('last_error'),
  },
  (t) => [
    uniqueIndex('tb_source_event_identity_idx').on(t.sourceId, t.externalId, t.occurrence),
    index('tb_source_event_host_idx').on(t.hostId, t.startsAt),
    index('tb_source_event_state_idx').on(t.state, t.startsAt),
    index('tb_source_event_uri_idx').on(t.atUri),
  ],
)

/** Raw events pushed to us (API, webhook, upload, manual, email): the "feed" for push sources. */
export const pushedEvent = pgTable(
  'tb_pushed_event',
  {
    sourceId: text('source_id')
      .notNull()
      .references(() => source.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    raw: jsonb('raw').notNull().$type<Record<string, unknown>>(),
    /** A pushed delete: the event is cancelled on the next reconcile and removed after the grace period. */
    deleted: boolean('deleted').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('tb_pushed_event_idx').on(t.sourceId, t.externalId)],
)

export const syncRun = pgTable(
  'tb_sync_run',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id')
      .notNull()
      .references(() => source.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    ok: boolean('ok'),
    notModified: boolean('not_modified').notNull().default(false),
    fetched: integer('fetched').notNull().default(0),
    published: integer('published').notNull().default(0),
    updated: integer('updated').notNull().default(0),
    unchanged: integer('unchanged').notNull().default(0),
    cancelled: integer('cancelled').notNull().default(0),
    removed: integer('removed').notNull().default(0),
    held: integer('held').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    error: jsonb('error').$type<{ code: string; message: string } | null>(),
  },
  (t) => [index('tb_sync_run_source_idx').on(t.sourceId, t.startedAt)],
)

/** Extracted events and widenings awaiting a person. */
export const pendingConfirmation = pgTable(
  'tb_pending_confirmation',
  {
    id: text('id').primaryKey(),
    hostId: text('host_id')
      .notNull()
      .references(() => host.id, { onDelete: 'cascade' }),
    sourceId: text('source_id'),
    /** extracted | widen | claim */
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull().$type<Record<string, unknown>>(),
    /** console | email | telegram */
    channel: text('channel').notNull().default('console'),
    tokenHash: text('token_hash'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolution: text('resolution'),
    createdAt: now(),
  },
  (t) => [index('tb_pending_host_idx').on(t.hostId, t.resolvedAt)],
)

export const visibilityRule = pgTable(
  'tb_visibility_rule',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id')
      .notNull()
      .references(() => source.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    match: jsonb('match').notNull().$type<Record<string, unknown>>(),
    level: text('level').notNull(),
    audience: jsonb('audience'),
    gatedFields: jsonb('gated_fields').$type<string[]>(),
  },
  (t) => [index('tb_rule_source_idx').on(t.sourceId, t.position)],
)

export const apiKey = pgTable(
  'tb_api_key',
  {
    id: text('id').primaryKey(),
    hostId: text('host_id')
      .notNull()
      .references(() => host.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: now(),
  },
  (t) => [uniqueIndex('tb_api_key_hash_idx').on(t.keyHash), index('tb_api_key_host_idx').on(t.hostId)],
)

/** Per-host push channels: the inbound email token and the webhook token/secret. */
export const inboundAddress = pgTable('tb_inbound_address', {
  hostId: text('host_id').primaryKey().references(() => host.id, { onDelete: 'cascade' }),
  emailToken: text('email_token').notNull(),
  webhookToken: text('webhook_token').notNull(),
  webhookSecret: text('webhook_secret').notNull(),
  rotatedAt: timestamp('rotated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const session = pgTable(
  'tb_session',
  {
    id: text('id').primaryKey(),
    hostId: text('host_id')
      .notNull()
      .references(() => host.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: now(),
  },
  (t) => [index('tb_session_host_idx').on(t.hostId)],
)

/** Magic links: signup (carries the pending signup) and login. */
export const emailToken = pgTable(
  'tb_email_token',
  {
    tokenHash: text('token_hash').primaryKey(),
    email: text('email').notNull(),
    /** signup | login */
    purpose: text('purpose').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown> | null>(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: now(),
  },
  (t) => [index('tb_email_token_email_idx').on(t.email)],
)

/** Short-lived previews from the one-box (no host yet). */
export const preview = pgTable('tb_preview', {
  id: text('id').primaryKey(),
  match: jsonb('match').notNull().$type<Record<string, unknown>>(),
  config: jsonb('config').notNull().$type<Record<string, unknown>>(),
  /** The RawEvents (or the uploaded file's parsed events) so publish does not re-fetch. */
  rawEvents: jsonb('raw_events').notNull().$type<unknown[]>(),
  summary: jsonb('summary').notNull().$type<Record<string, unknown>>(),
  fingerprint: text('fingerprint').notNull(),
  tz: text('tz').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: now(),
})

export const imageCache = pgTable('tb_image_cache', {
  /** sha256 of the prepared bytes. */
  hash: text('hash').primaryKey(),
  sourceUrl: text('source_url'),
  sourceHash: text('source_hash'),
  mime: text('mime').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  bytes: bytea('bytes').notNull(),
  createdAt: now(),
})

export const pageCache = pgTable('tb_page_cache', {
  url: text('url').primaryKey(),
  /** What enrichment learned: image url, organizer, price. */
  meta: jsonb('meta').notNull().$type<Record<string, unknown>>(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
})

export const geocodeCache = pgTable('tb_geocode_cache', {
  key: text('key').primaryKey(),
  lat: text('lat'),
  lon: text('lon'),
  precision: text('precision'),
  createdAt: now(),
})

/** Who was granted what, by whom, when; every widening of visibility. No bodies. */
export const audit = pgTable(
  'tb_audit',
  {
    id: text('id').primaryKey(),
    hostId: text('host_id'),
    actor: text('actor'),
    action: text('action').notNull(),
    subject: text('subject'),
    detail: jsonb('detail').$type<Record<string, unknown> | null>(),
    createdAt: now(),
  },
  (t) => [index('tb_audit_host_idx').on(t.hostId, t.createdAt)],
)

export const orgRole = pgTable(
  'tb_org_role',
  {
    hostId: text('host_id')
      .notNull()
      .references(() => host.id, { onDelete: 'cascade' }),
    did: text('did').notNull(),
    /** owner | editor | viewer */
    role: text('role').notNull(),
    createdAt: now(),
  },
  (t) => [uniqueIndex('tb_org_role_idx').on(t.hostId, t.did)],
)

export const removalBlock = pgTable('tb_removal_block', {
  fingerprint: text('fingerprint').primaryKey(),
  reason: text('reason'),
  createdAt: now(),
})

/** OAuth (Door A) state and sessions, as `@atproto/oauth-client-node` stores them. */
export const oauthState = pgTable('tb_oauth_state', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  createdAt: now(),
})
export const oauthSession = pgTable('tb_oauth_session', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** F19: reports from the public card; the steward queue works from here. */
export const report = pgTable(
  'tb_report',
  {
    id: text('id').primaryKey(),
    atUri: text('at_uri').notNull(),
    reason: text('reason').notNull(),
    details: text('details'),
    /** sha256 of the reporter's IP + day, for rate limiting only. */
    reporterHash: text('reporter_hash'),
    reporterDid: text('reporter_did'),
    createdAt: now(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolution: text('resolution'),
  },
  (t) => [index('tb_report_uri_idx').on(t.atUri), index('tb_report_open_idx').on(t.resolvedAt, t.createdAt)],
)

export const schema = {
  report,
  host,
  credential,
  source,
  sourceEvent,
  pushedEvent,
  syncRun,
  pendingConfirmation,
  visibilityRule,
  apiKey,
  inboundAddress,
  session,
  emailToken,
  preview,
  imageCache,
  pageCache,
  geocodeCache,
  audit,
  orgRole,
  removalBlock,
  oauthState,
  oauthSession,
}

export const nowSql = sql`now()`
