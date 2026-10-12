#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

test -f .env || { echo 'ERRO: copie .env.example para .env'; exit 1; }
docker compose config --quiet

for name in POSTGRES_PASSWORD N8N_ENCRYPTION_KEY INTERNAL_TOKEN WAHA_API_KEY WAHA_DASHBOARD_PASSWORD WHATSAPP_SWAGGER_PASSWORD NVIDIA_API_KEY PLX_ALLOWED_GROUP_ID PLX_DRIVE_ROOT_FOLDER_ID; do
  value=$(grep -E "^${name}=" .env | tail -n 1 | cut -d= -f2-)
  test -n "$value" || { echo "ERRO: $name ausente"; exit 1; }
  case "$value" in CHANGE_ME*|PENDING_CONFIGURATION*) echo "ERRO: $name ainda provisoria"; exit 1;; esac
done

available_mb=$(df -Pm . | awk 'NR==2 {print $4}')
test "$available_mb" -ge 15360 || { echo 'ERRO: menos de 15 GB livres'; exit 1; }

available_mem_mb=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
test "$available_mem_mb" -ge 2048 || { echo 'ERRO: menos de 2 GB de RAM disponivel'; exit 1; }

echo 'PREFLIGHT_OK'
