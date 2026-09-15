#!/bin/bash
# Stop backend (uvicorn) and frontend (vite/npm)

echo "Stopping backend (uvicorn)..."
pkill -f "uvicorn app.main" 2>/dev/null && echo "  Backend stopped." || echo "  Backend was not running."

echo "Stopping frontend (vite)..."
pkill -f "vite" 2>/dev/null && echo "  Frontend stopped." || echo "  Frontend was not running."
