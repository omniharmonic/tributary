*Benjamin Life (@omniharmonic) · 2026-09-20 · status: draft v0.2 (adds permissions and Spaces)*

# Events Suite — Implementation Plan

*Companion documents: `01_prd.md`, `02_technical-architecture.md`. Targets: a working Boulder directory with real hosts for COhere in October, and a demonstrable breadth of input methods for IIW #43 on November 3–5. Requirement numbers (F1–F22) and input-method numbers (I, A, P, B) refer to the PRD.*

## 0. Where we start

Already in hand, and reusable as-is:

- **Free School codebase** (same stack): Hono API, Postgres, pg-boss, reference PDS in compose, custodial signup by magic link, server-side OAuth confidential client, AES-GCM credential store, contrail indexing, Hetzner deployment and runbook. Roughly a third of Tributary's non-connector code exists there already. First task is lifting it into shared packages rather than copying it.
- **The Hetzner calendar scraper**: 12–13 Boulder calendars already identified and normalized by hand. These become the first fixtures and the first connected sources.
- **R4's `pds-follow`**, only needed if we later want Tributary to watch repos.
- **The Spaces seam**: Free School's `packages/spaces-shim` with its `PostgresSpaceStore`, the `school-actor` custody pattern, and the R1 alpha lab (`infra/spaces-alpha-lab`, raw-XRPC script, ran end to end on 2026-09-12). The Gate is mostly a lift of these.
- **Research**: record conventions confirmed from live repos and from atmo's source; PDS and relay behavior confirmed from source; Luma and Meetup ICS confirmed live.

Not in hand: any connector code, the detector, the reconcile engine, extraction, the fork, the policy engine, the classify stage, and the viewer-aware site.

**Capacity warning.** Free School is also aimed at COhere. Two builds against one deadline is the biggest risk in this plan. The COhere scope below is deliberately the smallest thing that is real: feeds and pages in, custodial accounts, a reskinned fork with one region. Everything else is scheduled after.

## 1. Milestones

| # | Milestone | Dates | Outcome |
|---|---|---|---|
| M0 | Spikes and foundations | Sep 21–27 | Every **(verify)** in the architecture is settled; repo scaffolded; fixtures captured; fork deployed unmodified to a staging domain |
| M1 | Paste a feed, end to end | Sep 28–Oct 9 | One-box → detect → preview → custodial signup → publish → live sync, for ICS, Google public, Luma, Meetup, WordPress, Squarespace, single JSON-LD pages, `.ics` upload and the manual form. Records render fully in stock atmo. Visibility is in the model from the first commit: Public, Unlisted and Held work, private source signals are honored, conference links are gated out of public records |
| M2 | Boulder goes live | Oct 10–18 | `boulder.directory` fork with region page, badges, imgproxy; 15 hosts connected including the existing 12–13 calendars by invitation; COhere's calendar in by agreement; host dashboard; ops and legal minimums. atmo's dormant private-event code removed from the fork; contrail unpinned |
| — | COhere week | late Oct (dates from Aaron) | Fixes only. Table at events: "paste your calendar, see it on the big screen" |
| M3 | Breadth and permissions for IIW | Oct 19–Nov 1 | Door A (OAuth), email-in, flyer and text extraction, API + webhook + MCP, cancellations UI in fork. **Permissions Phase A**: the Gate, policy engine, rules and field gating in Tributary, gated-details and invite-only events, invitations and approvals, viewer-aware site. Labs: the same flows on the Spaces alpha on staging |
| — | IIW #43 | Nov 3–5 | Demo: ten input methods in five minutes; a house concert imported from a private Google calendar with the address revealed only to an approved guest, shown once on our Gate and once on real Spaces; account migration live on stage; lexicon and Spaces conversations |
| M4 | Depth | Nov 9–Dec 4 | Group calendars with roles and private calendar feeds, organization roles, claim flow, Eventbrite, CSV/XLSX/Sheets, Google OAuth (verification permitting), Microsoft Graph, Telegram bot, cross-source duplicate grouping, vouching, Listed tier and curator tools (after counsel), Localist/Mobilize/Tockify/LibCal/CivicPlus connectors |
| M5 | Second region and upstreaming | Dec | A second handle domain and region page with a partner steward; upstream PRs merged or rebased; Lexicon Community proposal filed; connector SDK documented for outside contributors |
| Phase B | Real Spaces | when the six conditions in architecture 9.6 hold; not before 2027 on current signals | Gate storage migrated to Spaces on the Directory PDS; indexer-as-member live; permissioned events portable to other apps |

