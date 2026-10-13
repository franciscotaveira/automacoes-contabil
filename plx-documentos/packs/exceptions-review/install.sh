#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
python -m pip install -r "$ROOT_DIR/ops-review/requirements.txt"
echo "Dependências instaladas. Configure REVIEW_SHARED_KEY e REVIEW_DB_PATH antes de iniciar o serviço."
