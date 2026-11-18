#!/bin/sh
set -eu

BASE="${BASE:-http://localhost:3990}"
OUT="${1:?usage: check-boundaries.sh <output folder>}"
AB="agent-browser --session ${AB_SESSION:-lifeos-check}"

mkdir -p "$OUT"
$AB set viewport 1440 900 >/dev/null
for fault in today sidebar labels things; do
  $AB open "$BASE/today?__fail=$fault" >/dev/null
  $AB wait 1200 >/dev/null
  $AB screenshot "$OUT/fail-$fault.png" >/dev/null
  echo "check-boundaries: $fault missing, sidebar rows $($AB eval "document.querySelectorAll('nav a').length"), list rows $($AB eval "document.querySelectorAll('#main [data-task-key]').length"), notices $($AB eval "[...document.querySelectorAll('[role=alert]')].map((notice) => notice.textContent).join(' / ')")"
done
