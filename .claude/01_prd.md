*Benjamin Life (@omniharmonic) · 2026-09-20 · status: draft v0.2 (adds visibility and permissions)*

# Events Suite — Product Requirements Document

*Companion documents: `02_technical-architecture.md`, `03_implementation-plan.md`. Grounded in the 2026-09-20 research brief and a second deep-dive pass (atmo-events code teardown, reference PDS and relay source, connector mechanics, importer prior art). Working names are placeholders: **Tributary** for the adapter, **the Directory** for the regional identity layer and discovery site.*

## 1. What we are building and why

Communities already publish thousands of events. They publish them in Google Calendar, Luma, Meetup, Eventbrite, a WordPress plugin, a flyer on Instagram. Every one of those is a silo, and every attempt to build a shared community calendar has failed the same way: it asked hosts to change tools. Jon Udell ran that experiment for fifteen years and said so plainly.

The suite has four parts and one rule. The rule is that a host never changes tools.

1. **Tributary, the adapter.** A host points it at whatever they already use, once. From then on their events appear on AT Protocol as well-formed records in a repo that belongs to them, kept in sync, with a cover image, a timezone and a link back to the source. It accepts more kinds of input than anything that exists: a feed, a page, an account, a file, an email, a photo of a flyer, a sentence, a chat message, an API call.
2. **The Directory identity layer.** A community-run PDS that gives any host a real atproto identity under a regional name (`dairyarts.boulder.directory`) in under a minute, with no protocol vocabulary, and lets them walk away with it whenever they like. Hosts who already have an atproto identity use that instead.
3. **The Directory discovery site.** A fork of atmo.rsvp, reskinned and regionalized. atmo already indexes every event on the network and renders them well; we add region pages, provenance badges and source attribution, and send everything general back upstream.
4. **The Gate, the permission layer.** Hosts decide who can see each event: everyone, anyone with the link, a group's members, invited people, or everyone for the outline and confirmed guests for the address. The controls sit in the adapter, where events come in, and in the discovery site, where they are seen. It is built to the shape of atproto Spaces and Techne's space policies, so permissioned events become portable protocol data when Spaces is ready, not rows trapped in one app.

Nobody has built part 1, and nobody has part 4 in a form that leaves the app that made it (section 8). Those two are the differentiators and that is where the effort goes. The measure of success is how many real community events reach the network with no ongoing work from the host.

This is also Beacon's events-ingest feature. Anything Tributary publishes is a standard `community.lexicon.calendar.event` record, so Beacon, atmo, Dandelion's future ingest, Free School and any other reader get the supply for free.

## 2. Goals, non-goals, measures

**Goals**

- A host goes from "here is my calendar link" to "my events are live on the network" in under sixty seconds, without creating a password or hearing the word "protocol."
- Every published event renders as a complete card in atmo.rsvp and in our fork: image, local time, place, host, source link.
- Events stay correct: edits, cancellations and new events at the source appear without the host doing anything.
- Every consenting host owns their records under their own DID from the first event, and can leave with them.
- Cover the input methods that reach at least 90% of Boulder's existing public event supply without any scraping behind a login.

**Non-goals (v1)**

- Two-way sync. The source stays the source of truth. We never write back to Luma or Google.
- Ticketing, payments, or RSVP management for imported events. We link out. (Design constraint 6: no live money rails.)
- Importing attendee lists, guest counts tied to people, or anything that names a person who did not publish it.
- A new general-purpose events app. atmo is that. We fork for skin and region only.
- Secrecy. Permissioned events are access-controlled, not encrypted (section 8.4).
- Group governance. Charters, vouching and role ladders belong to Free School and the Techne group primitive. The suite reads membership; it does not define it.

**Measures**

| Measure | Target by COhere (mid-Oct) | Target by IIW (Nov 3) |
|---|---|---|
| Hosts connected | 15 | 60 |
| Future events live from Tributary | 300 | 1,500 |
| Events rendering as a complete card (image + tz + place) | 80% | 90% |
| Median time, first paste to first publish | under 90 s | under 60 s |
| Hosts publishing under their own DID | all (Listed tier not yet open) | all |
| Hosts who have exercised ownership (set a password, or signed in with an existing account) | 20% | 35% |
| Sync correctness on the conformance corpus | 100% of golden cases | same |
| Host-reported wrong-event incidents | under 1 per 500 events | same |
| Private source content published publicly by mistake | zero | zero |
| Permissioned events found on any public surface (search, feeds, share images, public calendar feeds, firehose) | not yet offered | zero, checked nightly |
| Hosts using a permissioned level | — | 10 |

