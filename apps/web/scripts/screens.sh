#!/bin/sh
set -eu

BASE="${BASE:-http://localhost:3960}"
OUT="${1:?usage: screens.sh <output folder> [list ...]}"
shift
LISTS="${*:-today inbox upcoming anytime someday logbook area project}"
AB="agent-browser --session lifeos-screens"

mkdir -p "$OUT"
$AB open "$BASE/design" >/dev/null
if [ -n "${SESSION:-}" ]; then
  NAMESPACE=$(printf '%s' "${CONVEX_URL:-http://127.0.0.1:3210}" | tr -cd 'a-zA-Z0-9')
  $AB eval "(() => { const s = $(cat "$SESSION"); localStorage.setItem('__convexAuthJWT_$NAMESPACE', s.accessToken); localStorage.setItem('__convexAuthRefreshToken_$NAMESPACE', s.refreshToken); })()" >/dev/null
fi
$AB open "$BASE/today" >/dev/null
$AB wait 1500 >/dev/null
AREA=$($AB eval 'document.querySelector("nav a[href^=\"/area\"]")?.getAttribute("href") ?? ""' | tr -d '"')
PROJECT=$($AB eval 'document.querySelector("nav a[href^=\"/project\"]")?.getAttribute("href") ?? ""' | tr -d '"')

for size in "1440 900" "390 844"; do
  set -- $size
  $AB set viewport "$1" "$2" >/dev/null
  for theme in light dark; do
    $AB set media "$theme" >/dev/null
    for list in $LISTS; do
      case "$list" in
        area) path="$AREA" ;;
        project) path="$PROJECT" ;;
        *) path="/$list" ;;
      esac
      [ -n "$path" ] || continue
      $AB open "$BASE$path" >/dev/null
      $AB wait 900 >/dev/null
      $AB screenshot "$OUT/$list-$1-$theme.png" >/dev/null
      echo "$OUT/$list-$1-$theme.png"
    done
  done
done
$AB close >/dev/null
