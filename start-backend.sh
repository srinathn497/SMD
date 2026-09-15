#!/bin/bash
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "$0")/backend" && pwd)"
PORT=8000

# ── Kill anything holding port 8000 (catches zombie reload children) ─────────
echo "→ Clearing port $PORT..."
lsof -ti :"$PORT" | xargs kill -9 2>/dev/null && echo "  Killed process(es) on port $PORT" || true

# ── Kill by process name as fallback ─────────────────────────────────────────
pkill -f "uvicorn app.main" 2>/dev/null && echo "  Killed stale uvicorn by name" || true
pkill -f "uvicorn.*8000"    2>/dev/null || true

sleep 1

# ── Verify the port is actually free ─────────────────────────────────────────
if lsof -i :"$PORT" &>/dev/null; then
    echo "ERROR: port $PORT is still in use — cannot start backend" >&2
    lsof -i :"$PORT" >&2
    exit 1
fi

# ── Quick import check before launching ──────────────────────────────────────
echo "→ Checking app imports..."
cd "$BACKEND_DIR"
if ! .venv/bin/python -c "from app.main import app" 2>&1; then
    echo "ERROR: app failed to import — fix the error above before starting" >&2
    exit 1
fi
echo "  Imports OK"

# ── Start ─────────────────────────────────────────────────────────────────────
echo "→ Starting backend on port $PORT..."
.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port "$PORT"
