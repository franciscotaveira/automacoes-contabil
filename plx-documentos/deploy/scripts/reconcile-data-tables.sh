#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

restore_api_lock() {
  if grep -q '^N8N_PUBLIC_API_DISABLED=' .env; then
    sed -i 's/^N8N_PUBLIC_API_DISABLED=.*/N8N_PUBLIC_API_DISABLED=true/' .env
  else
    printf 'N8N_PUBLIC_API_DISABLED=true\n' >> .env
  fi
  docker compose up -d --force-recreate n8n task-runners plx-ingress-queue >/dev/null
}
trap restore_api_lock EXIT INT TERM

if grep -q '^N8N_PUBLIC_API_DISABLED=' .env; then
  sed -i 's/^N8N_PUBLIC_API_DISABLED=.*/N8N_PUBLIC_API_DISABLED=false/' .env
else
  printf 'N8N_PUBLIC_API_DISABLED=false\n' >> .env
fi
chmod 600 .env
docker compose up -d --force-recreate n8n task-runners plx-ingress-queue >/dev/null

attempt=0
until curl -fsS http://127.0.0.1:5679/healthz/readiness >/dev/null; do
  attempt=$((attempt + 1))
  test "$attempt" -lt 60 || { echo 'ERRO: n8n nao ficou pronto para reconciliar Data Tables'; exit 1; }
  sleep 2
done

./scripts/provision-data-tables.sh
echo 'DATA_TABLES_RECONCILED'
