#!/usr/bin/env bash
# Launch DenPack router (VPS side)
set -euo pipefail

echo "Starting DenPack router..."

# Load .env if present
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

node --experimental-strip-types router/index.ts &
ROUTER_PID=$!
echo "Router PID: $ROUTER_PID"

# Wait briefly and verify it started
sleep 2
if kill -0 $ROUTER_PID 2>/dev/null; then
  echo "Router running on port ${ROUTER_PORT:-3847}"
else
  echo "Router failed to start — check logs"
  exit 1
fi
