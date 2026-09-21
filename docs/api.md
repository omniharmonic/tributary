# Tributary HTTP API (v1)

Base: `https://<host>/api`. JSON in, JSON out. Errors are `{ "error": "<Code>", "message": "<plain language>" }` with a 4xx/5xx status. Codes are a closed vocabulary: `InvalidInput`, `NotFound`, `Unauthorized`, `Forbidden`, `RateLimited`, `SourceUnreachable`, `SourceUnsupported`, `NeedsConfirmation`, `Conflict`, `PdsRejected`, `Internal`.

Two kinds of callers:

- **Browser sessions** (the console): cookie `tb_session` (HttpOnly, SameSite=Lax), set by the magic-link door or by OAuth. CSRF: state-changing routes require the header `X-Requested-With: tributary`.
- **API keys** (builders, MCP): `Authorization: Bearer tb_<key>`. Keys are scoped to one host.

All times are ISO 8601 with offset. IDs are opaque strings.

## Anonymous: the one-box

### `POST /api/detect`
Body: `{ "input": "<url | text>" }` or multipart with a `file` field (`.ics`, `.csv`, image, PDF) and optional `input`.
Response `200`:
```json
{
  "matches": [
    { "type": "luma", "platform": "luma", "confidence": 0.98, "label": "Luma calendar cal-abc", "hint": {...}, "note": null }
  ],
  "preview": null
}
```
`matches` is ranked; the console shows the first and offers the rest under "not right?". `type` is a `SourceType` from `@tributary/event-model`. For `extract` inputs (flyer, text, unstructured page) the match has `type: "extract"` and `note` explains that confirmation will be needed.

### `POST /api/preview`
Body: `{ "match": <one of the matches above> }` or multipart with `file` plus a `match` JSON string field. For CSV uploads the response also carries `csv: { headers, mapping, sample, unmapped, dropped }`; re-POST with `match.hint.mapping` set to correct the column mapping.
Fetches the source once (no persistence beyond a short-lived preview cache) and returns:
```json
{
  "previewId": "pv_…",
  "source": { "type": "luma", "platform": "luma", "label": "…", "fingerprint": "luma:cal-abc", "tz": "America/Denver", "alreadyConnected": false },
  "count": 23,
  "upcoming": 23,
  "cards": [ EventCard, … ],
  "notes": [ "4 events have no image; we will use your logo.", "2 events are marked private at the source and will be held." ],
  "defaultVisibility": "public",
  "signals": { "private": 2, "conferenceLinks": 3 },
  "expiresAt": "…"
}
```
`EventCard` is `toCard()` from `@tributary/event-model` (fields: `key,name,startsAt,endsAt,timezone,allDay,when,status,mode,place,placeCoarse,imageUrl,imageOrigin,sourceUrl,platform,organizerName,priceText,tags,category,visibility,excerpt,missing[],complete`). For `extract` matches, `cards` are the model's guesses and every card carries `"confidence"` per field plus `"needsConfirmation": true`.

### `GET /api/preview/:previewId`
Re-read a preview (the identity step comes back to it).

### `GET /api/public/config`
`{ region: { slug, name, tz }, handleDomain, brand, adapterName, extraction }`.

## Identity

### `POST /api/auth/signup`
Door B. Body: `{ "email": "…", "displayName": "…", "handle": "dairyarts", "previewId": "pv_…", "visibility": "public", "newsletter": false }`.
`handle` is the label only; the server appends the handle domain. Response `202`: `{ "did": null, "handle": "dairyarts.freeskool.directory", "status": "check-your-email" }`. The confirmation email carries a magic link `/auth/verify?token=…`. When SMTP is unset (development) the response also carries `verifyUrl`.

On verification the server: creates the PDS account, creates the `tributary-sync` app password, stores it encrypted, connects the previewed source with the chosen visibility, runs the first sync, and starts a session. `GET /api/auth/verify?token=` → `302` to `/dashboard?welcome=1` with the cookie set; JSON when `Accept: application/json`.

