# Tributary

An open adapter that publishes community events from wherever they already live — feeds, pages, files, email, flyers, text, API — to AT Protocol as `community.lexicon.calendar.event` records in a repo the host owns, kept in sync. With a regional identity layer (custodial accounts on a community PDS) and a permission layer (the Gate).

Working documents: `.claude/01_prd.md`, `.claude/02_technical-architecture.md`, `.claude/03_implementation-plan.md`. API contract: `docs/api.md`. Deployment: `docs/deployment.md`.

## Layout

```
apps/tributary        API, workers, connector runtime, reconcile, publisher
apps/console          one-box UI, host dashboard, public directory view
apps/gate             permission service: SpaceStore, policy engine, invites, approvals, audit
apps/mcp              MCP server (thin client of the API)
packages/event-model  NormalizedEvent, record builder, lexicon validation, card profile (MIT)
packages/connectors   connector SDK + one module per source type (MIT)
packages/detect       input classification and platform fingerprints
packages/identity     PDS provisioning, credentials, handles, takeover, exit
packages/publisher    atproto writers (custodial, OAuth), CAS, blob upload
packages/spaces-shim  SpaceStore interface + Postgres backend
packages/policy       predicate evaluation over membership, invite, approval and RSVP claims
packages/visibility   classify stage: source signals, rules, field gating, narrowing rule
packages/ssrf-fetch   the only module allowed to fetch user-supplied URLs
infra/                compose (local + production), release and backup scripts
fixtures/             golden ICS corpus, page snapshots, expected records
```

## Develop

```sh
pnpm install
pnpm infra:up          # local Postgres + reference PDS
pnpm dev
pnpm test
```
