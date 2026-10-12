#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

failures=''
fail() { failures="${failures}\n- $1"; }

case "${NVIDIA_API_KEY:-}" in ''|CHANGE_ME*|PENDING_CONFIGURATION*) fail 'NVIDIA_API_KEY_NOT_CONFIGURED';; esac
test "${N8N_PUBLIC_API_DISABLED:-true}" = 'true' || fail 'N8N_PUBLIC_API_MUST_BE_DISABLED'

gateway=$(docker compose exec -T document-ai-gateway wget -qO- http://127.0.0.1:8080/health 2>/dev/null || true)
printf '%s' "$gateway" | grep -q '"nvidia_configured":true' || fail 'NVIDIA_GATEWAY_NOT_READY'

queue=$(docker compose exec -T plx-ingress-queue wget -qO- http://127.0.0.1:8090/health 2>/dev/null || true)
printf '%s' "$queue" | grep -q '"ok": true' || fail 'QUEUE_NOT_HEALTHY'
printf '%s' "$queue" | grep -Eq '"queued": 0.*"processing": 0.*"retry": 0' || fail 'QUEUE_NOT_EMPTY'

waha=$(curl -fsS -H "X-Api-Key: $WAHA_API_KEY" "http://127.0.0.1:3006/api/sessions/$WAHA_SESSION" 2>/dev/null || true)
printf '%s' "$waha" | grep -q '"status":"WORKING"' || fail 'WAHA_SESSION_NOT_WORKING'

credential_rows=$(docker compose exec -T postgres psql -U n8n_plx -d n8n_plx -Atc \
  "select id from credentials_entity where name='Google Drive account' and type='googleDriveOAuth2Api' order by \"createdAt\" desc;" 2>/dev/null || true)
credential_count=$(printf '%s\n' "$credential_rows" | sed '/^$/d' | wc -l | tr -d ' ')
test "$credential_count" = '1' || fail "GOOGLE_DRIVE_CREDENTIAL_COUNT_${credential_count}"
if test "$credential_count" = '1'; then
  test "${PLX_GOOGLE_CREDENTIAL_ID:-}" = "$credential_rows" || fail 'GOOGLE_DRIVE_CREDENTIAL_NOT_BOUND'
fi

docker compose exec -T n8n n8n export:workflow --id=plxUnifiedV35Draft --output=/tmp/plx-pilot-preflight.json >/dev/null 2>&1 || fail 'WORKFLOW_EXPORT_FAILED'
workflow_check=$(docker compose exec -T n8n node -e '
const fs=require("fs"); const w=JSON.parse(fs.readFileSync("/tmp/plx-pilot-preflight.json","utf8"))[0];
const names=["WhatsApp · Confirmar arquivo já recebido","WhatsApp · Enviar confirmação","Enviar fechamento ao grupo"];
const google=[...new Set(w.nodes.flatMap(n=>Object.values(n.credentials||{}).filter(c=>c.name==="Google Drive account").map(c=>c.id)))];
console.log(JSON.stringify({active:w.active,nodes:w.nodes.length,sends:names.every(x=>w.nodes.find(n=>n.name===x)?.disabled===true),google}));
' 2>/dev/null || true)
printf '%s' "$workflow_check" | grep -q '"active":false' || fail 'WORKFLOW_MUST_BE_INACTIVE_BEFORE_PILOT'
printf '%s' "$workflow_check" | grep -q '"nodes":80' || fail 'WORKFLOW_NODE_COUNT_INVALID'
printf '%s' "$workflow_check" | grep -q '"sends":true' || fail 'EXTERNAL_SENDS_MUST_BE_DISABLED'
if test "$credential_count" = '1'; then
  printf '%s' "$workflow_check" | grep -Fq "\"google\":[\"$credential_rows\"]" || fail 'WORKFLOW_GOOGLE_REFERENCE_INVALID'
fi

if test -n "$failures"; then
  printf 'PILOT_PREFLIGHT_FAILED%b\n' "$failures"
  exit 1
fi
echo 'PILOT_PREFLIGHT_OK'
