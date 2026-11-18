#!/bin/sh
set -eu

BASE="${BASE:-http://localhost:3990}"
OUT="${1:?usage: check-focus.sh <output folder>}"
SCRATCH="${SCRATCH:-${TMPDIR:-/tmp}/lifeos-local-backend}"
AB="agent-browser --session ${AB_SESSION:-lifeos-check}"
MOTION="${MOTION:-}"

rewind() {
  (cd "$SCRATCH" && CONVEX_AGENT_MODE=anonymous npx convex run scratch:rewindFocus "{\"minutes\": $1}" >/dev/null)
}

press() {
  $AB eval "(() => { const button = [...document.querySelectorAll('[data-focus-pill] button, [data-open-card] button')].find((entry) => entry.getAttribute('aria-label') === '$1'); if (!button) throw new Error('No button named $1'); button.click(); })()" >/dev/null
}

shot() {
  $AB screenshot "$OUT/focus-$1.png" >/dev/null
  echo "$OUT/focus-$1.png"
}

mkdir -p "$OUT"
for size in "1440 900" "390 844"; do
  set -- $size
  $AB set viewport "$1" "$2" >/dev/null
  for theme in light dark; do
    name="$1-$theme${MOTION:+-reduced}"
    $AB set media "$theme" $MOTION >/dev/null
    $AB open "$BASE/today" >/dev/null
    $AB wait 900 >/dev/null
    $AB eval "localStorage.setItem('lifeos.focus-plan', JSON.stringify({ mode: 'pomodoro', focusMinutes: 25, breakMinutes: 5 }))" >/dev/null
    $AB click "#main [data-task-key] [data-arrow-item]" >/dev/null
    $AB press Enter >/dev/null
    $AB wait 500 >/dev/null
    press "Start a Focus Session"
    $AB wait 1300 >/dev/null
    shot "card-$name"
    $AB press Escape >/dev/null
    $AB wait 500 >/dev/null
    shot "list-$name"
    press "Focus options"
    $AB wait 450 >/dev/null
    shot "options-$name"
    $AB press Escape >/dev/null
    press "Pause the Focus Session"
    $AB wait 500 >/dev/null
    shot "paused-$name"
    press "Resume the Focus Session"
    rewind 24.96
    $AB wait 3600 >/dev/null
    shot "done-$name"
    press "Start the break"
    $AB wait 900 >/dev/null
    shot "break-$name"
    rewind 5.1
    $AB wait 1500 >/dev/null
    shot "break-over-$name"
    press "Finish"
    $AB wait 900 >/dev/null
    shot "stopped-$name"
    $AB eval "localStorage.removeItem('lifeos.focus-plan')" >/dev/null
  done
done
