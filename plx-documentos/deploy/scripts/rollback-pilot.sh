#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

docker compose exec -T n8n n8n unpublish:workflow --id=plxUnifiedV35Draft || true
docker compose restart n8n task-runners plx-ingress-queue
attempt=0
until curl -fsS http://127.0.0.1:5679/healthz/readiness >/dev/null; do
  attempt=$((attempt + 1))
  test "$attempt" -lt 60 || { echo 'ERRO: n8n nao voltou no rollback'; exit 1; }
  sleep 2
done
echo 'PILOT_ROLLED_BACK_QUEUE_PRESERVED'
