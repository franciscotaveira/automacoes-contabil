#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
set -a
. ./.env
set +a

docker compose ps
docker compose exec -T n8n node -e "fetch('http://127.0.0.1:5678/healthz/readiness').then(async r=>{console.log(await r.text());process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
attempt=0
until docker compose exec -T plx-ingress-queue wget -qO- http://127.0.0.1:8090/health; do
  attempt=$((attempt + 1)); test "$attempt" -lt 12 || exit 1; sleep 2
done
docker compose exec -T document-ai-gateway wget -qO- http://127.0.0.1:8080/health
curl -fsS -H "X-Api-Key: $WAHA_API_KEY" http://127.0.0.1:3006/api/server/status >/dev/null
docker compose exec -T n8n n8n export:workflow --id=plxUnifiedV35Draft --output=/tmp/plx-check.json >/dev/null
docker compose exec -T n8n node -e "const d=require('/tmp/plx-check.json')[0]; if(d.active) process.exit(2); if(!d.nodes.some(n=>n.name==='WAHA · Receber evento')) process.exit(3); console.log('WORKFLOW_IMPORTED_INACTIVE')"
docker compose exec -T n8n rm -f /tmp/plx-check.json
echo 'SMOKE_OK'
