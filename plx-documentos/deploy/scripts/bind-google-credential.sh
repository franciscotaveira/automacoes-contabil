#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

credential_id=$(docker compose exec -T postgres psql -U n8n_plx -d n8n_plx -Atc \
  "select id from credentials_entity where name='Google Drive account' and type='googleDriveOAuth2Api' order by \"createdAt\" desc;")
count=$(printf '%s\n' "$credential_id" | sed '/^$/d' | wc -l | tr -d ' ')
test "$count" = "1" || { echo "ERRO: esperado 1 Google Drive account, encontrado $count"; exit 1; }

if grep -q '^PLX_GOOGLE_CREDENTIAL_ID=' .env; then
  sed -i "s/^PLX_GOOGLE_CREDENTIAL_ID=.*/PLX_GOOGLE_CREDENTIAL_ID=${credential_id}/" .env
else
  printf 'PLX_GOOGLE_CREDENTIAL_ID=%s\n' "$credential_id" >> .env
fi
chmod 600 .env
docker compose exec -T n8n rm -f /home/node/.n8n/plx-v35-bootstrap
docker compose up -d --force-recreate n8n task-runners plx-ingress-queue
./scripts/smoke.sh

actual=$(docker compose exec -T n8n n8n export:workflow --id=plxUnifiedV35Draft --output=/tmp/plx-google-check.json >/dev/null 2>&1 && \
  docker compose exec -T n8n node -e "const w=require('/tmp/plx-google-check.json')[0]; const ids=[...new Set(w.nodes.flatMap(n=>Object.values(n.credentials||{}).map(c=>c.id)).filter(Boolean))]; console.log(ids.includes(process.env.PLX_GOOGLE_CREDENTIAL_ID)?'BOUND':'MISSING')")
test "$actual" = "BOUND" || { echo 'ERRO: workflow nao recebeu a credencial Google Drive'; exit 1; }
echo 'GOOGLE_DRIVE_CREDENTIAL_BOUND'
