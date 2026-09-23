# Tributary

**Tributary is an adapter.** It takes community events from wherever they already live —
a Google Calendar, a Luma page, a WordPress site, an `.ics` feed, a spreadsheet, a
forwarded email, a photo of a flyer — and publishes them to the AT Protocol as
`community.lexicon.calendar.event` records **in a repository the host owns**, then keeps
them in sync. Nobody is asked to change tools, and nobody has to trust us to keep their
data, because it was never ours.

**[Boulder Events Directory](https://boulderevents.directory) is the first instance.** It
is the front-facing product; Tributary is the machinery underneath, and it is meant to be
run by other regions. Right now it carries 55 Boulder County calendars and around 1,800
events, roughly 89% of them geocoded to a street address.

- Live: **https://boulderevents.directory**
- What is wired up and what is not: [`docs/sources.md`](docs/sources.md)
- HTTP API reference: [`docs/api.md`](docs/api.md)
- Running it: [`docs/deployment.md`](docs/deployment.md)
- Progress against the plan: [`docs/status.md`](docs/status.md)
- Design documents: [`.claude/`](.claude/)

---

## The idea in one page

Most event directories fail the same way. They ask organisers to re-enter events into a
new system, the organisers do it twice for a month, then they stop, and the directory
rots. Tributary inverts that: **the source stays the truth.** You keep posting to
whatever you already use. We watch it, and when you edit or cancel something there, the
published record changes or withdraws on its own.

What the host gets in return is not a listing on our website. It is a real AT Protocol
repository under their own DID, holding their own events, which they can take with them.
Our directory is one reader of that repository. Anyone can build another.

The principles that decide arguments, from the PRD:

> Never ask a host to change tools. The source is the truth. Your events, your repo.
> Consent sets fidelity. No record names someone who did not write it. Always link back.
> Publishing is public and permanent, and we say so. Confirm anything we inferred.
> Easy in, easy out. Build with the ecosystem. Visibility narrows by itself and widens
> only by hand. Access control, not secrecy. One audience, one space.

---

## How a sync works

Every source runs through the same eight stages. `apps/tributary/src/pipeline/` is the
whole of it, and it is written so a crash at any point leaves the ledger consistent: an
event's row is updated only after its record write has succeeded.

```
ingest → parse → normalize → enrich → classify → reconcile → publish → observe
```

| Stage | What happens | Where |
|---|---|---|
| **ingest** | Fetch the source politely. SSRF-safe, DNS-pinned, robots-aware, spaced per host. | `packages/ssrf-fetch` |
| **parse** | Platform-specific: an `.ics` VEVENT, a Tribe REST page, a Squarespace collection, JSON-LD, an LLM extraction. | `packages/connectors` |
| **normalize** | Everything becomes one `NormalizedEvent`. Recurrences expand, timezones resolve, a content hash is taken. | `packages/event-model` |
| **enrich** | Cover image recovery, venue matching, geocoding, categories. | `pipeline/enrich.ts` |
| **classify** | Decide visibility from source signals and host rules. Ceilings apply here. | `packages/visibility` |
| **reconcile** | Diff against the ledger. Equal hashes mean no write at all. Handles updates, cancellations and disappearances with grace periods. | `pipeline/reconcile.ts` |
| **publish** | Write `community.lexicon.calendar.event` to the host's repo; upload image blobs; index for search. | `packages/publisher` |
| **observe** | Record the run, adjust the next interval, notify on failure. | `pipeline/run.ts` |

A scheduler tick runs every minute and enqueues whatever is due. Nightly jobs handle
retention, a privacy leak check, relay health and a search reindex.

---

## Four ways to plug in

### 1. Read the directory

Nothing here needs an account or a key.

```sh
# Upcoming public events, as JSON
curl 'https://boulderevents.directory/api/public/events?limit=50'

# Full-text search: typo-tolerant, with Boulder synonyms ("gig" finds shows)
curl 'https://boulderevents.directory/api/public/events?q=live%20music'

# Everything within 5km of the Pearl Street Mall
curl 'https://boulderevents.directory/api/public/events?near=40.0176,-105.2797&radiusKm=5'

# A calendar subscription, for a phone or a website
curl 'https://boulderevents.directory/api/public/regions/boulder/calendar.ics'
```

Each event comes back as `{ card, host, did, rkey, atUri, audienceName, alsoOn }`. The
`card` is the same `EventCard` the host saw before publishing and the same one our own
front page renders, so what you build cannot drift from what we show. `alsoOn` names the
other sources carrying the same event, because the same concert is often on three
calendars.

Full parameters, including the search and radius semantics, are in
[`docs/api.md`](docs/api.md).

### 2. Read the AT Protocol records directly, and skip us entirely

This is the part worth understanding, because it is the point of the project. Every event
is a real record in a real repository. You do not need our API, our uptime or our
permission:

```sh
DID=did:plc:7ucd6qjmlenanyswjx5hcvko   # Boulder Events Directory's curator
curl "https://pds.boulderevents.directory/xrpc/com.atproto.repo.listRecords?repo=$DID&collection=community.lexicon.calendar.event&limit=5"
```

A record looks like this. It follows the `community.lexicon.calendar.event` lexicon, and
the optional fields are written the way [atmo.rsvp](https://atmo.rsvp) writes them, so
stock atmo renders our events without knowing we exist:

```jsonc
{
  "$type": "community.lexicon.calendar.event",
  "name": "Christmas in Mexico!: Mariachi Garibaldi de Jaime Cuéllar",
  "description": "Celebrate the season with Campana Sobre Campana…",
  "startsAt": "2026-12-18T19:30:00.000-07:00",
  "endsAt":   "2026-12-18T20:30:00.000-07:00",
  "timezone": "America/Denver",          // startsAt carries an offset, not a zone
  "status": "community.lexicon.calendar.event#scheduled",
  "mode":   "community.lexicon.calendar.event#inperson",
  "locations": [
    { "$type": "community.lexicon.location.address", "name": "Macky Auditorium",
      "street": "1595 Pleasant St", "locality": "Boulder", "region": "CO", "country": "US" },
    { "$type": "community.lexicon.location.hthree", "value": "872681a33ffffff" }
  ],
  "uris": [{ "uri": "https://calendar.colorado.edu/event/…", "name": "RSVP at the source" }],
  "media": [{ "role": "thumbnail", "content": { "$type": "blob", … }, "aspect_ratio": …}],
  "preferences": { "showInDiscovery": true },
  "createdWith": "https://boulderevents.directory",
  "additionalData": {
    "category": "music",
    "tags": ["concert/show"],
    "externalSource": {
      "platform": "localist",
      "url": "https://calendar.colorado.edu/event/…",
      "rsvpMode": "external_only",       // RSVP happens at the source, not here
      "externalId": "…", "method": "ics", "syncedAt": "…"
    }
  }
}
```

Three conventions there are not yet in the lexicon, and we have
[proposed them](docs/outreach.md) because two implementations already write them:
`timezone` (an offset is not a zone, and "7 pm" needs the zone), `media` (a cover image),
and `externalSource` (where this came from and where RSVP actually happens). If you are
writing an importer, please write these three the same way rather than inventing a
fourth dialect.

`rsvpMode: "external_only"` matters: we are an adapter, not a ticketing system. Every card
sends the reader back to the organiser's own page.

### 3. Push events in

If you are building something that produces events — a booking system, a venue's
back-end, an agent — there are five doors, all landing in the same pipeline.

**HTTP API, with a key.** Keys are scoped to one host and look like `tb_…`:

```sh
curl -X POST https://boulderevents.directory/api/v1/events \
  -H 'Authorization: Bearer tb_…' -H 'Content-Type: application/json' \
  -d '{ "externalId": "spring-gala-2027", "name": "Spring Gala",
        "startsAt": "2027-04-02T19:00:00-06:00", "timezone": "America/Denver",
        "sourceUrl": "https://example.org/gala", "visibility": "public" }'
```

`externalId` is yours and is the identity we reconcile on: send the same one again and it
is an update, not a duplicate. `POST /api/v1/sources` connects a whole calendar in one
call instead.

**Webhooks**, for Zapier, Make and n8n: `POST /api/webhook/:hostToken`, optionally signed
with `X-Tributary-Signature: sha256=<hmac>`. A body from a token that has a secret set but
arrives unsigned is held for confirmation rather than published.

**MCP**, for agents. `apps/mcp` is a thin, typed client of the same API and exposes
`publish_event`, `update_event`, `cancel_event`, `list_my_events`, `add_source` and
`list_sources`.

**Email**, by forwarding an invite to a per-host address, and **Telegram**, by messaging
the bot. Both run through extraction and neither publishes anything without an explicit
confirmation.

Anything we inferred rather than read — a flyer, a sentence, an unstructured page — goes
to a confirmation queue first. That is a rule, not a setting.

### 4. Write a connector

A connector is one interface and the runtime does everything else: scheduling,
politeness, retries, conditional GETs, storage, reconciliation, publishing. It is MIT
licensed, separately from the AGPL service, precisely so this is easy to contribute to and
to reuse elsewhere.

```ts
export interface Connector<Cfg, Cursor> {
  type: SourceType
  platform: string
  capabilities: {
    live: 'poll' | 'push' | 'none'
    delta: boolean              // can it tell us only what changed?
    explicitDeletes: boolean    // does it say when something is gone?
    images: 'native' | 'via-page' | 'none'
    requiresAuth: 'none' | 'apiKey' | 'oauth'
  }
  detect?(input, ctx): Promise<DetectMatch | null>   // is this mine? cheap, offline if possible
  configure(match, ctx): Promise<Cfg>                // a Luma page URL → its calendar id
  fetch(cfg, cursor, ctx): Promise<FetchResult<Cursor>>
  handlePush?(req, cfg, ctx): Promise<RawEvent[]>    // webhooks, email, bots
  defaultInterval: number
  fingerprint(cfg): string    // stable identity, for claims and duplicate detection
  label(cfg): string          // what a human should see
}
```

Two rules are enforced rather than encouraged. **A connector may not open a socket any
other way than `ctx.http`** — no `undici`, no `node:http`, no global `fetch` — because
that client is the one place SSRF protection, DNS pinning, size caps and per-host
politeness live. And **`complete: true` means "this is the full current set within the
window"**, which is what licenses us to treat a missing event as cancelled; say `false`
if you are not certain, and nothing will be withdrawn on your word.

`packages/connectors/src/` has fifteen worked examples. `ics/` is the most thorough
(recurrence expansion, `VTIMEZONE`, a 13-file golden corpus); `tribe/` is the clearest
small one to copy.

---

## The data model

Everything converges on `NormalizedEvent` (`packages/event-model/src/types.ts`) after
parse. Every stage after that reads only this shape, which is why a flyer photo and a
Google Calendar feed become indistinguishable downstream:

```ts
interface NormalizedEvent {
  identity: { sourceId: string; externalId: string; occurrence?: string }
  name: string
  descriptionMd?: string
  start: { instant: string; tz: string; allDay: boolean; tzInferred: boolean }
  end?: { instant: string }
  status: 'scheduled' | 'cancelled' | 'postponed' | 'rescheduled' | 'planned'
  mode: 'inperson' | 'virtual' | 'hybrid'
  locations: EventLocation[]      // precision: 'exact' | 'neighborhood' | 'city'
  joinUrl?: string                // pulled out of the description; gated by default
  sourceUrl: string               // canonical page, and the RSVP target
  image?: EventImage
  tags: string[]; category?: string
  provenance: { platform: string; method: SourceType; fetchedAt: string
                confidence: 'structured' | 'extracted-confirmed' }
  visibility: Visibility
  contentHash: string             // equal hashes mean no write
}
```

`contentHash` is what makes re-syncing free. `occurrence` is how one recurring `UID`
becomes many addressable events. `tzInferred` records that we guessed a zone rather than
read one, so the console can ask.

### Visibility

Six levels: `public`, `unlisted`, `gated`, `members`, `invite`, `held`. The rules worth
knowing before you build against this:

- **Visibility narrows by itself and widens only by hand.** If a source starts saying an
  event is private, the record narrows on the next sync with no one in the loop. Widening
  always queues a human confirmation. That asymmetry is deliberate and not configurable.
- **Access control, not secrecy.** A gated event is publicly listed; its *fields* are
  withheld. The street address and join link live in a teaser-free companion record, and a
  nightly job checks that no public record ever carried them.
- **Only public and gated events are indexed for search, and gated events are indexed
  without coordinates.** So a radius query cannot disclose an address that is being
  withheld — the guarantee is structural, not a check someone has to remember.

Permissions are enforced by the Gate (`apps/gate`), a Spaces-shaped store with Techne's
positive-only policy predicates, so the model can move to real AT Protocol Spaces when
that settles.

---

## Layout

```
apps/tributary        API, workers, connector runtime, reconcile, publisher   (AGPL)
apps/console          the UI: one-box, host dashboard, steward queue, directory
apps/gate             permissions: SpaceStore, policy engine, invites, approvals, audit
apps/mcp              MCP server (a thin client of the API)

packages/event-model  NormalizedEvent, record builder, lexicon validation, cards   (MIT)
packages/connectors   the connector SDK and one module per source type            (MIT)
packages/detect       input classification and platform fingerprints
packages/identity     PDS provisioning, credentials, handles, takeover, exit
packages/publisher    atproto writers (custodial and OAuth), CAS, blob upload
packages/spaces-shim  SpaceStore interface, memory and Postgres backends, Gate client
packages/policy       predicate evaluation over membership, invite, approval, RSVP
packages/visibility   the classify stage: source signals, rules, the narrowing rule
packages/ssrf-fetch   the only module allowed to fetch a user-supplied URL

infra/                compose files, release and backup scripts, region seed lists
fixtures/             golden ICS corpus, page snapshots, detector inputs
```

## Develop

```sh
pnpm install
pnpm test          # source hygiene, then 404 tests across 12 packages
pnpm typecheck

VITE_MOCK_API=1 pnpm --filter @tributary/console dev     # the UI with no backend
PDS_ADMIN_PASSWORD=… pnpm --filter @tributary/tributary smoke   # end to end, real PDS
```

Ports: Tributary 4100, Gate 4200, console dev 5174. Postgres at
`postgres://localhost:5432/tributary`. A local reference PDS is in
`../freeskool/infra/compose.yml`.

`pnpm test` starts with `scripts/check-sources.mjs`, which fails the build on a raw
control character in a text source. That exists because five modules once carried a
literal NUL as a key separator, which made `grep` skip those files silently — a codebase
search returned nothing for them and never said why.

## Run your own region

Tributary is regional by design; Boulder is a deployment, not the product. You need a
domain, a Postgres, a PDS and one box. [`docs/deployment.md`](docs/deployment.md) has the
compose files and the acceptance checks, and
[`infra/seeds/README.md`](infra/seeds/README.md) covers assembling your region's calendar
list — including the traps, such as checking reachability from the host that will actually
do the fetching rather than from your laptop, which is how we discovered three Boulder
sources that answer a residential connection and refuse a datacenter one.

## License

AGPL-3.0-or-later for the services. **MIT for `packages/event-model` and
`packages/connectors`**, so other importers can share the event model and contribute
connectors without taking on the service's licence.

## Talk to us

Ecosystem notes and our open proposals to the Lexicon Community are in
[`docs/outreach.md`](docs/outreach.md). If you are building an events reader, an importer,
or a directory for another region, the useful conversation is about the three undeclared
record fields above — we would rather converge on them than each keep our own dialect.
