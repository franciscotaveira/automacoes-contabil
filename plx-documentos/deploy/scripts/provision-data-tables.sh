#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
test -n "${N8N_API_KEY:-}" || { echo 'ERRO: N8N_API_KEY ausente'; exit 1; }
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
python3 ./scripts/provision-data-tables.py > "$tmp"
for name in PLX_MANIFEST_TABLE_ID PLX_ISSUERS_TABLE_ID PLX_BENCHMARK_TABLE_ID; do
  value=$(grep "^${name}=" "$tmp" | cut -d= -f2-)
  test -n "$value"
  if grep -q "^${name}=" .env; then sed -i "s/^${name}=.*/${name}=${value}/" .env; else printf '%s=%s\n' "$name" "$value" >> .env; fi
done
chmod 600 .env
docker compose exec -T n8n rm -f /home/node/.n8n/plx-v35-bootstrap
docker compose up -d --force-recreate n8n task-runners plx-ingress-queue
echo 'DATA_TABLES_PROVISIONED'
