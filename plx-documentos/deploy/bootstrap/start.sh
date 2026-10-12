#!/bin/sh
set -eu

marker=/home/node/.n8n/plx-v35-bootstrap
if [ ! -f "$marker" ]; then
  node /opt/plx/bootstrap/prepare-credentials.mjs
  node /opt/plx/bootstrap/prepare-workflow.mjs
  n8n import:credentials --input=/tmp/plx-header-credentials.json
  n8n import:workflow --input=/tmp/plx-unified-v35.json
  rm -f /tmp/plx-header-credentials.json /tmp/plx-unified-v35.json
  touch "$marker"
fi

exec n8n start
