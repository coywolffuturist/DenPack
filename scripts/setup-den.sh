#!/usr/bin/env bash
# Run on Den to install tool suite for pack workers
set -euo pipefail
echo "Setting up DenPack tool suite..."

# gh CLI
if ! command -v gh &>/dev/null; then
  brew install gh
fi
gh auth status || gh auth login

# Node.js (for neon client on Den)
if ! command -v node &>/dev/null; then
  brew install node
fi

# Create agent working dirs
mkdir -p ~/.denpack/agents/{lumen,vex,mira,coda,sable}/memory

# .env on Den
if [ ! -f ~/.denpack/.env ]; then
  cat > ~/.denpack/.env << 'ENVEOF'
NEON_DATABASE_URL=<fill in>
LMSTUDIO_BASE_URL=http://localhost:1234/v1
ARBOR_MODEL=gemma-4-e4b-it-mlx
WORKER_MODEL_PRIMARY=gemma-4-26b-a4b-it
WORKER_MODEL_CODER=qwen2.5-coder-7b-instruct-mlx
ESCALATION_SCORE_THRESHOLD=6.0
ENVEOF
  echo "Created ~/.denpack/.env — fill in NEON_DATABASE_URL"
fi

echo "Den setup complete."
echo "Next: fill in NEON_DATABASE_URL in ~/.denpack/.env"
echo "Then run: ./scripts/memory-push.sh all"
