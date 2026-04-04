#!/usr/bin/env bash
# ssh-tunnel.sh — SSH tunnel helper for DenPack / LM Studio connection
#
# Opens a persistent SSH tunnel so that localhost:1234 on the VPS routes to
# the Den's LM Studio API (also on port 1234).
#
# Usage:
#   ./scripts/ssh-tunnel.sh [--start] [DEN_HOST]
#   ./scripts/ssh-tunnel.sh --status
#   ./scripts/ssh-tunnel.sh --stop
#
# Environment variables:
#   DEN_HOST     — hostname or IP of the Den (default: den.local)
#   DEN_USER     — SSH username on the Den (default: current user)
#   DEN_SSH_PORT — SSH port on the Den (default: 22)
#   LOCAL_PORT   — local port to bind (default: 1234)
#   REMOTE_PORT  — remote port on the Den (default: 1234)

set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
DEFAULT_DEN_HOST="den.local"
DEN_HOST="${DEN_HOST:-$DEFAULT_DEN_HOST}"
DEN_USER="${DEN_USER:-$(whoami)}"
DEN_SSH_PORT="${DEN_SSH_PORT:-22}"
LOCAL_PORT="${LOCAL_PORT:-1234}"
REMOTE_PORT="${REMOTE_PORT:-1234}"

LOG_FILE="/tmp/ssh-tunnel.log"
PID_FILE="/tmp/ssh-tunnel.pid"

# ── Colours (no-op if not a terminal) ────────────────────────────────────────
if [[ -t 1 ]]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; NC=''
fi

# ── Helpers ──────────────────────────────────────────────────────────────────
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

die() { echo -e "${RED}ERROR:${NC} $*" >&2; exit 1; }

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS] [DEN_HOST]

Options:
  --start    Open the SSH tunnel (default action)
  --status   Check whether the tunnel is active
  --stop     Kill the running tunnel
  --help     Show this help

Environment variables:
  DEN_HOST       Host/IP of Coywolf Den (default: den.local)
  DEN_USER       SSH user on the Den (default: current user)
  DEN_SSH_PORT   SSH port (default: 22)
  LOCAL_PORT     Local port to expose LM Studio on (default: 1234)
  REMOTE_PORT    Remote LM Studio port on the Den (default: 1234)

Example:
  DEN_HOST=192.168.1.50 $(basename "$0") --start
  $(basename "$0") --status
  $(basename "$0") --stop
EOF
}

# ── Status ────────────────────────────────────────────────────────────────────
cmd_status() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid=$(cat "$PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
      echo -e "${GREEN}✔ Tunnel is active${NC} (PID $pid, local port $LOCAL_PORT → Den:$REMOTE_PORT)"
      return 0
    else
      echo -e "${YELLOW}⚠ PID file found but process $pid is not running${NC}"
      rm -f "$PID_FILE"
      return 1
    fi
  fi

  # Also check via lsof in case the PID file was lost
  if lsof -i "TCP:${LOCAL_PORT}" -sTCP:LISTEN &>/dev/null 2>&1; then
    echo -e "${YELLOW}⚠ Something is listening on port $LOCAL_PORT but no PID file found${NC}"
    return 1
  fi

  echo -e "${RED}✘ Tunnel is not active${NC}"
  return 1
}

# ── Stop ─────────────────────────────────────────────────────────────────────
cmd_stop() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid=$(cat "$PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
      log "Stopping tunnel (PID $pid)…"
      kill "$pid" && rm -f "$PID_FILE"
      echo -e "${GREEN}✔ Tunnel stopped${NC}"
      return 0
    else
      log "PID $pid not found; cleaning up stale PID file"
      rm -f "$PID_FILE"
    fi
  fi

  # Fallback: kill any ssh/autossh holding our local port
  local pids
  pids=$(lsof -t -i "TCP:${LOCAL_PORT}" -sTCP:LISTEN 2>/dev/null || true)
  if [[ -n "$pids" ]]; then
    echo "$pids" | xargs kill && echo -e "${GREEN}✔ Killed processes on port $LOCAL_PORT${NC}"
  else
    echo "No active tunnel found."
  fi
}

# ── Start ─────────────────────────────────────────────────────────────────────
cmd_start() {
  # Already running?
  if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo -e "${YELLOW}Tunnel is already running (PID $(cat "$PID_FILE")).${NC}"
    echo "Use --stop to terminate it first, or --status to inspect."
    return 0
  fi

  log "Opening SSH tunnel: localhost:${LOCAL_PORT} → ${DEN_HOST}:${REMOTE_PORT}"
  log "  SSH target: ${DEN_USER}@${DEN_HOST}:${DEN_SSH_PORT}"

  local ssh_opts=(
    -N                          # no remote command
    -L "${LOCAL_PORT}:localhost:${REMOTE_PORT}"
    -p "${DEN_SSH_PORT}"
    -o ServerAliveInterval=30
    -o ServerAliveCountMax=3
    -o ExitOnForwardFailure=yes
    -o StrictHostKeyChecking=no
    -o BatchMode=yes
    "${DEN_USER}@${DEN_HOST}"
  )

  if command -v autossh &>/dev/null; then
    log "Using autossh for auto-reconnect"
    # AUTOSSH_PORT=0 disables the autossh monitoring port (uses ServerAlive instead)
    AUTOSSH_PORT=0 autossh \
      -M 0 \
      "${ssh_opts[@]}" \
      >> "$LOG_FILE" 2>&1 &
  else
    log "autossh not found; using plain ssh with ServerAliveInterval=30"
    (
      while true; do
        ssh "${ssh_opts[@]}" >> "$LOG_FILE" 2>&1 || true
        log "SSH tunnel dropped; reconnecting in 5s…"
        sleep 5
      done
    ) &
  fi

  local pid=$!
  echo "$pid" > "$PID_FILE"
  log "Tunnel started (PID $pid)"
  echo -e "${GREEN}✔ Tunnel started${NC} (PID $pid)"
  echo "  Local  → localhost:${LOCAL_PORT}"
  echo "  Remote → ${DEN_HOST}:${REMOTE_PORT}"
  echo "  Log    → ${LOG_FILE}"
}

# ── Argument parsing ──────────────────────────────────────────────────────────
ACTION="start"

for arg in "$@"; do
  case "$arg" in
    --start)  ACTION="start"  ;;
    --status) ACTION="status" ;;
    --stop)   ACTION="stop"   ;;
    --help|-h) usage; exit 0  ;;
    --*)      die "Unknown option: $arg. Use --help for usage." ;;
    *)
      # Positional argument overrides DEN_HOST
      DEN_HOST="$arg"
      ;;
  esac
done

# ── Dispatch ──────────────────────────────────────────────────────────────────
case "$ACTION" in
  start)  cmd_start  ;;
  status) cmd_status ;;
  stop)   cmd_stop   ;;
  *)      die "Unknown action: $ACTION" ;;
esac
