#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

./scripts/pilot-preflight.sh
docker compose exec -T n8n n8n publish:workflow --id=plxUnifiedV35Draft
docker compose restart n8n task-runners plx-ingress-queue

attempt=0
until curl -fsS http://127.0.0.1:5679/healthz/readiness >/dev/null; do
  attempt=$((attempt + 1))
  test "$attempt" -lt 60 || { echo 'ERRO: n8n nao voltou apos publicar workflow'; ./scripts/rollback-pilot.sh; exit 1; }
  sleep 2
done
docker compose exec -T n8n n8n export:workflow --id=plxUnifiedV35Draft --output=/tmp/plx-active-check.json >/dev/null
active=$(docker compose exec -T n8n node -e 'const w=require("/tmp/plx-active-check.json")[0]; console.log(w.active?"ACTIVE":"INACTIVE")')
test "$active" = 'ACTIVE' || { echo 'ERRO: workflow nao ficou ativo'; ./scripts/rollback-pilot.sh; exit 1; }
echo 'PILOT_ACTIVE_WITH_EXTERNAL_SENDS_DISABLED'
