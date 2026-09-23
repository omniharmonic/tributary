# Tributary

An open adapter that publishes community events from wherever they already live — feeds, pages, files, spreadsheets, email, flyers, text, chat, API — to AT Protocol as `community.lexicon.calendar.event` records in a repo the host owns, kept in sync. With a regional identity layer (custodial accounts on a community PDS, or sign in with your own) and a permission layer (the Gate) that gives every event one of six visibility levels.

Live: **https://boulderevents.directory** (Boulder). Status against the plan: `docs/status.md`. API: `docs/api.md`. Deploying: `docs/deployment.md`. Working documents: `.claude/`.

## What a host does

Paste a link, drop a file, or describe an event on `/add`. Tributary detects the kind of source, shows the real cards, asks for an email and a handle, and publishes. From then on the source stays the truth: edits, cancellations and new events appear on their own.

Sources that work today: Google Calendar (public), Luma, Meetup, Eventbrite (page, or live with a token), WordPress Events Calendar, Squarespace, Localist, Mobilize, any `.ics`/webcal feed, any page with schema.org events, `.ics` and CSV uploads, Google Sheets, a forwarded email, a flyer photo, typed text, a Telegram bot, a REST API, an inbound webhook, and an MCP server for agents.

## Layout

```
apps/tributary        API, workers, connector runtime, reconcile, publisher   (AGPL)
apps/console          one-box UI, host dashboard, steward queue, public directory view
apps/gate             permission service: SpaceStore, policy engine, invites, approvals, audit
apps/mcp              MCP server (thin client of the API)
packages/event-model  NormalizedEvent, record builder, lexicon validation, card profile, duplicates (MIT)
packages/connectors   connector SDK + one module per source type (MIT)
packages/detect       input classification and platform fingerprints
packages/identity     PDS provisioning, credentials, handles, takeover, exit
packages/publisher    atproto writers (custodial, OAuth), CAS, blob upload
packages/spaces-shim  SpaceStore interface + memory and Postgres backends + Gate client
packages/policy       predicate evaluation over membership, invite, approval and RSVP claims
packages/visibility   classify stage: source signals, rules, field gating, narrowing rule
packages/ssrf-fetch   the only module allowed to fetch user-supplied URLs
infra/                compose (local + production), release and backup scripts, the email worker
fixtures/             golden ICS corpus, page snapshots, detector inputs
```

## Develop

```sh
pnpm install
# a local reference PDS: see ../freeskool/infra/compose.yml (port 3000, handle domain `test`)
pnpm -r test                      # 300+ tests across the workspace
pnpm -r typecheck
PDS_ADMIN_PASSWORD=… pnpm --filter @tributary/tributary smoke   # end to end against the local PDS
VITE_MOCK_API=1 pnpm --filter @tributary/console dev            # the console without a backend
```

Ports: Tributary 4100, Gate 4200, console dev 5174. Postgres at `postgres://localhost:5432/tributary`.

## Principles (from the PRD)

Never ask a host to change tools. The source is the truth. Your events, your repo. Consent sets fidelity. No record names someone who did not write it. Always link back. Publishing is public and permanent, and we say so. Confirm anything we inferred. Easy in, easy out. Build with the ecosystem. Visibility narrows by itself and widens only by hand. Access control, not secrecy. One audience, one space.

## License

AGPL-3.0-or-later for the services; MIT for `packages/event-model` and `packages/connectors` so other importers and outside contributors can share the model and write connectors.
