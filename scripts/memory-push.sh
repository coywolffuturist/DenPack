#!/usr/bin/env bash
# Push memory snapshot to Den for a specific agent
# Usage: ./scripts/memory-push.sh <agent>
set -euo pipefail
AGENT=${1:-all}
DEN_USER=coywolfden
DEN_HOST=localhost
DEN_PORT=2222
DEN_WORKDIR=/Users/coywolfden/.denpack/agents
VPS_MEMORY=/home/ubuntu/coywolf/memory

push_agent() {
  local agent=$1
  echo "Pushing memory for $agent..."
  ssh -p $DEN_PORT $DEN_USER@$DEN_HOST "mkdir -p $DEN_WORKDIR/$agent/memory"
  case $agent in
    lumen|vex)
      rsync -az -e "ssh -p $DEN_PORT" \
        $VPS_MEMORY/entities/prowl-strategies.md \
        $VPS_MEMORY/PROJECTS.md \
        $DEN_USER@$DEN_HOST:$DEN_WORKDIR/$agent/memory/
      ;;
    mira|coda)
      rsync -az -e "ssh -p $DEN_PORT" \
        $VPS_MEMORY/PROJECTS.md \
        $VPS_MEMORY/reference/GOALS.md \
        $DEN_USER@$DEN_HOST:$DEN_WORKDIR/$agent/memory/
      ;;
    sable)
      rsync -az -e "ssh -p $DEN_PORT" \
        $VPS_MEMORY/PROJECTS.md \
        $DEN_USER@$DEN_HOST:$DEN_WORKDIR/$agent/memory/
      ;;
  esac
  echo "$agent memory synced."
}

if [ "$AGENT" = "all" ]; then
  for a in lumen vex mira coda sable; do push_agent $a; done
else
  push_agent $AGENT
fi
