# Deploying Boulder Events Directory

Boulder Events Directory runs on Tributary as a sibling Docker Compose stack on the Free School Hetzner box, behind Free School's Caddy, with its own domain and its own PDS.

| | |
|---|---|
| Host | Hetzner Cloud `freeskool-1` (CX33, Falkenstein), `root@167.233.100.123`, key `~/.ssh/frontrange-twin` |
| Checkout | `/opt/tributary` (branch `main`), env at `/opt/tributary/infra/production/.env` |
| Console + API | `https://boulderevents.directory` |
| PDS | `https://pds.boulderevents.directory`, this stack's own `directory-pds` container; custodial handles `<label>.boulderevents.directory` |
| Edge | Free School's Caddy (`production-web-1`) serves `BED_HOST`, `BED_PDS_HOST` and `*.BED_HANDLE_DOMAIN`, proxying to `tributary:4100` and `directory-pds:3000` over the `production_default` network |
| Email | Resend over SMTP (same key as Free School), from `hello@freeskool.xyz` |
| DNS | `boulderevents.directory`: A/AAAA on `@`, `pds`, `www` and `*` → the box. Registered at Namecheap 2026-09-23 |
| Backups | `infra/production/backup.sh` nightly: Postgres dump, Gate blobs, and the PDS volume (custodial repos and blobs), 14 days under `/var/backups/tributary` |

## Files

- `Dockerfile` — `tributary` (API + workers + built console) and `gate` targets from one workspace layer
- `infra/production/compose.yml` — `db`, `directory-pds`, `gate`, `tributary`; no published ports; joins Free School's network as `edge`. Service names avoid `postgres` and `pds`, which resolve to Free School's containers on that shared network
- `infra/production/.env.example` — every variable and how to generate it
- `infra/production/release.sh` — pull, back up, rebuild, recreate, verify health; tags rollback images
- `infra/production/backup.sh`

## Free School side (the shared edge)

Free School's Caddy is the only thing on the box holding ports 80 and 443, so it fronts this stack too. Its `infra/production/Caddyfile` carries three site blocks for us, all with on-demand TLS: `{$BED_HOST}` and `*.{$BED_HANDLE_DOMAIN}` to `tributary:4100`, `{$BED_PDS_HOST}` to `directory-pds:3000`, and on a handle host the two atproto paths (`/.well-known/atproto-did` and `/xrpc/*`) to the PDS ahead of the app. The old `{$TRIBUTARY_HOST}` now permanently redirects to `{$BED_HOST}`.

The on-demand `ask` gate answers 200 outright for `BED_HOST` and `BED_PDS_HOST`, and sends anything under `BED_HANDLE_DOMAIN` to Tributary's own `/internal/tls-check`, which asks our PDS. Free School's AppView knows nothing about our handles and must not be asked. `BED_HOST`, `BED_PDS_HOST` and `BED_HANDLE_DOMAIN` live in `/opt/freeskool/infra/production/.env`.

Validate a Caddyfile change before releasing it:

```sh
docker run --rm -e WEB_HOST=freeskool.xyz -e PDS_HOST=pds.freeskool.directory \
  -e PDS_HANDLE_DOMAIN=freeskool.directory -e SCHOOL_DOMAIN_SUFFIX=freeskool.xyz \
  -e BED_HOST=boulderevents.directory -e BED_PDS_HOST=pds.boulderevents.directory \
  -e BED_HANDLE_DOMAIN=boulderevents.directory \
  -v /opt/freeskool/infra/production/Caddyfile:/etc/caddy/Caddyfile:ro \
  caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

## First deploy

```sh
# On the server, as root
git clone https://github.com/omniharmonic/tributary.git /opt/tributary
cd /opt/tributary
cp infra/production/.env.example infra/production/.env && chmod 600 infra/production/.env
$EDITOR infra/production/.env      # generators are in the comments; PDS_ADMIN_PASSWORD and SMTP_URL come from /opt/freeskool/infra/production/.env

C="docker compose --env-file infra/production/.env -f infra/production/compose.yml"
$C config --quiet && $C build      # ~4 minutes the first time
$C up -d
curl -s https://boulderevents.directory/api/public/health
# {"status":"ok","checks":{"postgres":"ok","pds":"ok","gate":"ok"},"version":"…"}
```

Tributary migrates its `tb_*` tables at boot (drizzle); the Gate creates its `gate` schema at boot; pg-boss creates `pgboss`.

Backups: `crontab -e` → `23 3 * * * /opt/tributary/infra/production/backup.sh >> /var/log/tributary-backup.log 2>&1`.

## Releasing a change

```sh
ssh -i ~/.ssh/frontrange-twin root@167.233.100.123 /opt/tributary/infra/production/release.sh
```

Roll back with `git checkout <previous> && $C build && $C up -d`. A release that changes the schema also needs the pre-release dump.

## Acceptance checks after a deploy

1. `/api/public/health` is `ok` with all three checks.
2. Paste a public Google Calendar / Luma / Meetup link on `/add`; the preview shows real cards.
3. Sign up with a real address; the magic link arrives from Resend; the source syncs; the records appear on `https://pds.boulderevents.directory/xrpc/com.atproto.repo.listRecords?repo=<did>&collection=community.lexicon.calendar.event`.
4. The public directory `/` lists the events; `/api/public/regions/boulder/calendar.ics` returns a feed.
5. `https://<label>.boulderevents.directory/.well-known/atproto-did` returns the DID for the minted handle.

## Optional services

- **Photon** (self-hosted geocoding): see `infra/photon/`. Set `PHOTON_URL`. Without it the built-in Boulder County gazetteer still resolves known venues.
- **Meilisearch**: see `infra/meili/`. Set `MEILI_URL` and `MEILI_MASTER_KEY`. Without them search falls back to a Postgres substring match.
- **Extraction**: set `EXTRACT_MODEL_API_KEY` (Anthropic) to turn on flyers, free text, unstructured pages and email extraction. Off by default; the console says so.
- **Google Calendar API key**: `GOOGLE_API_KEY` enables the incremental `syncToken` path; without it public calendars are read as `basic.ics`.
- **Inbound email**: a Cloudflare Email Worker on `in.boulderevents.directory` posting to `/api/inbound/email` signed with `INBOUND_EMAIL_SECRET`. Not yet deployed.

## The Spaces alpha lab

`infra/spaces-alpha-lab` from Free School is the basis; not deployed on this box (staging only, amd64).