## 3. Who it is for

**The organization with a calendar.** A venue, nonprofit, co-op, library branch or city department that already maintains events somewhere. Wants reach, has no time. Success is "I pasted a link in September and have not thought about it since."

**The person hosting one thing.** A potluck, a repair café, a talk. Has a flyer or a Partiful link. Success is "I forwarded the invite and it showed up."

**The curator.** A steward who knows the local landscape (Benjamin today; COhere organizers; a Spirit of the Front Range volunteer). Adds public calendars the hosts have not connected yet, fixes categories, vouches for hosts. Success is "I can fill a regional calendar in an afternoon and every listing is honest about where it came from."

**The attendee.** Opens `boulder.directory`, sees what is happening this week near them, subscribes to a calendar feed, clicks through to the source to RSVP. Never needs an account.

**The builder or agent.** Another app, a WordPress site, a Zapier flow, an AI agent. Wants one documented way to push events in. Success is an API key, a webhook, an MCP tool.

**The partner platform.** Dandelion, Actualize, OpenMeet. Wants their events treated as first-class with attribution, and no duplicates when the same event arrives twice.

## 4. Principles

These carry the project's standing design constraints into product rules.

1. **Never ask a host to change tools.** Every input method meets them where they are.
2. **The source is the truth.** One-way mirror, stated in the interface. Edit at the source.
3. **Your events, your repo.** A consenting host's records live under their own DID from day one. No shared service account for hosted events.
4. **Consent sets fidelity.** Host-connected sources are mirrored in full. Anything a curator adds without the host is facts and a link only, visibly unclaimed, removed on request.
5. **No record names someone who did not write it.** No attendee data. No host DID on a record the host did not authorize.
6. **Always link back.** Every event carries its source URL and says where it came from. RSVP happens at the source.
7. **Publishing is public and permanent, and we say so** before the first publish, in one plain sentence.
8. **Confirm anything we inferred.** Anything extracted by a model (flyers, free text, unstructured pages) is shown for confirmation before it is published. Structured sources publish automatically.
9. **Easy in, easy out.** Password reset by email gives full control. Migration to another PDS keeps the DID and every link. We document it and test it.
10. **Build with the ecosystem.** Records are atmo-compatible by construction. General improvements go upstream. Lexicon gaps go to the Lexicon Community.
11. **Visibility narrows by itself and widens only by hand.** A private signal at the source is always honored. Nothing becomes more visible without a person choosing it.
12. **Access control, not secrecy, and we say so.** We describe permissioned events in the protocol's honest terms at the moment a host chooses a level.
13. **One audience, one space.** Read access is granted to a whole space, so every distinct audience gets its own.

## 5. The one-box experience

The front door is a single input that accepts anything.

> **Add your events.** Paste a link, drop a file, or describe an event.

Behind it, a detector works out what it was given and picks the best available method without asking the host to choose:

| Host gives us | We detect | What happens |
|---|---|---|
| `calendar.google.com/...`, an embed code, a `cid=` link, a `.ics` URL | Google public calendar | Subscribe to the feed; live sync |
| `lu.ma/...` or `luma.com/...` calendar or event | Luma | Find the calendar's ICS feed; enrich each event from its page for the cover image |
| `meetup.com/<group>` | Meetup group | Subscribe to `/events/ical/`; enrich from event pages |
| `eventbrite.com/o/...` or an event URL | Eventbrite | Read JSON-LD now; offer "connect Eventbrite" for live sync |
| Any website | Platform fingerprint | WordPress Events Calendar → its REST API; Squarespace → `?format=json`; Localist, Tockify, LibCal, CivicPlus, Trumba → their feeds; otherwise `<link rel="alternate" type="text/calendar">`, then JSON-LD |
| A page with one event and no structure | Unstructured page | Model extraction, then confirm |
| A `.ics`, `.csv` or `.xlsx` file | File | Parse, map columns if needed, preview |
| An image or PDF | Flyer | Vision extraction, then confirm |
| A sentence ("Repair café, first Saturdays 10–1 at the library") | Free text | Extraction including recurrence, then confirm |

