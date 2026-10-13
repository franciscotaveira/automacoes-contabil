#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_DIR="$ROOT_DIR/deploy"
ENV_FILE="$DEPLOY_DIR/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$DEPLOY_DIR/.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "Arquivo criado em $ENV_FILE. Substitua CHANGE_ME antes de continuar."
  exit 3
fi
if grep -q '=CHANGE_ME' "$ENV_FILE"; then
  echo "Bootstrap interrompido: ainda existem valores CHANGE_ME em $ENV_FILE." >&2
  exit 3
fi

docker compose --env-file "$ENV_FILE" -f "$DEPLOY_DIR/compose.yaml" config >/dev/null
docker build -t plx-document-reader:test "$ROOT_DIR/document-reader"

if [[ "${START_STACK:-false}" == "true" ]]; then
  docker compose --env-file "$ENV_FILE" -f "$DEPLOY_DIR/compose.yaml" up -d
else
  echo "Configuração e build validados. Use START_STACK=true para iniciar a stack."
fi

if [[ "${IMPORT_WORKFLOWS:-false}" == "true" ]]; then
  container="${N8N_CONTAINER_NAME:-plx-documentos-n8n-1}"
  for workflow in "$ROOT_DIR"/workflows/document-*-v2.json; do
    name="$(basename "$workflow")"
    docker cp "$workflow" "$container:/tmp/$name"
    docker exec "$container" n8n import:workflow --input="/tmp/$name"
  done
fi

"$ROOT_DIR/installer/smoke.sh"
