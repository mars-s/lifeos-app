#!/bin/sh
set -eu

BASE="${BASE:-http://localhost:3990}"
OUT="${1:?usage: check-focus-plan.sh <output folder>}"
SCRATCH="${SCRATCH:-${TMPDIR:-/tmp}/lifeos-local-backend}"
AB="agent-browser --session ${AB_SESSION:-lifeos-check}"

convex() {
  (cd "$SCRATCH" && CONVEX_AGENT_MODE=anonymous npx convex "$@")
}

press() {
  $AB eval "(() => { const button = [...document.querySelectorAll('[data-focus-pill] button, [data-open-card] button')].find((entry) => entry.getAttribute('aria-label') === '$1'); if (!button) throw new Error('No button named $1'); button.click(); })()" >/dev/null
}

shot() {
  $AB screenshot "$OUT/plan-$1.png" >/dev/null
  echo "$OUT/plan-$1.png"
}

mkdir -p "$OUT"
convex run scratch:focusPlan '{"mode": "pomodoro"}' >/dev/null
for size in "1440 900" "390 844"; do
  set -- $size
  $AB set viewport "$1" "$2" >/dev/null
  for theme in light dark; do
    name="$1-$theme"
    $AB set media "$theme" >/dev/null
    $AB open "$BASE/today" >/dev/null
    $AB wait 900 >/dev/null
    $AB click "#main [data-task-key] [data-arrow-item]" >/dev/null
    $AB press Enter >/dev/null
    $AB wait 500 >/dev/null
    press "Start a Focus Session"
    $AB press Escape >/dev/null
    $AB wait 600 >/dev/null
    echo "title: $($AB eval 'document.title')"
    press "Focus options"
    $AB wait 450 >/dev/null
    $AB fill "input[aria-label='Focus length in minutes']" "40" >/dev/null
    $AB press Enter >/dev/null
    $AB wait 600 >/dev/null
    shot "typed-$name"
    $AB press Escape >/dev/null
    press "Stop the Focus Session"
    $AB wait 600 >/dev/null
  done
done
convex run scratch:focusPlan '{"mode": "open"}' >/dev/null
