#!/usr/bin/env bash
# Nightly local backup: a plain-format Postgres dump, the Gate's blob directory, and the
# PDS volume (custodial repos, blobs and the PDS's own sqlite).
# Keeps 14 days under /var/backups/tributary. Copies that leave the server must be
# encrypted first: they contain host email addresses and wrapped credentials.
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT=/var/backups/tributary
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
C="docker compose --env-file $ROOT/infra/production/.env -f $ROOT/infra/production/compose.yml"
mkdir -p "$OUT"
$C exec -T db pg_dump -U tributary -d tributary --format=plain --no-owner | gzip > "$OUT/postgres-$STAMP.sql.gz"
$C run --rm --no-deps -T -v "$OUT:/backup" --entrypoint sh gate -c "tar czf /backup/gate-blobs-$STAMP.tgz -C /data/gate-blobs ." 2>/dev/null || true
# The PDS holds every custodial host's repo and blobs. Losing it loses their identities.
$C run --rm --no-deps -T -v "$OUT:/backup" --entrypoint sh directory-pds -c "tar czf /backup/pds-$STAMP.tgz -C /pds ." 2>/dev/null || true
find "$OUT" -type f -mtime +14 -delete
echo "backup ok $STAMP"
