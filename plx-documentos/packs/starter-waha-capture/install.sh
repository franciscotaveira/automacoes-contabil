#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
echo "Template: $ROOT_DIR/workflows/document-waha-ingest-v2.json"
exec "$ROOT_DIR/installer/bootstrap.sh" "$@"