## 2. M0 spikes (each under a day, all before building on the assumption)

| # | Question | Method | Blocks |
|---|---|---|---|
| S1 | Does a Google public calendar read with an API key support `syncToken` and `showDeleted`? What does a `cid=` link decode to? | Live test against the Spirit of the Front Range calendar | `gcal-public` design |
| S2 | Do Luma event pages expose `cover_url` in embedded page data, and Meetup pages an `image` in JSON-LD? Image recovery rate across 50 real Boulder events | Fetch 50 pages through `ssrf-fetch`; measure | F7, I2 |
| S3 | Does stock atmo.rsvp render a record written by us, from a custodial account on our PDS, including the image through `cdn.bsky.app`? | Write three records from a staging PDS; view on atmo.rsvp | Record profile, imgproxy urgency |
| S4 | Relay limits in production: ask in the PDS Admins Discord and check `getHostStatus` for Techne's PDS | One message, one API call | Door B scale, PDS choice |
| S5 | App-password flow: create account → create app password → discard main password → password reset by email → revoke | Script against the local PDS | Identity design (8.2) |
| S6 | Granular OAuth scopes accepted by bsky.social hosts and by our own PDS version; behavior on refusal | Staging OAuth client | Door A |
| S7 | Multi-domain handles plus on-demand TLS on a second domain | Add a throwaway domain to staging | Regions |
| S8 | `ical.js` + `ical-expander` against the ugliest feeds we have (Google with exceptions, Outlook, a WordPress feed with `X-ALT-DESC`) | Build the first ten golden fixtures | F5 |
| S9 | Fork deploys to our Cloudflare account unmodified; upstream's backfill completes; note every hardcoded `atmo` string | Deploy to staging | M2 |
| S11 | Is a blob referenced only from a space record also fetchable through public `com.atproto.sync.getBlob`? Re-run the R1 lab on this week's alpha tag with a `calendar.event` carrying `media` | Lab script | Whether private images can ever live on a PDS |
| S12 | Indexer-as-member across PDSes: a separate account added as a read member obtains a credential and reads another PDS's member repo (the path R1 did not run) | `dev-env` multi-PDS | Phase B read design, labs demo |
| S13 | `managingAppPolicy` end to end with the Gate answering `checkUserAccess` for read and write from policy predicates | Lab + Gate stub | Policy bridge |
| S14 | Which privacy signals sources really expose: `CLASS` in Google/Outlook/iCloud ICS, Google API `visibility`, whether Luma private or unlisted events and Meetup members-only events appear in their feeds at all | Fixture capture | Classify stage, F24 |
| S10 | Google OAuth verification: confirm the scope class in Cloud Console and **file the verification request now**, since review takes weeks | Console + form | A1 in M4 |

Also in M0: message flo-bit (section 6), post to the Lexicon Community forum ahead of the **October 1** TSC meeting, register `boulder.directory` after checking renewal and premium pricing, and ask Lucian the three questions in section 7.

## 3. Workstreams

