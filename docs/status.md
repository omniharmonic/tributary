# Status against the plan (2026-09-21)

Deployed: https://boulderevents.directory (see `deployment.md`).

## Functional requirements

| # | Requirement | State |
|---|---|---|
| F1 | One-box detection | Done — 40 fixtures in `fixtures/detect` |
| F2 | Preview before publish | Done — same card model as the directory |
| F3 | Custodial signup | Done — smoke-tested against a real PDS |
| F4 | BYO sign-in (OAuth) | Built; needs a live run against a bsky.social host to confirm granular scopes |
| F5 | ICS sync correctness | Done — 13-file golden corpus |
| F6 | Card completeness | Done — local lexicon validation, `timezone`, attribution on every record |
| F7 | Image recovery | Done — order per §11, re-encode with sharp; rate not yet measured on 50 real events |
| F8 | Updates and cancellations | Done — grace periods in `reconcile.ts` |
| F9 | No duplicate writes | Done — smoke test asserts zero writes on re-sync |
| F10 | Extraction with confirmation | Built (one-box, email, Telegram all land in the queue; the identity step redirects to `/confirm/:id`); extraction is off in production until `EXTRACT_MODEL_API_KEY` is set |
| F11 | Email in | Handler built; the Cloudflare Email Worker is written (`infra/email-worker`) but not deployed (needs the zone on Cloudflare) |
| F12 | Claim | Token-in-source verification done (raises provenance to "Verified source"; smoke-tested); OAuth hosts on their own domain get "Verified domain". Claiming a curator's listing waits for the Listed tier (counsel) |
| F13 | Takeover and exit | Take-control, revoke, delete done; migration to a second PDS not exercised |
| F14 | Listed tier limits | `toListedRecord` exists; the tier is not open |
| F15 | Removal | Removal blocks honoured on connect; no self-serve request form yet |
| F16 | API, webhook, MCP | Done |
| F17 | Regional discovery | Console directory view (time-first, categories, webcal, badges); the atmo fork is not built |
| F18 | Cross-source duplicates | Done in the public view (`groupDuplicates`) |
| F19 | Moderation | Report link on every event page, steward queue (`/api/steward/reports`), de-index and custodial takedown |
| F20 | Privacy audit | Nightly job + parse-time redaction |
| F21 | Host dashboard | Done |
| F22 | Notifications | Outage mail and monthly digest done; confirmation-awaiting mail on the email channel only |
| F23 | Visibility levels | All six round-trip through Tributary and the Gate |
| F24 | Source signals and narrowing | Done — ceilings in classify, narrowing in reconcile, widening queued |
| F25 | Field gating | Done — teaser records carry no street or join link; nightly leak check |
| F26 | Invitations and approvals | Done in the Gate and the API; console audience page |
| F27 | Viewer-aware site | Gate viewer matrix tested; console reveals details to approved viewers |
| F28 | Group calendars | Members level writes to the group's calendar space; no group UI |
| F29 | Organisation roles | Done — `X-Acting-Host` with viewer/editor/owner enforcement, account switcher in the console, audit names the acting person |
| F30 | Labs parity and migration | Not run |

## Connectors

Done: `ics`, `gcal-public` (API key path untested without a key), `luma`, `meetup`, `tribe`, `squarespace`, `jsonld-page`, `upload` (.ics, .csv with column mapper), `sheet` (Google Sheets shared by link, column mapper in the preview), `eventbrite` (private token, encrypted per source), `localist` (public API, native photos), `mobilize` (public API, timeslots as occurrences), `manual`, `api`/webhook/mcp, `email`, `extract`.
`telegram` bot (link by code, forward or photo → confirm buttons; needs `TELEGRAM_BOT_TOKEN` + `TELEGRAM_WEBHOOK_SECRET`).
Not built (each needs an external app registration or a token from Benjamin): Google OAuth (A1), Microsoft Graph (A3), Discord (A5).

## Operations

Done: compose stack, release and backup scripts, nightly backup cron, restore drill (2026-09-21, dump restored into a scratch database on the box), health endpoint, relay monitor, privacy audit, leak check, outage notices, steward queue (`/steward`, `STEWARD_DIDS` set to Benjamin's Free School DID), bookmarklet, per-run creation cap (250) with a steward note above 50 on a first import, PDS rate-limit backoff.
Not done: Photon, Meilisearch, Telegram alerts, terms/privacy beyond drafts, DMCA agent.
