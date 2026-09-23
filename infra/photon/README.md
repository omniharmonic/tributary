# Photon: self-hosted geocoding

Turns a street address into coordinates so an event gets a map pin and answers the region filter. Public Nominatim forbids this kind of use, so we run our own or do without.

**Tributary works without it.** `PHOTON_URL` unset means the built-in Boulder County gazetteer (`packages/connectors/src/enrich/venues.ts`, about 160 named venues) still resolves anything held at a known place, and everything else publishes with a locality but no pin. Photon is what covers the long tail: a house number on a street nobody has curated.

## Where it sits in the resolution order

`geocodeBest()` tries three things and stops at the first that answers:

1. **The gazetteer.** Free, instant, exact, and it also corrects the venue's name and address. Most Boulder community events hit here.
2. **The parsed street address.** `parseAddressLine()` pulls `1001 Arapahoe Ave` out of `Boulder Public Library, 1001 Arapahoe Ave, Boulder, CO 80302` and asks Photon for the street alone, which is what makes house-level precision possible.
3. **The raw string.** Last resort, for a place whose name Photon knows but we do not.

Every query is biased to Boulder and every answer is discarded unless it falls inside the Front Range box, because a bare `Main St` matches a thousand places and a wrong pin is worse than no pin.

## Deciding whether to run it

Check free disk on the box first. The index is by far the largest thing in the stack:

```sh
ssh -i ~/.ssh/frontrange-twin root@167.233.100.123 'df -h /'
```

Two ways to get an index, with different costs:

**A. A prebuilt country extract (recommended).** Photon publishes per-country indexes; the image downloads one on first boot from `REGION`. No Nominatim, no import, one long download. `us` is the smallest prebuilt index that covers Colorado, and it is tens of gigabytes — list the directory and read the actual file size before you pull it:

```sh
curl -s https://download1.graphhopper.com/public/extracts/by-country-code/us/ | grep -o 'photon-db-us[^"<]*'
```

**B. A Colorado-only index.** Much smaller at rest, but Photon builds its index from a Nominatim database, so you need Postgres, `osm2pgsql` and a Nominatim import of the Geofabrik extract before Photon can export:

```sh
curl -O https://download.geofabrik.de/north-america/us/colorado-latest.osm.pbf
```

That import is CPU-bound and runs for hours on a CX33. Take option A unless disk is the binding constraint.

Either way, verify the size that lands rather than trusting a number in this file.

## Running it

Paste `compose.fragment.yml` into `infra/production/compose.yml`, add `PHOTON_URL: http://photon:2322` to the `tributary` service, then:

```sh
C="docker compose --env-file infra/production/.env -f infra/production/compose.yml"
$C up -d photon
$C logs -f photon            # the first boot downloads and opens the index
curl -s http://localhost:2322/status
$C up -d --force-recreate tributary
```

The health check allows ten minutes of start period because opening a cold index is slow. Nothing outside the compose network should reach port 2322.

## Checking it works

```sh
# Inside the network
$C exec tributary node -e "fetch('http://photon:2322/api?q=1001+Arapahoe+Ave&lat=40.015&lon=-105.27&limit=1').then(r=>r.json()).then(j=>console.log(JSON.stringify(j.features?.[0]?.geometry)))"
```

Then paste a calendar whose events carry street addresses and confirm the cards show a place. `GET /api/public/stats` reports how many live events carry coordinates.

## Maintaining it

Re-import when the street data is old enough to matter, which for event venues is rarely. `UPDATE_STRATEGY` is off on purpose: a nightly update that fails halfway leaves the index unusable, and a month-stale street index still geocodes a library correctly. To refresh, stop the service, remove the `photon_index` volume, and start it again.

Adding a venue to the gazetteer is almost always the better fix for a specific place that geocodes badly. The table is hand-maintained and the header comment says how.