| # | Workstream | Contents | Depends on |
|---|---|---|---|
| A | Shared foundations | Lift identity, OAuth, credentials, jobs from Free School into packages; `ssrf-fetch`; compose; CI | — |
| B | Event model and publisher | `NormalizedEvent`, record builder, local lexicon validation, blob pipeline, CAS writes, profile versioning | A |
| C | Connector runtime | Interface, scheduler, politeness, conditional GET, sync log | A |
| D | ICS family | `ics`, `gcal-public`, `luma`, `meetup`, golden corpus | B, C, S1, S8 |
| E | Web family | `jsonld-page`, `tribe`, `squarespace`, page enrichment, image recovery | B, C, S2 |
| F | Reconcile engine | State machine, grace periods, UID-churn and window guards, overrides | B |
| G | Detector and one-box console | `packages/detect`, preview with the fork's card component, publish flow, dashboard | D, E |
| H | Identity | Door B with app passwords, handle rules and reservations, takeover, exit, relay monitor; Door A in M3 | A, S4–S7 |
| I | Fork | Reskin, namespace, imgproxy, region config and routes, source and provenance badges, cancelled state, entry point to Tributary | S3, S9 |
| J | Push and extraction | Email worker, extraction service and evals, confirmation queue, file/CSV/Sheets | B, F |
| K | Builder surface | API, webhook, MCP, docs | B, F |
| L | Account connectors | Eventbrite, Google OAuth, Graph, Discord | C, H |
| M | Trust | Claim flow, provenance levels, vouching, moderation queue, Listed tier, removal | H, I |
| P | Permissions | `spaces-shim` and policy lifted from Free School; `apps/gate`; classify stage, rules, field gating, narrowing in reconcile; invites and approvals; fork: remove `ats://` spaces, Gate client, viewer-aware composition, teaser and reveal, public-surface hygiene, leak check; labs backend and nightly run | B, F, H, I, S11–S14 |
| N | Ops and legal | Deploy, backups, monitoring, terms, privacy, DMCA agent, publishing notice, counsel review | — |
| O | Ecosystem | atmo upstream PRs, Lexicon Community proposal, ATGeo contact, Dandelion and Actualize ingest conversations | I |

## 4. Schedule by week

**Week 0 (Sep 21–27): M0.** Spikes S1–S10. Workstream A. Capture fixtures from the 12–13 existing calendars. Decisions from Benjamin: names, domain, PDS choice (section 7).

**Week 1 (Sep 28–Oct 4).** B, C, F in full. D: `ics` and `gcal-public` passing the golden corpus. H: Door B working against the local PDS. First real records on staging; verify on atmo.rsvp. `visibility` on `NormalizedEvent` and the ledger from the start; classify stage with source signals, Held, Unlisted and conference-link gating (P, first slice).

**Week 2 (Oct 5–11).** D: `luma`, `meetup`. E: enrichment, `jsonld-page`, `tribe`, `squarespace`. G: detector with fixtures, one-box, preview, publish, `.ics` upload, manual form. I: reskin and imgproxy on staging; strip the contrail spaces wiring and unpin contrail. M1 exit review on Friday.

**Week 3 (Oct 12–18).** I: region routes, badges, time-first home, regional `webcal`. G: dashboard and host notices. N: production deploy, backups, monitor, terms and notice. Invite the first fifteen hosts personally; sit with at least five while they paste. M2 exit review.

**COhere.** Freeze. One person watches the sync log.

**Week 4 (Oct 19–25).** H: Door A. J: email-in, extraction with evals. P: Gate, policy engine, rules and field gating, gated-details events end to end. I: cancelled state, all locations, upstream PRs opened.

**Week 5 (Oct 26–Nov 1).** K: API, webhook, MCP with `visibility`. P: invite-only events, invitations and approvals, viewer-aware site, public-surface hygiene and leak check, labs run green on staging. IIW demo script rehearsed twice. If the fortnight runs short, the cut order is MCP, then unstructured-page extraction, then invite-only; gated details stays.

**November.** M4 in priority order: group calendars with roles (with Free School, which needs the same thing), claim flow, duplicate grouping (it becomes visible the moment Meetup and Luma both carry the same event), Telegram, Google OAuth when verification lands, vouching, Listed tier after counsel, long-tail connectors driven by which Boulder calendars are still unconnected.

