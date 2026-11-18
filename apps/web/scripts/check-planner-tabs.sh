#!/bin/sh
set -eu

BASE="${BASE:-http://localhost:4010}"
OUT="${1:?usage: check-planner-tabs.sh <output folder>}"
SCRATCH="${SCRATCH:-${TMPDIR:-/tmp}/lifeos-local-backend}"
AB="agent-browser --session ${AB_SESSION:-lifeos-planner-tabs}"
NAMESPACE=$(printf '%s' "${CONVEX_URL:-http://127.0.0.1:3210}" | tr -cd 'a-zA-Z0-9')
FAILED=0

mkdir -p "$OUT"
js() { $AB eval "$1" | sed 's/^"//; s/"$//'; }
expect() {
  if [ "$2" = "$3" ]; then echo "ok    $1"; else echo "FAIL  $1: wanted $3, got $2"; FAILED=1; fi
}
path() { js "location.pathname"; }
selected() { js "document.querySelector('#main [role=tab][aria-selected=true]')?.textContent ?? ''"; }
current() { js "[...document.querySelectorAll('nav [aria-current=page]')].map((item) => item.textContent).join(',')"; }
tab_x() { js "Math.round(document.querySelector('#main [role=tablist]').getBoundingClientRect().x)"; }
tab_y() { js "Math.round(document.querySelector('#main [role=tablist]').getBoundingClientRect().y)"; }
click_tab() { $AB eval "document.querySelector('#main [role=tab][href=\"/$1\"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))" >/dev/null; $AB wait 400 >/dev/null; }

$AB open "$BASE/design" >/dev/null
SIGNED_IN=$(cd "$SCRATCH" && npx convex run scratch:signIn)
$AB eval "(() => { const s = $SIGNED_IN; localStorage.setItem('__convexAuthJWT_$NAMESPACE', s.accessToken); localStorage.setItem('__convexAuthRefreshToken_$NAMESPACE', s.refreshToken); })()" >/dev/null
$AB set viewport 1440 900 >/dev/null
$AB set media light >/dev/null

$AB open "$BASE/planner" >/dev/null
$AB wait 1800 >/dev/null
expect "/planner opens the Planner tab" "$(selected)" "Planner"
expect "the sidebar has one entry for both" "$(js "document.querySelectorAll('nav a[href=\"/upcoming\"]').length")" 0
expect "the sidebar marks Planner" "$(current)" "Planner"
X=$(tab_x); Y=$(tab_y)

click_tab upcoming
expect "a click opens Upcoming" "$(path)" "/upcoming"
expect "the Upcoming tab is selected" "$(selected)" "Upcoming"
expect "the sidebar still marks Planner" "$(current)" "Planner"
expect "the tabs stay put (x)" "$(tab_x)" "$X"
expect "the tabs stay put (y)" "$(tab_y)" "$Y"
expect "the date list shows" "$(js "document.querySelectorAll('#planner-panel section h2').length > 0")" "true"

$AB eval "history.back()" >/dev/null
$AB wait 500 >/dev/null
expect "Back returns to the Planner tab" "$(path)-$(selected)" "/planner-Planner"
$AB eval "history.forward()" >/dev/null
$AB wait 500 >/dev/null
expect "Forward returns to the Upcoming tab" "$(path)-$(selected)" "/upcoming-Upcoming"

$AB eval "document.querySelector('#main').focus()" >/dev/null
$AB press 8 >/dev/null
$AB wait 300 >/dev/null
expect "8 opens the Planner tab" "$(path)-$(selected)" "/planner-Planner"
$AB press 3 >/dev/null
$AB wait 300 >/dev/null
expect "3 opens the Upcoming tab" "$(path)-$(selected)" "/upcoming-Upcoming"

$AB eval "document.querySelector('#main [role=tab][aria-selected=true]').focus()" >/dev/null
$AB press ArrowLeft >/dev/null
$AB wait 300 >/dev/null
expect "Left Arrow flips to Planner" "$(path)-$(selected)" "/planner-Planner"
expect "focus follows the tab" "$(js "document.activeElement?.textContent ?? ''")" "Planner"
$AB press ArrowRight >/dev/null
$AB wait 300 >/dev/null
expect "Right Arrow flips to Upcoming" "$(path)-$(selected)" "/upcoming-Upcoming"

$AB open "$BASE/upcoming" >/dev/null
$AB wait 1500 >/dev/null
expect "/upcoming opens the Upcoming tab" "$(selected)" "Upcoming"

for size in "1440 900" "390 844"; do
  set -- $size
  $AB set viewport "$1" "$2" >/dev/null
  for theme in light dark; do
    $AB set media "$theme" >/dev/null
    for tab in planner upcoming; do
      $AB open "$BASE/$tab" >/dev/null
      $AB wait 1200 >/dev/null
      $AB screenshot "$OUT/tabs-$tab-$1-$theme.png" >/dev/null
      echo "$OUT/tabs-$tab-$1-$theme.png"
    done
  done
done
$AB close >/dev/null
exit $FAILED
