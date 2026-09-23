# Meilisearch on the box

Search across the directory: typo-tolerant, synonym-aware, filtered by region, category, tag and geo radius. Optional. With `MEILI_URL` unset, Tributary uses its Postgres path and the console behaves exactly as before, so this can be added and removed without a migration.

## Why it is worth a container

The Postgres fallback is a substring match over the rows already loaded for the page. It cannot spell-correct, it cannot rank, and it cannot answer "music near me this weekend". Meilisearch does all three in single-digit milliseconds at this size.

## Install

1. Mint a master key and put it in `infra/production/.env`:

```sh
echo "MEILI_MASTER_KEY=$(openssl rand -hex 32)" >> /opt/tributary/infra/production/.env
```

2. Merge `compose.fragment.yml` into `infra/production/compose.yml`: the `meili` service, the `meili` volume, and the three `MEILI_*` environment lines plus the `depends_on` on the `tributary` service.

3. Bring it up and let the API configure the index at boot:

```sh
cd /opt/tributary
C="docker compose --env-file infra/production/.env -f infra/production/compose.yml"
$C up -d meili
$C up -d --force-recreate tributary
$C logs --tail=20 tributary | grep 'search index configured'
```

4. Backfill the index from the ledger. The index is derived state: it can always be rebuilt, and a rebuild is the fix for any drift.

```sh
$C exec -T tributary node_modules/.bin/tsx -e \
  "import('./src/search/index.js').then(m => m.reindexAll().then(r => console.log(r)))"
```

## Sizing

An event document is roughly a kilobyte: a name, a trimmed description, a place, a host, tags and two timestamps. Boulder at full tilt is in the low tens of thousands of upcoming events.

| Documents | Index on disk | Comfortable memory limit |
|---|---|---|
| 10,000 | ~40 MB | 512 MB |
| 50,000 | ~200 MB | 1 GB |
| 250,000 | ~1 GB | 2 GB |

Meilisearch memory-maps the index, so resident memory tracks the working set rather than the whole index. `MEILI_MAX_INDEXING_MEMORY` caps the indexing arena, which is the part that actually spikes; the fragment sets it to 512 MB and the container limit to 1 GB. The CX33 has room for that alongside Postgres, the PDS and the two apps.

## A search-only key for the browser

The master key can write and must never leave the box. A browser that queries Meilisearch directly gets a key scoped to search on one index:

```sh
curl -s -X POST http://localhost:7700/keys \
  -H "Authorization: Bearer $MEILI_MASTER_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"description":"Boulder Events Directory, browser search","actions":["search"],"indexes":["tb_events"],"expiresAt":null}'
```

The response carries a `key`. It can read every document in `tb_events`, which is why `src/search/document.ts` refuses to index anything but public and gated events, and never writes a gated event's coordinates. Treat the index as world-readable, because with this key it is.

Today the console searches through the API rather than directly, so this key is not needed yet. It is here for when the directory wants instant-search as you type.

## Operating it

- **Health.** `/api/public/health` reports `search` as `ok`, `down` or `off`.
- **Drift.** Re-run the backfill above. It upserts what belongs and deletes what no longer does, which is also how an event that was narrowed to members-only gets swept out.
- **Backups.** None needed. The index is derived from Postgres; the nightly dump is the backup.
- **Upgrades.** Meilisearch occasionally changes its on-disk format between minor versions. Pin the tag, and on a version bump delete the volume and re-run the backfill rather than migrating.