**December.** M5.

## 5. Definition of done

| Milestone | Done when |
|---|---|
| M0 | S1–S10 written up in the repo; architecture **(verify)** marks removed or the design changed; CI green on scaffold |
| M1 | F1, F2, F3, F5, F6, F7, F8, F9 pass, and F24 for the Public, Unlisted and Held levels; smoke test runs in CI; a stranger connects a Google calendar in under 90 seconds on a phone |
| M2 | F17, F19, F20, F21, F22 pass; 15 hosts live; restore drill done; terms, privacy and DMCA agent in place; relay status green; `getHostStatus` monitor alerting |
| M3 | F4, F10, F11, F13, F16, F23, F25, F26, F27, F30 pass, and F24 in full; migration demonstrated between two PDSes; extraction evals at or above 90% field accuracy with zero unconfirmed publishes |
| M4 | F12, F14, F15, F18, F28, F29 pass; counsel sign-off recorded; Google verification approved or A1 explicitly deferred |
| M5 | Second region live with a named steward; at least three upstream PRs merged; proposal filed; one outside contributor's connector merged |

## 6. Working with upstream and the ecosystem

**flo-bit (atmo.rsvp).** Write before forking, this week. The message: we are building an open importer whose records follow atmo's conventions exactly; we want to run a regional skin of atmo rather than another app; we will send namespace configurability (their #26), region filtering, cancelled state, multiple locations (#45), `rsvpExpected` (#44) and an image-URL config upstream; and their Luma import bug (#77) goes away if their importer calls our API. Ask what they would rather we not fork. Tell them plainly that we will remove the contrail-based private events from our fork, since contrail dropped that module, and that the Gate client will be offered back as an optional backend when they are ready for permissioned events again. MIT permits all of this; the point is to arrive as contributors.

**Lexicon Community.** Forum post before October 1, leading with the two apps that need it: optional `media`, `timezone` and an external-source object on the event record, with live records as evidence that the conventions already exist in the wild.

**Bluesky's Spaces team.** Share the events use case while the alpha is still moving: public teaser plus gated detail, invite primitives, blobs referenced from space records, an indexer as an explicit member, and what happens to a space when its authority migrates. These are all gaps we hit on paper; they are cheaper to raise now than after general availability.

**ATGeo.** Introduce the venue table and the Boulder use case to Nick Gerakines and Boris Mann; ask what shape of place reference we should leave room for.

**Stephen Reid and Juicy Life.** Dandelion already publishes; confirm our fork displays its records well (inline markdown images need handling). Actualize's OAuth2 API is a candidate connector built with Juicy, which answers his "shared data model first" condition with something concrete.

**COhere (Aaron Gabriel).** Their calendar is the first agreed source and the launch content. Agree the tag that routes events into the COhere view.

**Techne team.** Leah: this is Beacon's events-ingest feature delivered as a service; confirm Beacon reads `additionalData.externalSource`. Julia and Ash: host outreach list and the brand for `boulder.directory`. Mathilda: steward role, terms, counsel.

## 7. Decisions needed

From Benjamin:

1. Names and domain: is `boulder.directory` the public brand; does the adapter carry its own name.
2. PDS: add the handle domain to Techne's PDS, or stand up a dedicated Directory PDS on the Tributary box. Recommendation: dedicated, because stewardship handover to a Boulder organization is then a clean transfer, and its relay account budget is separate.
3. COhere scope: Hosted only, plus COhere's calendar by agreement. Listed tier waits for counsel. Recommended.
4. License: AGPL-3.0 for the services, MIT for the connector SDK and `event-model`.
5. Who the first fifteen hosts are, and who asks them.
6. Whether Free School or this suite gets priority if the two collide in week 3.
7. One shared Gate for Free School and the Directory (recommended), and which pilot groups get member calendars first.
8. Confirm the phasing: permissioned events run on our Gate until the Phase B conditions hold, with real Spaces in labs and demos only.

