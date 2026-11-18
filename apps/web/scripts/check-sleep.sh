#!/bin/sh
set -eu

BASE="${BASE:-http://localhost:3990}"
OUT="${1:?usage: check-sleep.sh <output folder>}"
SCRATCH="${SCRATCH:-${TMPDIR:-/tmp}/lifeos-local-backend}"
AB="agent-browser --session ${AB_SESSION:-lifeos-sleep-check}"
NAMESPACE=$(printf '%s' "${CONVEX_URL:-http://127.0.0.1:3210}" | tr -cd 'a-zA-Z0-9')
FAILED=0

mkdir -p "$OUT"
js() { $AB eval "$1" | sed 's/^"//; s/"$//'; }
expect() {
  if [ "$2" = "$3" ]; then echo "ok    $1"; else echo "FAIL  $1: wanted $3, got $2"; FAILED=1; fi
}
scrollTo() { js "document.querySelector('[data-plan-scroll=timebox]').scrollTo({ top: $1 * 56 })" >/dev/null; $AB wait 250 >/dev/null; }
shot() { $AB screenshot "$OUT/sleep-$1.png" >/dev/null; echo "$OUT/sleep-$1.png"; }
view() { js "[...document.querySelectorAll('[role=radiogroup][aria-label=\"Timebox view\"] [role=radio], [aria-label=\"Timebox view\"] button')].find((b) => b.textContent.trim() === '$1')?.click()" >/dev/null; $AB wait 500 >/dev/null; }

$AB open "$BASE/design" >/dev/null
SIGNED_IN=$(cd "$SCRATCH" && npx convex run scratch:signIn)
$AB eval "(() => { const s = $SIGNED_IN; localStorage.setItem('__convexAuthJWT_$NAMESPACE', s.accessToken); localStorage.setItem('__convexAuthRefreshToken_$NAMESPACE', s.refreshToken); })()" >/dev/null
$AB set viewport 1440 900 >/dev/null

for theme in light dark; do
  $AB set media "$theme" >/dev/null
  $AB open "$BASE/planner" >/dev/null
  $AB wait 1800 >/dev/null
  view Day
  expect "$theme: the day shows last night's sleep and tonight's Sleep Window" "$(js "document.querySelectorAll('[data-sleep]').length")" 2
  expect "$theme: last night is what Oura recorded" "$(js "document.querySelector('[data-sleep]')?.dataset.sleep ?? ''")" slept
  scrollTo 0
  shot "day-morning-$theme"
  scrollTo 15
  shot "day-evening-$theme"
  view Week
  [ "$(js "document.querySelectorAll('[data-sleep]').length")" -ge 8 ] && echo "ok    $theme: the week draws a band each morning and evening" || { echo "FAIL  $theme: the week is missing sleep bands"; FAILED=1; }
  expect "$theme: past mornings are slept, future nights are planned" "$(js "[...new Set([...document.querySelectorAll('[data-sleep]')].map((b) => b.dataset.sleep))].sort().join(',')")" "planned,slept"
  scrollTo 14.5
  shot "week-evening-$theme"
  scrollTo 0
  shot "week-morning-$theme"
  js "document.querySelector('button[aria-label=Sleep]')?.click()" >/dev/null
  $AB wait 400 >/dev/null
  expect "$theme: the Sleep panel names Oura's bedtime" "$(js "document.body.innerText.includes(\"Oura's bedtime\") ? 'yes' : 'no'")" yes
  shot "panel-$theme"
  $AB press Escape >/dev/null
done

$AB close >/dev/null
exit "$FAILED"
