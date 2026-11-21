#!/bin/sh
set -eu

SESSION="${SESSION:?set SESSION to the session.json that apps/web/scripts/local-backend.sh wrote}"
CONVEX_URL="${CONVEX_URL:-http://127.0.0.1:3210}"
PORT="${PORT:-8082}"

cd "$(dirname "$0")/.."
EXPO_PUBLIC_DEV_CONVEX_URL="$CONVEX_URL" EXPO_PUBLIC_DEV_SESSION="$(cat "$SESSION")" exec npx expo start --dev-client --port "$PORT" --clear