From Lucian:

1. In-record `additionalData.externalSource` instead of a `coop.lexicon.event.*` sidecar: acceptable for Beacon's reader?
2. Namespace for listing and attestation records.
3. Appetite and timing for a Rust publisher inside the platform, so we keep `packages/publisher` shaped for it.
4. Space types and policies: confirm reuse of `coop.lexicon.space.event.invite` and `.event.detail`, name the group-calendar space type, and confirm the predicate set the Gate must evaluate.
5. Whether the RegenOS AppView's write-path policy check and the Gate should be one implementation. Two policy engines for one policy language is a bug waiting to happen.

## 8. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Two COhere builds compete for one builder | High | Shared packages first; M2 scope is minimal; decision 6 made in advance |
| Relay account cap lower than the code default | Medium | S4 in week 0; promote Door A; request a raise early; dedicated PDS so the budget is ours |
| Image recovery below target because platforms hide page data | Medium | S2 measures it before we promise it; host logo fallback makes cards acceptable anyway |
| Platforms start blocking the fetcher | Medium | Feeds are published interfaces; polite, identified, conditional requests; push methods as the fallback; never work around a block |
| ICS edge cases produce wrong times | Medium | Golden corpus before connectors; timezone shown in preview; canary hosts |
| atmo upstream moves fast and the fork rots | Medium | Small rebased patch series; contract test on every merge; upstream first |
| Hosts do not come | Medium | This is the real risk (research constraint 4). Personal onboarding of the first fifteen; COhere table; curators seed by invitation; budget for a paid coordinator in the Techne pilot plan |
| Google verification delay | High | File in week 0; public calendars never need it, which covers most hosts |
| A private event leaks to a public surface | Low, but the costliest failure we have | Private signals checked before first publish; narrowing enforced in reconcile; permissioned data never enters public stores; nightly leak check; Phase A keeps it off the network entirely |
| Spaces alpha slips or changes shape | High | Nothing users touch depends on it before Phase B; raw-XRPC lab script; nightly drift report; six explicit gate conditions |
| Hosts read "private" as "secret" | Medium | Plain-terms notice at the point of choice (PRD 8.4); never use the words encrypted, secret or anonymous |
| Permissions work crowds out input breadth before IIW | High | Eventbrite, CSV/XLSX/Sheets and claim flow already moved to M4; stated cut order in week 5 |
| Two policy engines drift (RegenOS AppView and the Gate) | Medium | Lucian decision 5; shared predicate test vectors either way |
| Legal exposure of the Listed tier | Medium | Not in COhere scope; counsel first; facts and links only |
| Impersonation through custodial handles | Low–Medium | Handle reservations, provenance badges, claim required for "verified," steward review of large first publishes |
| Age-assurance or hosting law changes | Low now | Invited hosts only until reviewed; organizations rather than individuals as the first cohort |

## 9. Budget of effort

Rough build days at the current pace with agentic coding, one builder: M0 6, M1 10, M2 7, M3 14, M4 16, M5 8, and about 6 for the Phase B migration when its conditions hold. M3 is more than its ten working days at that estimate, which is why it carries a cut order; the lift from Free School's `spaces-shim` is what makes it plausible at all. Infrastructure under $50 a month through the pilot. The cost that matters is people time for host onboarding: plan on 30–45 minutes per host for the first fifteen, falling to zero as the one-box flow proves itself.

## 10. First six actions

1. Send the note to flo-bit and the Lexicon Community forum post.
2. Run S3 and S4, because they decide the record profile and the PDS question.
3. File the Google OAuth verification request.
4. Lift the Free School identity and jobs code into shared packages and scaffold the monorepo.
5. Capture golden fixtures from the 12–13 calendars already in the Hetzner scraper, including any private or members-only events they contain (S14).
6. Re-run the R1 lab on this week's alpha tag with an event record and a referenced image (S11), and send Lucian the five questions.
