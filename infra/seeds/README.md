# Region seed files

A seed file is the list of calendars a region starts with. `boulder.json` is the working
example; `docs/sources.md` is its commentary.

## Format

```json
[
  { "input": "https://bouldercounty.gov/events/", "label": "Boulder County" },
  { "input": "https://www.meetup.com/boulder-elixir/events/ical/", "label": "Boulder Elixir" }
]
```

`input` is anything the one-box accepts: a site that runs a calendar plugin, a feed URL,
a Luma or Meetup page. `label` is what the directory shows; without it the label is
generated and reads like "WordPress events calendar at example.org", which is accurate
and unwelcoming. `note` is free text for whoever maintains the file. The shorthand
`["https://…", "https://…"]` also works when you do not need labels.

## What to put in `input`

Give the **site**, not the API, for anything detection can fingerprint. Detection probes
`origin/wp-json/tribe/events/v1/events` itself and will find the REST API, which pages
freely, where the site's own `?ical=1` export is capped at 30 events on every install we
have tested. Give the **feed URL directly** for CivicPlus, LibCal and other ICS
endpoints, which are not discoverable from the homepage.

Check the path you write actually answers. `coloradomusicfestival.org/events/` is a 404
while the tribe API under the same origin is fine, so the origin is the right input.

## Check reachability from the host that will do the fetching, not from your laptop

This is the one that will bite you. Three Boulder sources answer a residential connection
and return 403 to our datacenter address, including the City of Longmont with 932 events.
Sweep the list from the server before you trust it:

```sh
while read -r u; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -L --max-time 20 \
    -A "TributaryBot/0.1 (+https://your.directory/about/crawler; events adapter)" "$u")
  [ "$code" = 200 ] || echo "$code  $u"
done < urls.txt
```

Space the requests. A tight loop earned three 503s from one university host that returned
200 the moment they were a few seconds apart, and they are fine in normal syncing because
`packages/ssrf-fetch` spaces requests per host.

If a host returns 403 to our user agent and 200 to a browser's, it is declining bots.
Leave it out. We send an honest, identifying user agent, and dressing it up as Chrome to
get past a refusal is not a thing this project does.

## Curate rather than hoover

A university's all-campus feed will happily hand over two thousand events, half of them
registrar deadlines with no venue, and drown every other source in the region. Prefer the
department or group feeds. For Localist, `/group/<urlname>/calendar.ics` works for any
group, so adding one later is one line.

Sources seeded this way are published under the directory's own curator account and
marked `claimed: false`, so their cards say "Listed" and offer a claim path. An
organisation's name never becomes a host identity until they ask for it.

## Running it

See "Seeding a region's calendars" in `docs/deployment.md`. `--dry-run` reports what each
input would become without writing anything, which is the cheap way to check a new file.