The next screen is always the same: **a preview of real cards**, exactly as they will appear, with a count ("We found 23 upcoming events"), a note on anything missing ("4 have no image; we will use your logo"), a visibility choice that defaults to Public (or to Held when the source itself is private), and one button: **Publish**. Identity is asked for only at that moment, and the default takes one field (email).

## 6. Input methods

Priority: **P0** ships for COhere (milestones M1–M2), **P1** for IIW (M3), **P2** after (M4 onward). Fidelity is what the method can carry. "Live" means changes at the source appear without the host acting.

### 6.1 Feeds and pages (no account needed at the source)

| # | Method | Reaches | Live | Fidelity | Priority |
|---|---|---|---|---|---|
| I1 | ICS / webcal URL | Google, Luma, Meetup, Outlook, iCloud, Tockify, Teamup, Trumba, LibCal, CivicPlus, Localist, WordPress | Yes, polled | Structure, recurrence, tz, location, updates. Images only where the feed has `ATTACH`/vendor fields | P0 |
| I2 | Page enrichment | Every event with a URL | With I1 | Cover image, organizer, price, venue from JSON-LD, `og:image`, Luma page data | P0 |
| I3 | Platform fingerprint connectors | WordPress Events Calendar REST, Squarespace JSON, Localist API, Mobilize public API | Yes, polled | Full, including images | P0 (WP, Squarespace), P2 (rest, ordered by which Boulder calendars remain unconnected) |
| I4 | Single event page | Eventbrite, Humanitix, Ticket Tailor, Dandelion, any JSON-LD page | Re-checked daily until the event ends | Full card | P0 |
| I5 | Unstructured page | Venue sites with a hand-built events page | Re-checked; host confirms changes | Extracted; confirm first | P1 |

### 6.2 Connected accounts (host authorizes; best fidelity, real-time)

| # | Method | Notes | Priority |
|---|---|---|---|
| A1 | Google Calendar (OAuth) | Private or unshared calendars; push notifications. Needs Google app verification (sensitive scope: privacy policy, domain, demo video). Public calendars never need this | P2, gated on Google's review; request filed in week 0 |
| A2 | Eventbrite | Free organizer token; logo image; webhooks. Single Eventbrite pages already work through I4 | P2 |
| A3 | Microsoft 365 / Outlook | Graph delta + 7-day webhooks | P2 |
| A4 | Luma API | Only for hosts already paying for Luma Plus; adds webhooks | P2 |
| A5 | Discord server events | Bot; pattern proven by discal.dev | P2 |
| A6 | Humanitix, Ticket Tailor, Tito, Action Network, Teamup | API-key connectors, built on demand | P2 |

### 6.3 Push to us (for platforms with no way out, and for one-off events)

| # | Method | What the host does | Priority |
|---|---|---|---|
| P1 | Forward an email | Forward any invite or newsletter to their personal address (`add+<token>@in.boulder.directory`). `.ics` attachments publish directly, including updates and cancellations; otherwise we extract and ask for confirmation by reply link | P1 |
| P2 | Flyer, screenshot or PDF | Drop it in the box or send it to the bot. Confirm the extracted card | P1 |
| P3 | Type or paste text | One sentence or a pasted announcement. Confirm | P1 |
| P4 | Manual form | The plain fallback; also the editor for fixing extracted events | P0 |
| P5 | File upload | `.ics`, CSV, XLSX with a column mapper | P0 (`.ics`), P2 (CSV/XLSX) |
| P6 | Google Sheet | Publish-to-web CSV, polled. A template sheet for groups that plan in spreadsheets | P2 |
| P7 | Telegram bot | Forward a message or photo; reply to confirm | P2 |
| P8 | Bookmarklet, then browser extension | "Send this page to my directory" | P2 |
| P9 | Discord and Signal | Discord bot P2; Signal only if a partner needs it | P2 |

### 6.4 For builders and agents

