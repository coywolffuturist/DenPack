#!/usr/bin/env bash
# DenPack health check
set -euo pipefail

echo "=== DenPack Status ==="

# Router health
ROUTER_PORT=${ROUTER_PORT:-3847}
echo -n "Router (:$ROUTER_PORT): "
if curl -sf "http://localhost:$ROUTER_PORT/health" 2>/dev/null; then
  echo ""
else
  echo "DOWN"
fi

# LM Studio models
LMSTUDIO_URL=${LMSTUDIO_BASE_URL:-http://localhost:1234/v1}
echo -n "LM Studio models: "
MODELS=$(curl -sf "$LMSTUDIO_URL/models" 2>/dev/null | \
  node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); try { const m=JSON.parse(d).data.map(x=>x.id); console.log(m.join(', ')); } catch(e){ console.log('parse error'); }" 2>/dev/null || echo "unreachable")
echo "$MODELS"

# Neon connectivity (if NEON_DATABASE_URL is set)
if [ -n "${NEON_DATABASE_URL:-}" ]; then
  echo -n "Neon DB: "
  node -e "
    import('@neondatabase/serverless').then(m => {
      const sql = m.neon(process.env.NEON_DATABASE_URL);
      sql\`SELECT 1 as ok\`.then(r => { console.log('OK'); process.exit(0); }).catch(e => { console.log('ERROR:', e.message); process.exit(1); });
    });
  " 2>/dev/null || echo "check failed"
fi

echo "=== End Status ==="
