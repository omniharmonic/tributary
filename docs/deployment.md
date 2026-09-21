# Deploying Tributary

Tributary runs as a sibling Docker Compose stack on the Free School Hetzner box, behind Free School's Caddy, using Free School's PDS as the Directory PDS.

| | |
|---|---|
| Host | Hetzner Cloud `freeskool-1` (CX33, Falkenstein), `root@167.233.100.123`, key `~/.ssh/frontrange-twin` |
| Checkout | `/opt/tributary` (branch `main`), env at `/opt/tributary/infra/production/.env` |
| Console + API | `https://tributary.freeskool.directory` |
| PDS | `https://pds.freeskool.directory` (Free School's); custodial handles `<label>.freeskool.directory` |
| Edge | Free School's Caddy (`production-web-1`) proxies `TRIBUTARY_HOST` → `tributary:4100` over the `production_default` network |
| Email | Resend over SMTP (same key as Free School), from `hello@freeskool.xyz` |
| DNS | `*.freeskool.directory` A/AAAA → the box (already in place); `tributary.` resolves through the wildcard |
| Backups | `infra/production/backup.sh` nightly (Postgres dump + Gate blobs), 14 days under `/var/backups/tributary`; the PDS is in Free School's backup |

## Files

- `Dockerfile` — `tributary` (API + workers + built console) and `gate` targets from one workspace layer
- `infra/production/compose.yml` — postgres, gate, tributary; no published ports; joins Free School's network as `edge`
- `infra/production/.env.example` — every variable and how to generate it
- `infra/production/release.sh` — pull, back up, rebuild, recreate, verify health; tags rollback images
- `infra/production/backup.sh`

## Free School side (one-time, done 2026-09-21)

Free School's `infra/production/Caddyfile` gained a `{$TRIBUTARY_HOST}` site block (on-demand TLS, proxied to `tributary:4100`) and a short-circuit in the on-demand `ask` gate; `compose.yml` passes `TRIBUTARY_HOST` to the `web` container; `TRIBUTARY_HOST=tributary.freeskool.directory` is set in `/opt/freeskool/infra/production/.env`. The labels `tributary`, `events`, `directory`, `gate` are reserved in Free School's handle list.

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
curl -s https://tributary.freeskool.directory/api/public/health
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
3. Sign up with a real address; the magic link arrives from Resend; the source syncs; the records appear on `https://pds.freeskool.directory/xrpc/com.atproto.repo.listRecords?repo=<did>&collection=community.lexicon.calendar.event`.
4. The public directory `/` lists the events; `/api/public/regions/boulder/calendar.ics` returns a feed.
5. `https://<label>.freeskool.directory/.well-known/atproto-did` returns the DID for the minted handle.

## Optional services

- **Photon** (self-hosted geocoding): run `rtuszik/photon-docker` with a Colorado extract and set `PHOTON_URL=http://photon:2322`. Without it, the venue table geocodes the ~35 best-known Boulder venues and everything else publishes without coordinates.
- **Extraction**: set `EXTRACT_MODEL_API_KEY` (Anthropic) to turn on flyers, free text, unstructured pages and email extraction. Off by default; the console says so.
- **Google Calendar API key**: `GOOGLE_API_KEY` enables the incremental `syncToken` path; without it public calendars are read as `basic.ics`.
- **Inbound email**: a Cloudflare Email Worker on `in.freeskool.directory` posting to `/api/inbound/email` signed with `INBOUND_EMAIL_SECRET`. Not yet deployed.

## The Spaces alpha lab

`infra/spaces-alpha-lab` from Free School is the basis; not deployed on this box (staging only, amd64).
