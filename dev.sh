#!/bin/bash

# Usage: ./dev.sh [backend] [frontend] [whatsapp]
# Defaults to all three if no args given.

ROOT="$(cd "$(dirname "$0")" && pwd)"
PIDS=()

cleanup() {
  echo ""
  echo "Shutting down..."
  kill "${PIDS[@]}" 2>/dev/null
  exit 0
}

trap cleanup SIGINT SIGTERM

usage() {
  echo "Usage: $0 [backend] [frontend] [whatsapp]"
  echo "  Pass one or more service names, or no args to start all."
  exit 1
}

# Default to all if no args
if [ $# -eq 0 ]; then
  SERVICES="backend frontend whatsapp"
else
  SERVICES="$*"
fi

for svc in $SERVICES; do
  case "$svc" in
    backend)
      echo "Starting backend..."
      cd "$ROOT/backend"
      uvicorn api.main:app --reload --port 8000 &
      PIDS+=($!)
      ;;
    frontend)
      echo "Starting frontend..."
      cd "$ROOT/frontend"
      npm run dev &
      PIDS+=($!)
      ;;
    whatsapp)
      echo "Starting WhatsApp bot..."
      cd "$ROOT/backend/whatsapp"
      npm run dev &
      PIDS+=($!)
      ;;
    *)
      echo "Unknown service: $svc"
      usage
      ;;
  esac
done

echo ""
[[ "$SERVICES" == *backend*  ]] && echo "Backend:   http://localhost:8000"
[[ "$SERVICES" == *frontend* ]] && echo "Frontend:  http://localhost:3000"
[[ "$SERVICES" == *whatsapp* ]] && echo "WhatsApp:  bot running"
echo ""
echo "Press Ctrl+C to stop."

wait "${PIDS[@]}"
