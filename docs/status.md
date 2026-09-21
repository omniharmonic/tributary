# Status against the plan (2026-09-21)

Deployed: https://tributary.freeskool.directory (see `deployment.md`).

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
| F10 | Extraction with confirmation | Built; extraction is off in production until `EXTRACT_MODEL_API_KEY` is set |
| F11 | Email in | Handler built; the Cloudflare Email Worker is not deployed |
| F12 | Claim | Not built (Listed tier waits for counsel; there is nothing to claim yet) |
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
| F29 | Organisation roles | API and settings UI; roles are recorded, not yet enforced on routes |
| F30 | Labs parity and migration | Not run |

## Connectors

Done: `ics`, `gcal-public` (API key path untested without a key), `luma`, `meetup`, `tribe`, `squarespace`, `jsonld-page`, `upload` (.ics, .csv with column mapper), `sheet` (Google Sheets published as CSV; mapping guessed from the template headers), `manual`, `api`/webhook/mcp, `email`, `extract`.
Not built: Eventbrite API, Google OAuth, Microsoft Graph, Discord, Localist, Mobilize, Telegram, bookmarklet.

## Operations

Done: compose stack, release and backup scripts, nightly backup cron, health endpoint, relay monitor, privacy audit, leak check, outage notices.
Not done: Photon, Meilisearch, Telegram alerts, monthly restore drill, terms/privacy beyond drafts, DMCA agent.
