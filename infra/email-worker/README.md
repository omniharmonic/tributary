# Inbound email worker

Carries forwarded mail from `add+<token>@in.freeskool.directory` to Tributary's `POST /api/inbound/email` (P1). Tributary publishes `.ics` parts from a sender that matches the host's verified address, and holds everything else for confirmation.

Not part of the Hetzner stack; runs on Cloudflare (free tier).

1. In Cloudflare, add the zone `freeskool.directory` (or move DNS there) and enable Email Routing for it. Add the `in` subdomain as a routing domain and create a catch-all rule that sends to this worker.
2. `cd infra/email-worker && npx wrangler deploy`
3. `npx wrangler secret put TRIBUTARY_URL` → `https://tributary.freeskool.directory`; `npx wrangler secret put INBOUND_EMAIL_SECRET` → the same value as `INBOUND_EMAIL_SECRET` in `/opt/tributary/infra/production/.env` (set both, then `release.sh`).
4. A host's address is shown under Settings → Inbound channels; forward an invite to it and confirm at `/dashboard/confirmations`.

Until this is deployed, `INBOUND_EMAIL_SECRET` stays empty and the endpoint answers 404.
