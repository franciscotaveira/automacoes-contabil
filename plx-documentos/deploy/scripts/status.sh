#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
docker compose ps
docker compose exec -T plx-ingress-queue wget -qO- http://127.0.0.1:8090/health
docker stats --no-stream $(docker compose ps -q)