| # | Method | Priority |
|---|---|---|
| B1 | REST API with per-host API keys (`POST /v1/events`, idempotent by `externalId`) | P1 |
| B2 | Inbound webhook, which makes Zapier, Make, n8n and IFTTT work with no custom integration | P1 |
| B3 | MCP server (`publish_event`, `list_my_events`, `add_source`) so any agent can publish for its owner | P1 |
| B4 | WordPress plugin and an embeddable "submit an event" widget for curators' sites | P2 |

### 6.5 What we will not do

Log in to a platform as a user to scrape it. Import from Facebook or Partiful by scraping; hosts on those platforms use email forward, flyer, or text. Import attendee or guest data from anywhere.

## 7. Identity: three doors, one model

Asked at the moment of first publish, in this order of prominence.

**Door B (default): "Publish as…"** Email, display name, pick a handle. We create a real atproto account on the Directory PDS (`yourname.boulder.directory`). The host gets a confirmation email with a link to set a password whenever they want to. They can use that identity in atmo, Bluesky, or any atproto app. Records are theirs.

**Door A: "I already have an account."** Sign in with any atproto handle. We ask for permission to write calendar events and upload images, nothing else. Records go to their existing repo on whatever PDS they use, and sync continues in the background.

**Door C: "Just list it."** No identity. Reserved for curators adding public calendars, and for a host who declines an account. Events publish as **Listed**: facts and a link back, under the curator's name, marked "unclaimed," with a "Is this yours? Claim it" link on every card.

**Provenance ladder**, shown as a badge on the host and their events:

| Level | How it is earned |
|---|---|
| Verified domain | The host's handle is a domain they control (`@dairyarts.org`) |
| Verified source | The host proved control of the source by placing a token in the calendar's description or on their site (the podcast-directory pattern), or the claim email went to the organizer address found in the feed |
| Email verified | Confirmed the account email |
| Listed | Added by a named curator; unclaimed |

A curator or the regional steward can also **vouch** for a host, recorded as a signed attestation. Regional default views show verified, vouched and curator-listed events; the unfiltered network view is one click away.

**Claiming.** When a host claims a listed source, their events are re-published in full under their own DID and the curator's listings are removed. Subscribers and search see one continuous event because identity is tracked by source, not only by record address.

**Leaving.** Settings has two buttons that always work: "Set a password and take full control" and "Move my account to another server." A third, "Delete everything," removes records and the account.

## 8. Visibility and permissions

This is the part of the suite nothing else on the network has. atmo.rsvp carries private-event code, but it is an app-level store in atmo's own database with its own `ats://` addresses, switched off in production, and built on a contrail module that contrail's maintainers deleted in version 0.13. Private events made there exist only on that server. We build permissions on the protocol's own model, atproto Spaces, governed by Techne's declarative space policies, and we put the controls in both places a host needs them: on the way in (the adapter) and on the way out (the discovery site).

### 8.1 Five visibility levels

Every source has a default level, every event can override it, and rules can set it automatically.

| Level | Who can see it | Where the record lives | Typical use |
|---|---|---|---|
| **Public** | Everyone, on every app | The host's public repo; on the firehose | Most community events |
| **Unlisted** | Anyone with the link. Hidden from discovery, search and feeds | The host's public repo, flagged `showInDiscovery: false` | Soft launches, events shared by link. The interface says plainly that this is still public data |
| **Public with gated details** | Everyone sees the event with a coarse location; approved or invited people see the exact address, door code, video link and attendee notes | Public teaser record, plus a detail record in the event's detail space | House concerts, potlucks, home-based classes, anything with a Zoom link |
| **Members** | Members of a group at or above a chosen role | The group's space | Co-op meetings, member workdays, steward calls |
| **Invite-only** | People the host invited, by handle, email or join link, and anyone the host approves | The event's invite space. No public record exists at all | Private gatherings |

A sixth state, **Held**, keeps an imported event inside Tributary and publishes nothing. It is where anything ambiguous lands.

One space serves one audience. The protocol grants read access to a whole space at a time, never to part of one, so the detail space and the invite space for the same event are separate, and a group's member calendar is separate from its steward calendar.

### 8.2 Controls in the adapter

