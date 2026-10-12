#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

source_file=${1:-}
test -n "$source_file" -a -f "$source_file" || {
  echo 'Uso: ./scripts/import-credentials.sh /caminho/credentials.json'
  exit 1
}

mode=$(stat -c '%a' "$source_file")
test "$mode" = 600 || {
  echo 'ERRO: o arquivo deve ter permissao 600'
  exit 1
}

docker compose cp "$source_file" n8n:/tmp/plx-credentials.json
docker compose exec -T n8n n8n import:credentials --input=/tmp/plx-credentials.json
docker compose exec -T n8n rm -f /tmp/plx-credentials.json
echo 'CREDENTIALS_IMPORTED'
