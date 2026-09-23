# Boulder County calendar sources

Every row below was confirmed by an actual fetch on 2026-09-23. Counts are what the
endpoint returned that day, not a promise. The seed file that wires these up is
`infra/seeds/boulder.json`; `apps/tributary/scripts/seed-sources.ts` reads it.

Sources added this way are published under the directory's own curator account and
marked `claimed: false`, so their cards carry the "Listed" badge and a "Is this yours?"
path. The organisation's name is never used as a host identity until they claim it.

## Wired up

### Government

| Organisation | Kind | Endpoint | Seen |
|---|---|---|---|
| Boulder County | tribe | `bouldercounty.gov/events/` | 262 |
| City of Longmont | tribe | `longmontcolorado.gov/events/` | 932 |
| Town of Erie | ics | CivicPlus `iCalendar.aspx?catID=14` | 108 |
| City of Lafayette | ics | CivicPlus `iCalendar.aspx?catID=14` | 46 |
| Town of Nederland | ics | CivicPlus `iCalendar.aspx?catID=14` | 47 |
| Town of Lyons | ics | `lyonscolorado.com` CivicPlus | 7 |

Longmont's install also carries its library (814) and museum (325) as categories, so
one adapter covers three institutions.

### Libraries

| Organisation | Kind | Endpoint | Seen |
|---|---|---|---|
| Boulder Public Library, all branches and BLDG 61 | ics | `calendar.boulderlibrary.org` LibCal | 500 |
| Lafayette Public Library | ics | `lafayettepubliclibrary.libcal.com` | 500 |
| Nederland Community Library | ics | `nederland.libcal.com` | 283 |

`boulderlibrary.org` itself answers Cloudflare 403, but the LibCal subdomain that holds
the calendar is open. 500 is LibCal's own page cap, not the library's programme.

### Universities

CU Boulder's all-campus feed is 2248 events and mostly registrar deadlines, so we
subscribe to the curated group feeds instead. The pattern `/group/<urlname>/calendar.ics`
works for any of roughly 250 Localist groups, so adding a department later is one line.

| Group | Seen |
|---|---|
| CU Presents | 191 |
| Conference on World Affairs | 179 |
| Environmental Center | 54 |
| Museum of Natural History | 40 |
| CU Art Museum | 29 |
| ATLAS Institute | 26 |
| Fiske Planetarium | 1 |
| Naropa University (tribe) | 35 |

The all-campus feed was seeded once before this decision, then withdrawn. Sampling it
showed roughly half genuine public programming (recitals, lectures, the Art Museum's
sound baths) and half campus-internal notices and registrar deadlines carrying no venue
at all. Pausing it stopped the growth but left the damage: the directory's "Later" view
opened on "Fall 2026 Last Day to Drop a Class Without Penalty". All 208 records were
withdrawn from the repo with `scripts/remove-source.ts`, which walks the repo before it
drops the ledger row so nothing is stranded on the firehose. The genuinely public CU
events are covered by the seven group feeds above.

### Arts, environment, spiritual, tech

Colorado Chautauqua (374), BMoCA (34), Museum of Boulder (14), Boulder Ensemble Theatre
(122 performance dates), Dairy Arts Center (25, via JSON-LD), Nissi's (12), Longmont
Public Media (24), Colorado Music Festival (dormant off-season, 55 in history), Colorado
Mountain Club Boulder Group (31), Cool Boulder (14), Thorne Nature Experience (11),
Boulder County Audubon (11), Wild Bear Nature Center (8), Boulder Mountainbike Alliance
(21), Resource Central (2), Rocky Mountain Insight (261), Growing Gardens (7).

Seventeen Meetup groups and seven Luma calendars, including Colorado Startups (the
strongest Luma source in the region) and Spirit of the Front Range.

## Known gaps

**The City of Boulder has no machine-readable calendar.** `bouldercolorado.gov` is
Drupal: `?_format=json` answers 406, `/jsonapi` 404s, there is no ICS, no RSS, and event
pages carry no JSON-LD or add-to-calendar link. Its content is board and commission
meetings; Open Space and Mountain Parks programmes are not on it at all. This is the
county's largest city and its weakest source, while Boulder County, Longmont, Erie,
Lafayette, Nederland and Lyons all publish clean feeds.

**Four sources are reachable from a laptop but not from our Hetzner host**, so they are
not in the seed file. This was measured from the production box, not assumed from the
research, which ran on a residential connection:

| Organisation | From the server | With a browser user agent | Reading |
|---|---|---|---|
| City of Longmont | 403 | 403 | The datacenter IP range is blocked. This is the costliest loss in the set, 932 events including the library and the museum. A note to the city asking them to allow the range would recover all three at once. |
| Rocky Mountain Insight | 403 | 403 | Datacenter range blocked, 261 events |
| Resource Central | 403 | 403 | Datacenter range blocked, 2 events |
| Museum of Boulder | 403 | 200 | Not the address, the identity: they decline bots. We send an honest, identifying user agent and we are not going to dress it up as Chrome to get in, for the same reason we leave the Cloudflare-blocked sites alone. |

Three CU group feeds also answered 503 during that sweep and 200 when re-fetched a few
seconds apart. That was the sweep's own fault, not a block; `packages/ssrf-fetch` spaces
requests per host, so the sync path does not trip it.

Also unreachable, each confirmed rather than assumed:

| Organisation | Why |
|---|---|
| Boulder Food Rescue, Boulder Shambhala, Dickens Opera House, Boulder Chorale | Cloudflare 403 to every client we tried. We honour the block. |
| Visit Boulder, Visit Longmont | Simpleview API needs a per-request token we could not obtain honestly |
| Boulder Theater, Fox Theatre | Webflow and AXS, no JSON-LD anywhere, HTML scrape only |
| TinkerMill | Ticket Tailor, requires JavaScript and cookies |
| Boulder County Farmers Markets | Conclusively feedless: no events post type, markets are static pages |
| Boulder Valley School District | Finalsite endpoint is real but authenticated, 401 |
| Front Range Community College | No public events calendar exists |
| Impact Hub Boulder, Longmont Startup Week | Domains expired and repurposed. Do not wire these up. |
| `actualize.earth` | Boulder is its pilot city, but events live in its mobile app; no public feed |

## Three traps worth remembering

**Localist lies about the timezone.** CU Boulder's feeds declare
`X-WR-TIMEZONE:Eastern Time (US & Canada)` (an ActiveSupport name, not even an IANA one)
while writing every DTSTART in UTC. The instants are correct, so nothing is ever at the
wrong moment, but the label travels into the record and `startsAt` carries an offset
rather than a zone, so the label is what a card renders. A December concert at Macky
Auditorium read "9:30 PM EST" to every reader in Boulder. `localizeZone` in
`pipeline/enrich.ts` relabels an event once it is pinned inside the region, and relabels
only: the instant is never reinterpreted.


**Luma ICS returns the full event history.** Meetup's returns only upcoming, so zero
VEVENTs there means a dormant group, not a broken feed. Our ICS parser applies the
runtime window (`defaultWindow`, minus one day to plus ninety), so past Luma events are
dropped at parse time rather than published and hidden later.

**The Events Calendar caps `?ical=1` at 30 VEVENTs** on every install tested, while the
REST API pages freely. Our tribe connector uses the REST API, which is why Boulder County
gives 262 rather than 30.

A third trap does not apply to us: several of these hosts fail HTTP/2 negotiation and
return nothing to curl. Undici's `Agent` leaves `allowH2` off and we never set it, so
`packages/ssrf-fetch` speaks HTTP/1.1 and reaches them.
