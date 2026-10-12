#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
./scripts/preflight.sh
docker compose build --pull
docker compose up -d
./scripts/smoke.sh
