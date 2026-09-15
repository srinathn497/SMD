#!/bin/bash
# Kill any stale Vite processes — by port (reliable) then by name (fallback)
lsof -ti :5173 | xargs kill -9 2>/dev/null && echo "Killed process on port 5173" || true
lsof -ti :5174 | xargs kill -9 2>/dev/null && echo "Killed process on port 5174" || true
pkill -f "node.*vite" 2>/dev/null || true
sleep 1

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use v18.20.8 || { echo "ERROR: Node v18.20.8 not found. Run: nvm install v18.20.8"; exit 1; }
cd "$(dirname "$0")/frontend"
npm run dev