- **Per-source default**, chosen in the preview step: "Publish these as: Public / Unlisted / Members of… / Held for review."
- **Source signals are honored automatically.** An ICS event marked `CLASS:PRIVATE` or `CONFIDENTIAL`, a Google event with `visibility: private`, a Meetup event from a members-only group, a Luma event marked private: none of these can become public without the host explicitly saying so for that source. They go to Held, or to the space the host has mapped that source to.
- **Rules**, per source, in plain language: "Events with [Members] in the title → Members of Front Range Seed Library." "Events in the calendar 'Board' → Invite-only, invite the Board list." "Events at a home address → Public with gated details." Rules match on title, calendar, category, location type and source flags.
- **Field gating.** For any public event the host chooses which fields are gated: exact address, video link, phone numbers, attendee notes. Video-conference links are detected in descriptions and locations and gated by default, because a public Zoom link is an invitation to strangers.
- **Visibility only narrows on its own.** If a source event changes from public to private, we withdraw the public record at once and tell the host that copies made by others cannot be recalled. Nothing ever becomes more visible without a person choosing it.
- **Connected private calendars** (Google or Microsoft by OAuth) default to Held. The host maps each calendar to a level before anything publishes.
- **Who may manage.** An organization's Tributary account has people with roles (owner, editor, viewer). atproto has no delegation yet, so this is app-side, recorded as membership claims so it can move into the protocol later.
- **Builders and agents** set `visibility` and `audience` through the API, webhook and MCP tools, under the same narrowing rule.

### 8.3 Controls in the discovery site

- **Viewer-aware everywhere.** Signed-out visitors and non-members see only public events. Signed-in members see their groups' and invitations' events merged into the same calendar, marked with a small lock and the audience name.
- **Teaser and reveal.** A gated event shows its public card with "Exact location shared with confirmed guests." Requesting a place sends the host an approval request; approval reveals the details to that person only.
- **Invitations.** Join links with expiry and use limits; invitations by handle or email; a person without an atproto account is walked through getting one in the same flow.
- **No enumeration.** An event you cannot see and an event that does not exist look identical.
- **RSVPs for permissioned events stay inside the space.** They are never public records.
- **Private calendar feeds.** Each signed-in person gets a personal `webcal` address that includes what they are entitled to see, revocable at any time.
- **Nothing private leaks sideways.** Permissioned events are absent from public search, region feeds, share-card images and public calendar feeds. Their images are served only through short-lived signed links.
- **Group calendars.** A group page shows its public events to everyone and its member events to members, and is the natural home for Free School's group primitive.

### 8.4 What we promise, and what we do not

Spaces give access control, not secrecy. The group that owns a space can always read it, the servers that host members' accounts can read what those members wrote, and removing someone takes up to two hours to take full effect. We say this in the interface where a host chooses a level. We never describe a permissioned event as encrypted, secret or anonymous.

### 8.5 How this ships, given that Spaces is still an alpha

Bluesky's Spaces alpha went live on 2026-08-20 with explicit warnings: no security review, breaking changes weekly, general availability "later this year." Benjamin's own lab work on it (R1) reached the right conclusion for Free School and it holds here: design to its shape now, run real people's data on it later.

- **Phase A (for IIW).** All five levels work. Public and Unlisted are ordinary records. The three permissioned levels are served by a small service we run (the **Gate**) that has exactly the Spaces shape, addresses, membership, per-author records, policies, but stores the records in our database, not yet on a PDS. It is the same seam Free School already uses.
- **Labs.** In parallel, a staging PDS runs the alpha build, and the same flows run end to end on real Spaces for demos and for a nightly compatibility test.
- **Phase B.** When the gate conditions in the implementation plan are met, the Gate's storage switches to real Spaces on the Directory PDS and existing permissioned events are migrated. Hosts and attendees see no change, except that their permissioned events become portable to any other app that speaks Spaces.

## 9. Functional requirements

Each has an acceptance test referenced by the implementation plan.

