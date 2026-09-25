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

## Seeding a region's calendars

`infra/seeds/boulder.json` is the verified Boulder County list; `docs/sources.md` explains
each entry and what is deliberately absent. To load it:

```sh
C="docker compose --env-file infra/production/.env -f infra/production/compose.yml"
$C cp infra/seeds/boulder.json tributary:/tmp/seeds.json
$C exec -T -w /app/apps/tributary tributary \
  node_modules/.bin/tsx scripts/seed-sources.ts --file /tmp/seeds.json
```

Three things are worth knowing before you start it.

It takes hours, because every event is geocoded and written to the PDS. Run it detached
(`setsid nohup … > seed.log 2>&1 < /dev/null &`), and note that a `docker compose up`
restarts the container and kills the run. That is survivable: the script only *connects*
sources, and once a source exists the scheduler keeps syncing it, so re-running afterwards
picks up where it left off and prints `HAVE` for everything already in.

Node block-buffers stdout to a file, so the log stays empty for a long while. Watch the
ledger instead, which is the real signal:

```sh
$C exec -T db psql -U tributary -c \
  "select s.label, s.type, s.status, count(e.id) from tb_source s
   left join tb_source_event e on e.source_id = s.id group by 1,2,3 order by 4 desc;"
```

`--dry-run` shows what each input would become without writing anything, `--list` prints
the sources already connected, and `--url` seeds one address without a file.

## Optional services

- **Photon** (self-hosted geocoding): see `infra/photon/`. Set `PHOTON_URL`. Without it the built-in Boulder County gazetteer still resolves known venues.
- **Meilisearch**: see `infra/meili/`. Set `MEILI_URL` and `MEILI_MASTER_KEY`. Without them search falls back to a Postgres substring match.
- **Extraction**: set `EXTRACT_MODEL_API_KEY` (Anthropic) to turn on flyers, free text, unstructured pages and email extraction. Off by default; the console says so.
- **Google Calendar API key**: `GOOGLE_API_KEY` enables the incremental `syncToken` path; without it public calendars are read as `basic.ics`.
- **Inbound email**: a Cloudflare Email Worker on `in.boulderevents.directory` posting to `/api/inbound/email` signed with `INBOUND_EMAIL_SECRET`. Not yet deployed.

## Mail: moving the directory onto its own Resend domain

The directory sends as `hello@freeskool.xyz`, which is Free School's domain. Its own
Resend domain `boulderevents.directory` exists and three of its four DNS records are
published and resolving: the DKIM `TXT` at `resend._domainkey`, the SPF `TXT` at `send`,
and the `CNAME` at `rsend`.

**The fourth is blocked at the registrar and needs a human.** Resend wants an `MX` at
`send` pointing to `feedback-smtp.us-east-1.amazonses.com` (priority 10) — the
Return-Path that carries bounces. Namecheap's Email Forwarding currently owns the MX
records for this zone: the apex resolves to `eforward1..5.registrar-servers.com`, and
while that is the domain's mail setting, the API refuses every custom MX and reports a
gateway conflict. Passing `force` gets a success back and the record still does not
appear in the zone.

To finish:

1. Namecheap → Domain List → `boulderevents.directory` → Advanced DNS → **Mail Settings**,
   change *Email Forwarding* to **Custom MX**. This turns off any forwarding addresses on
   the domain, so check nothing depends on them first.
2. Add `MX send → feedback-smtp.us-east-1.amazonses.com`, priority 10.
3. Re-run verification for the domain in Resend; it should go `verified` within minutes.
4. On the box, in `/opt/tributary/infra/production/.env`, set the sending key that was
   minted for this domain (Resend key `boulderevents-directory-production`, send-only and
   scoped to `boulderevents.directory`) and switch the two from-addresses:

   ```
   SMTP_URL=smtps://resend:<the key>@smtp.resend.com:2465
   MAIL_FROM=Boulder Events Directory <hello@boulderevents.directory>
   PDS_EMAIL_FROM=hello@boulderevents.directory
   ```

5. `docker compose --env-file … up -d --no-deps tributary directory-pds` and send yourself
   a sign-in link to check it.

Do these together. The new key is scoped to `boulderevents.directory` alone, so setting
it while the from-addresses still say `freeskool.xyz` stops mail entirely rather than
falling back.

`INBOUND_EMAIL_DOMAIN` is still `in.freeskool.directory` and no inbound worker exists.
Resend can receive as well as send, which would replace the planned Cloudflare worker,
but receiving needs MX on the apex — the same registrar toggle — and a webhook wired to
`/api/inbound/email`. Nothing points mail at the directory today, which is the right
state to be in while that is true: no MX means a bounce, and a bounce is honest.

## The Spaces alpha lab

`infra/spaces-alpha-lab` from Free School is the basis; not deployed on this box (staging only, amd64).
