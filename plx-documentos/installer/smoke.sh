#!/usr/bin/env bash
set -euo pipefail
BASE_URL="${DOCUMENT_READER_URL:-http://127.0.0.1:8080}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

curl --fail --silent --show-error "$BASE_URL/health" >/dev/null
curl --fail --silent --show-error \
  -H 'Content-Type: application/json' \
  --data-binary "@$ROOT_DIR/fixtures/extract-payload.json" \
  "$BASE_URL/v1/document/extract" >/tmp/plx-document-reader-smoke.json
node -e "const r=require('/tmp/plx-document-reader-smoke.json');if(!r.ok)process.exit(1);console.log(JSON.stringify({ok:true,correlation_id:r.metadata&&r.metadata.correlation_id,state:r.metadata&&r.metadata.document_state}))"