| # | Requirement | Acceptance |
|---|---|---|
| F1 | One-box detection | For each of 40 fixture inputs (URLs, embeds, files, text), the detector picks the expected method and source type |
| F2 | Preview before publish | Preview shows the same card component the discovery site renders; counts and missing-field notes are correct for fixtures |
| F3 | Custodial signup | Email + name + handle creates an account on the PDS, publishes the first batch, sends the confirmation email; no password entered; under 60 s |
| F4 | BYO sign-in | OAuth with granular scopes only; background sync still writing after 48 h and after a token refresh cycle with two workers running |
| F5 | ICS sync correctness | Golden corpus passes: recurrence with exceptions, floating and all-day times, per-event TZID, `X-WR-TIMEZONE`, changed UID, rolling window, HTML descriptions, `SEQUENCE` updates |
| F6 | Card completeness | Every published record validates against the base lexicon, carries `timezone` and source attribution, and renders fully in stock atmo.rsvp and in the fork |
| F7 | Image recovery | Cover image recovered for at least 85% of Luma, Meetup and Eventbrite fixtures; host logo used as fallback; images re-encoded, under 1 MB, EXIF stripped |
| F8 | Updates and cancellations | A source edit appears within one poll interval; a cancelled or vanished event becomes "cancelled" and is removed only after the grace period; a single failed fetch changes nothing |
| F9 | No duplicate writes | Re-running a sync with no source change produces zero repo writes |
| F10 | Extraction with confirmation | Flyer, text and unstructured-page inputs never publish without an explicit confirm; year, timezone and recurrence are shown as editable guesses |
| F11 | Email in | Forwarded `.ics` invite publishes; forwarded update changes it; forwarded cancellation cancels it; mail from an unrecognized sender to a host's address is held, not published |
| F12 | Claim | Token-in-source and organizer-email claims both succeed on fixtures; claimed events move to the host's repo; the public card URL for the listed event redirects |
| F13 | Takeover and exit | Password reset gives full control and revokes our access on request; a test account migrates to a second PDS with DID and event URLs intact |
| F14 | Listed tier limits | Listed records contain only name, times, place, mode, source link and attribution; no description body beyond a short excerpt, no image unless the source license allows |
| F15 | Removal | A removal request for a listed source deletes its records and blocks re-adding within one business day; self-serve for anyone who can prove control of the source |
| F16 | API, webhook, MCP | Idempotent create/update/delete by `externalId`; keys scoped to one host; MCP tools pass a scripted agent session |
| F17 | Regional discovery | `boulder.directory` defaults to the region, offers this-week / weekend / category views, per-region and per-host calendar subscriptions, and shows "via Luma"-style source badges and provenance badges |
| F18 | Cross-source duplicates | The same event arriving from two sources shows as one card with "also on" links; the primary source wins |
| F19 | Moderation | Report link on every card; steward queue; takedown removes from the regional index immediately and, for custodial accounts, can take down the record |
| F20 | Privacy audit | Automated check: no published record contains an attendee, an email address, a phone number, or a private-residence street address flagged by the host |
| F21 | Host dashboard | Sources with last-sync status and next run, event list with per-event override (hide, fix category, replace image), plain-language error states ("Your calendar is no longer public") |
| F22 | Notifications to hosts | Email when a source breaks for more than 24 h, when an extracted event awaits confirmation, and a monthly "here is what we published for you" |
| F23 | Visibility levels | Each of the five levels and Held round-trips through Tributary, the Gate and the site for fixtures; the level is visible and editable in preview and dashboard |
| F24 | Source signals and narrowing | Fixtures carrying `CLASS:PRIVATE`, Google `visibility: private`, and conference links never produce a public record containing the private content; a public→private change at the source withdraws the public record within one poll; a private→public change never applies without confirmation |
| F25 | Field gating | For a gated event, an automated audit finds no exact address, join link or attendee notes in any public record, and an approved viewer sees them while an unapproved viewer does not |
| F26 | Invitations and approvals | Join links honor expiry and use limits; invitation by handle and by email both resolve to a DID; approval reveals details to that person only; removal takes effect in the site immediately |
| F27 | Viewer-aware site | The anonymous / non-member / member / removed-member matrix passes for every level; not-found and not-permitted responses are identical; no permissioned event appears in public search, region feeds, share images, public calendar feeds or the sitemap; permissioned images load only through expiring signed links |
| F28 | Group calendars | A group with roles shows member events to members at or above the threshold; each person's private calendar feed includes what they may see and can be revoked |
| F29 | Organization roles | Owner, editor and viewer roles govern who can change a host's sources, rules and visibility; every widening of visibility is in the audit log with the person who did it |
| F30 | Labs parity and migration | The same permission fixtures pass nightly against the Spaces alpha backend on staging, including across two PDSes; a staged migration from the Gate's store to real Spaces preserves every address |

