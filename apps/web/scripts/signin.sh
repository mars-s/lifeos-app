#!/bin/sh
set -eu

BASE="${BASE:-http://localhost:3990}"
SESSION="${SESSION:?set SESSION to the session.json that local-backend.sh wrote}"
AB="agent-browser --session ${AB_SESSION:-lifeos-check}"
NAMESPACE=$(printf '%s' "${CONVEX_URL:-http://127.0.0.1:3210}" | tr -cd 'a-zA-Z0-9')

$AB open "$BASE/design" >/dev/null
$AB eval "(() => { const s = $(cat "$SESSION"); localStorage.setItem('__convexAuthJWT_$NAMESPACE', s.accessToken); localStorage.setItem('__convexAuthRefreshToken_$NAMESPACE', s.refreshToken); })()" >/dev/null
$AB open "$BASE/${1:-today}" >/dev/null
$AB wait 1500 >/dev/null
