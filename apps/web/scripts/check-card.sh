#!/bin/sh
set -eu

BASE="${BASE:-http://localhost:3990}"
OUT="${1:?usage: check-card.sh <output folder>}"
AB="agent-browser --session ${AB_SESSION:-lifeos-check}"

mkdir -p "$OUT"
for size in "1440 900" "390 844"; do
  set -- $size
  $AB set viewport "$1" "$2" >/dev/null
  for theme in light dark; do
    $AB set media "$theme" >/dev/null
    $AB open "$BASE/today" >/dev/null
    $AB wait 900 >/dev/null
    $AB click "#main [data-task-key] [data-arrow-item]" >/dev/null
    $AB press Enter >/dev/null
    $AB wait 600 >/dev/null
    $AB screenshot "$OUT/card-$1-$theme.png" >/dev/null
    $AB eval "[...document.querySelectorAll('[data-open-card] button')].find((button) => button.textContent.includes('Labels') || button.getAttribute('aria-label') === 'Labels').click()" >/dev/null
    $AB wait 400 >/dev/null
    $AB eval "document.querySelector('[aria-label^=\"Edit \"]')?.click()" >/dev/null
    $AB wait 300 >/dev/null
    $AB screenshot "$OUT/labels-$1-$theme.png" >/dev/null
    $AB press Escape >/dev/null
    $AB press Escape >/dev/null
    echo "$OUT/card-$1-$theme.png $OUT/labels-$1-$theme.png"
  done
done
