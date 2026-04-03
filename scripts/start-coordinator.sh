#!/usr/bin/env bash
# Run on the Den — starts Arbor coordinator
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a; source .env; set +a
fi

echo "[arbor] Building..."
npm run build
find workers -name "*.md" | while read f; do
  mkdir -p "dist/$(dirname $f)"
  cp "$f" "dist/$f"
done

echo "[arbor] Starting coordinator on port ${COORDINATOR_PORT:-3848}..."
node dist/coordinator/server.js