## 10. The event card: what every published event carries

Guaranteed on every Hosted event: name; start (and end when known) as an instant plus the IANA timezone; mode; status; at least one location for in-person events, written both as a human address with venue name and as coordinates when we can geocode; description as sanitized markdown with links preserved; cover image (source image, else host logo, else a generated regional placeholder); source link labelled for RSVP; source attribution (platform, URL, "RSVP at the source" flag); the adapter's signature (`createdWith`).

Carried when available: price text or "free"; category tags from a small shared vocabulary plus the source's own tags; series key and position for recurring events; organizer name when it differs from the account.

Recurring events are published as individual occurrences, a rolling ninety days ahead, because that is what every existing reader expects.

## 11. The discovery site (fork scope)

Keep from atmo: event pages, host pages, RSVP for native events, search, near-me, follow-based feed, OG images, calendar export, embeds, themes.

Add: region as a first-class filter with landing pages (`/boulder`, later `/front-range`); time-first home (tonight, this weekend, this week); category chips; source badge and provenance badge on cards; "RSVP at the source" as the primary action for imported events; cancelled and postponed states; all locations shown; per-region and per-category `webcal` feeds; a "Add your events" entry point that opens Tributary; curator tools behind steward sign-in; and the whole of section 8.3: viewer-aware calendars, teaser and reveal, invitations and approvals, group calendars, private calendar feeds.

Change: name, logo, palette, copy, OAuth client identity, namespace; image delivery through our own proxy; atmo's dormant app-level private-event code replaced by Gate-backed permissioned events, keeping its page states and invite design.

Send upstream: region filter as configuration, cancelled state, `rsvpExpected`, multiple locations, source attribution display, namespace configurability (their issue #26).

## 12. Privacy, legal and safety requirements

Terms of service, privacy policy and a copyright policy with a registered DMCA agent before public launch. A plain-language publishing notice before first publish. Private-residence handling: a host can mark a location "share neighborhood only," which publishes a coarse area instead of the street address. Removal honored within one business day. Identifiable crawler with a contact address; conditional requests; per-domain rate limits; robots.txt respected for page fetches. No logged-in scraping. Google's user-data policy followed for A1: calendar data used only for the publish feature the host asked for. Counsel review of the Listed tier and the terms before we list anything a host did not connect. Age-assurance exposure reviewed before custodial signup opens beyond invited hosts. For permissioned events: the honest-terms notice of section 8.4 at the point of choice; invite lists, member lists and RSVPs are never public records and never appear in logs; retention for Gate data is written down and enforced by jobs (invite tokens purged at expiry, access requests after the event ends, audit kept one year); disclosure posture for legal requests reviewed by counsel before Phase A opens to anyone outside the pilot cohort.

## 13. Open questions for Benjamin and the team

1. **Names.** Tributary and "the Directory" are placeholders. Is `boulder.directory` the public brand, and does the adapter need its own name at all?
2. **Whose PDS.** Techne's existing PDS with `boulder.directory` added as a handle domain, or a dedicated Directory PDS. The architecture supports either; the second is cleaner for stewardship handover.
3. **Listed tier at launch, or Hosted only until counsel reviews?** Recommended: Hosted only for COhere, plus COhere's own calendar by agreement.
4. **Source attribution in the record** follows atmo's existing `additionalData.externalSource` convention rather than a new sidecar lexicon. Lucian should confirm, since this is a change from the research brief's recommendation and affects Beacon's reader.
5. **Steward.** Who is the named regional steward for Boulder on day one, and who holds the second set of keys.
6. **License.** AGPL-3.0 for Tributary (matches the Free School proposal) with the connector SDK under MIT so others can write connectors.
7. **Space types and policy names.** We reuse `coop.lexicon.space.event.invite`, `coop.lexicon.space.event.detail` and `coop.lexicon.event.detail`, and need a group-calendar space type. Lucian owns the names.
8. **One Gate or two.** Free School needs the same service. Recommended: one shared Gate package and, in Boulder, one shared deployment.
9. **Who is the authority for group spaces.** A custodied group DID with split rotation keys, as Free School plans for the school DID. Who holds the second key for each pilot group.
