#!/usr/bin/env bash
# Pull, back up, rebuild the application, recreate it, verify health.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
C=(docker compose --env-file infra/production/.env -f infra/production/compose.yml)
BEFORE=$(git rev-parse --short HEAD)
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Tracked changes present; preserve them before releasing." >&2
  exit 1
fi
git pull --ff-only
AFTER=$(git rev-parse --short HEAD)
echo "== $BEFORE -> $AFTER"
"$ROOT/infra/production/backup.sh" || echo "backup skipped (first deploy?)"
"${C[@]}" config --quiet
for service in tributary gate; do
  container=$("${C[@]}" ps -q "$service" 2>/dev/null || true)
  if [ -n "$container" ]; then
    image=$(docker inspect --format '{{.Image}}' "$container")
    docker tag "$image" "tributary-$service:rollback-$BEFORE"
  fi
done
TRIBUTARY_VERSION="$AFTER" "${C[@]}" build gate tributary
TRIBUTARY_VERSION="$AFTER" "${C[@]}" up -d --no-deps gate tributary
HOST=$(sed -n 's/^TRIBUTARY_HOST=//p' infra/production/.env)
echo "== waiting for health"
for attempt in {1..40}; do
  if curl -fsS -m 10 "https://$HOST/api/public/health" | python3 -c 'import json,sys; h=json.load(sys.stdin); sys.exit(0 if h.get("status")=="ok" else 1)' 2>/dev/null; then
    echo "== released $AFTER"
    # Keep the three most recent rollback tags per service; older ones only hold disk.
    for service in tributary gate; do
      docker images --format '{{.Repository}}:{{.Tag}} {{.CreatedAt}}' "tributary-$service" | grep ':rollback-' | sort -k2 -r | tail -n +4 | cut -d' ' -f1 | xargs -r docker rmi >/dev/null 2>&1 || true
    done
    docker image prune -f >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 5
done
echo "Release health check failed; rollback images are tagged rollback-$BEFORE." >&2
exit 1