### `GET /api/auth/handle/check?label=…`
`{ "ok": true }` or `{ "ok": false, "reason": "invalid" | "reserved" | "taken", "suggestions": ["dairyarts2", …] }`.

### `POST /api/auth/login`
Returning host, Door B: `{ "email": "…" }` → `202` magic link (same verify route).

### `POST /api/auth/oauth/start`
Door A: `{ "handle": "alice.bsky.social", "previewId": "pv_…", "visibility": "public" }` → `{ "redirectUrl": "https://…/oauth/authorize…" }`. Callback at `/oauth/callback` establishes the session and connects the source. Scope requested: `atproto repo:community.lexicon.calendar.event blob:image/*`. If the host's PDS refuses granular scopes the callback lands on `/connect?error=scopes` and the console offers Door B.

### `GET /api/me`
`{ "host": { "id", "did", "handle", "displayName", "email", "door": "custodial" | "oauth", "provenanceLevel": "email" | "source" | "domain" | "listed", "region": "boulder", "logoUrl", "createdAt" }, "capabilities": { "canSetPassword": true, "canMigrate": true } }`. `401` when signed out.

### `POST /api/auth/logout`

### `POST /api/me/take-control`
Custodial only. Sends the PDS password-reset email (the PDS's own flow), and records the host as having exercised ownership. `{ "status": "email-sent" }`.

### `POST /api/me/revoke-sync`
Revokes the `tributary-sync` app password on request; sources pause. `{ "status": "revoked" }`.

### `POST /api/me/delete`
Deletes every published record we hold a ledger row for, then the sources, then (custodial) the PDS account. Body `{ "confirm": "delete everything" }`.

### `GET /api/me/export`
JSON of sources, ledger and overrides.

## Sources

### `GET /api/sources`
```json
{ "sources": [ { "id", "type", "platform", "label", "url", "status": "active" | "paused" | "failing" | "held", "defaultVisibility", "lastSyncAt", "lastSuccessAt", "nextRunAt", "consecutiveFailures", "lastError": { "code": "SourceUnreachable", "message": "Your calendar is no longer public." } | null, "counts": { "live": 23, "cancelled": 1, "held": 2 }, "claimed": true, "createdAt" } ] }
```

### `POST /api/sources`
Add a source to the signed-in host: `{ "match": <DetectMatch> | "previewId": "pv_…", "defaultVisibility": "public" | "unlisted" | "members" | "held", "audience": Audience? }`. `409 Conflict` when the fingerprint is connected by another host. Response `201` with the source and `{ "syncJobId" }`.

### `POST /api/sources` with a token (Eventbrite)
`{ "type": "eventbrite", "secrets": { "token": "<private token>" }, "defaultVisibility" }` → `201 { source, created }`. The token is encrypted at rest and only ever sent to Eventbrite. `400` with a plain message when the token is rejected or has no organisation.

### `GET /api/sources/:id`
The source plus `rules` and the last 10 `syncRuns` (`{ startedAt, finishedAt, ok, fetched, published, updated, cancelled, removed, held, error }`).

### `PATCH /api/sources/:id`
`{ "defaultVisibility"?, "audience"?, "paused"?: boolean, "interval"?: minutes, "tz"?: "America/Denver" }`. A change that would widen visibility of existing events returns `202 { "pendingConfirmation": n }` and does not apply until confirmed (narrowing rule).

### `POST /api/sources/:id/sync`
Run now. `202 { "jobId" }`. Rate limited to one per minute per source.

### `DELETE /api/sources/:id`
Unpublishes (deletes) every record from this source, then removes it. `{ "removed": n }`.

### Verified source
`POST /api/sources/:id/verify` → `{ token, instructions }`; the host puts the token in the calendar's description. `POST /api/sources/:id/verify/check` re-reads the source and, when the token is found, raises the host's provenance to `source` → `{ verified: true, provenanceLevel }`, else `{ verified: false, reason }`. OAuth hosts whose handle is their own domain get `domain` automatically.

### Rules

`GET /api/sources/:id/rules`, `PUT /api/sources/:id/rules` with `{ "rules": [ { "match": { "titleContains"?: "…", "calendar"?: "…", "category"?: "…", "locationType"?: "home" | "venue" | "online", "flag"?: "private" | "membersOnly" }, "level": Visibility, "audience"?: Audience, "gatedFields"?: GatedField[] } ] }`. Rules are evaluated in order; the first match wins. A rule that would widen existing events queues them for confirmation.

## Events (the ledger view)

### `GET /api/events?sourceId=&state=live|cancelled|held|removed&from=&to=&cursor=&limit=`
```json
{ "events": [ { "id", "sourceId", "externalId", "occurrence", "state", "visibility", "visibilitySource", "card": EventCard, "atUri", "atCid", "spaceUri", "teaserAtUri", "firstSeen", "lastSeen", "missingSince", "override": { "hidden"?: true, "category"?: "…", "imageUrl"?: "…", "visibility"?: Visibility } | null } ], "cursor": "…" }
```

### `PATCH /api/events/:id`
Per-event override: `{ "hidden"?: boolean, "category"?: string, "imageUrl"?: string | null, "visibility"?: Visibility, "audience"?: Audience, "gatedFields"?: GatedField[] }`. Narrowing applies at once (the record is replaced/withdrawn on the next reconcile, which is triggered immediately). Widening returns `202 { "pendingConfirmation": id }`.

### `POST /api/events/:id/republish`
Force a rewrite (e.g. after a profile bump). `202`.

## Confirmation queue (extracted events and widenings)

### `GET /api/confirmations`
`{ "items": [ { "id", "kind": "extracted" | "widen" | "claim", "createdAt", "expiresAt", "channel": "console" | "email" | "telegram", "sourceId", "cards": [EventCard], "proposed": { … }, "evidence": { "field": "spanText" } } ] }`

### `POST /api/confirmations/from-preview`
`{ previewId }` for an extract preview (flyer, text, unstructured page) → `201 { id }`; the console then opens `/confirm/:id`. On the identity step, a verified signup whose preview needs confirmation is redirected to `/confirm/:id` instead of the dashboard.

### `POST /api/confirmations/:id`
`{ "action": "confirm" | "reject", "edits"?: { "<cardKey>": Partial<RawEvent> } }`. Confirm publishes; reject discards. The email link form is `GET /confirm/:id?token=…` and lands on the console with the item preloaded.

## Push channels

### `POST /api/v1/events` (API key)
Idempotent by `externalId`. Body: one `RawEvent`-shaped object plus `{ "visibility"?, "audience"?, "gatedFields"? }`, or `{ "events": [ … ] }` for up to 200. `200 { "results": [ { "externalId", "action": "created" | "updated" | "unchanged" | "held", "atUri" } ] }`. `PUT /api/v1/events/:externalId` same body; `DELETE /api/v1/events/:externalId` → `{ "action": "cancelled" }` (cancelled now, deleted after the grace period; `?hard=1` deletes at once).

### `GET /api/v1/events` (API key)
The host's ledger, same shape as `/api/events`.

### `POST /api/v1/sources` (API key)
`{ "input": "<url>", "defaultVisibility"? }` — detect, configure and connect in one call (structured sources only). `202`.

### `POST /api/webhook/:hostToken`
The inbound webhook (Zapier, Make, n8n). Same body as `/api/v1/events`. Authenticated by the per-host token in the path plus an optional `X-Tributary-Signature: sha256=<hmac>` over the raw body with the host's webhook secret. Unsigned bodies from a token that has a secret set are held for confirmation rather than published.

### `POST /api/inbound/email`
From the Cloudflare Email Worker (signed with `INBOUND_EMAIL_SECRET`). `{ "to": "add+<token>@…", "from": "…", "spf": "pass", "dkim": "pass", "dmarc": "pass", "raw": "<base64 RFC822>" }`. `.ics` parts publish when the sender aligns with the host's verified email; anything else → confirmation queue.

### Telegram
`GET /api/me/telegram` → `{ enabled, linked, bot }`; `POST /api/me/telegram/link` → `{ code, bot, url }` (open the URL, or send `/start <code>` to the bot); `DELETE /api/me/telegram` unlinks. The bot posts updates to `POST /api/inbound/telegram` (secret header). A forwarded message or flyer photo is extracted and answered with Confirm/Reject buttons; nothing publishes without Confirm.

### API keys
`GET /api/me/keys`, `POST /api/me/keys { "name" }` → `{ "id", "name", "key": "tb_…" }` shown once, `DELETE /api/me/keys/:id`. `GET /api/me/inbound` → `{ "email": "add+<token>@in.<domain>", "webhookUrl": "…", "webhookSecret": "…" }`, `POST /api/me/inbound/rotate`.

## Gate-backed permissions (through Tributary; the site talks to the Gate directly)

### `GET /api/events/:id/audience`
For `gated`, `members`, `invite` events: `{ "spaceUri", "policy", "members": n, "invites": [ { "id", "kind": "join" | "read" | "read-join", "expiresAt", "usesLeft", "url": "shown once at creation" } ], "requests": [ { "id", "did", "handle", "requestedAt", "state": "pending" | "approved" | "denied" } ] }`.

### `POST /api/events/:id/invites`
`{ "kind": "read-join", "expiresInHours": 72, "maxUses": 20 }` → `{ "id", "url" }` (the URL is returned exactly once). `DELETE /api/events/:id/invites/:inviteId`.

### `POST /api/events/:id/invite-people`
`{ "handles": ["alice.bsky.social"], "emails": ["b@example.org"] }` → `{ "resolved": [ { "handle", "did" } ], "pendingEmails": [ … ] }`.

### `POST /api/join/:token`
Redeem a join link as the signed-in viewer → `{ spaceUri, kind, role }`.

### `POST /api/public/events/:did/:rkey/request`
A signed-in viewer asks for a place on a gated event → `{ state }`.

### `POST /api/events/:id/requests/:requestId`
`{ "action": "approve" | "deny" }`.

## Organisation roles

`GET /api/me/roles`, `POST /api/me/roles { "did" | "handle", "role": "owner" | "editor" | "viewer" }`, `DELETE /api/me/roles/:did`.

`GET /api/me/managed` → `{ hosts: [{ id, handle, displayName, role }] }`: hosts where the signed-in DID holds a role. Send `X-Acting-Host: <hostId>` on any `/api/me|sources|events|confirmations` request to act as that host: viewers may only GET; editors may do everything except delete-everything, API keys, roles, take-control, revoke-sync and inbound channels (owner only). `GET /api/me` then carries `acting: { role, as, actorDid }`. Audit rows name the acting person.

## Public, read-only (the discovery view served by the console)

### `GET /api/public/events?region=boulder&from=&to=&category=&q=&cursor=`
Public (and only public) events from every host in the region, as `EventCard` plus `{ "host": { "did", "handle", "displayName", "provenanceLevel" } }`. `Cache-Control: public, max-age=60`. Never returns unlisted, gated details, members, invite or held events.

### `GET /api/public/events/:did/:rkey`
One public event (or `404`, byte-identical for not-found and not-permitted).

### `GET /api/public/hosts/:handle`
A host's public profile and public events.

### `GET /api/public/regions/:region/calendar.ics`
Public events as a `text/calendar` feed. `GET /api/public/hosts/:handle/calendar.ics` per host.

### `GET /api/public/img/:did/:cid`
The image proxy: fetches `getBlob` from the repo's PDS, re-encodes, caches forever by CID.

## Operational

`GET /api/health` → `{ "status": "ok", "checks": { "postgres": "ok", "pds": "ok", "gate": "ok" }, "version" }`.
`GET /api/stats` (steward key) → counts.
`GET /oauth-client-metadata.json`, `GET /oauth/jwks.json`, `GET /oauth/callback` — Door A.
