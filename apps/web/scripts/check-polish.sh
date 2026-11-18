#!/bin/sh
set -eu

BASE="${BASE:-http://localhost:3990}"
OUT="${1:?usage: check-polish.sh <output folder>}"
AB="agent-browser --session ${AB_SESSION:-lifeos-check}"
say() {
  echo "check-polish: $1"
}
titles() {
  $AB eval "[...document.querySelectorAll('#main [data-task-key]')].slice(0, 4).map((row) => row.querySelector('[data-arrow-item], input')?.textContent || row.querySelector('input')?.value).join(' | ')"
}

mkdir -p "$OUT"
$AB set viewport 1440 900 >/dev/null
$AB open "$BASE/inbox" >/dev/null
$AB wait 900 >/dev/null

say "new Task in the same frame: $($AB eval "(() => { const before = document.querySelectorAll('#main [data-task-key]').length; window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true })); return new Promise((done) => queueMicrotask(() => requestAnimationFrame(() => done(document.querySelectorAll('#main [data-task-key]').length - before + ' row added, title focused: ' + (document.activeElement?.getAttribute('aria-label') === 'Title'))))); })()")"
$AB screenshot "$OUT/new-task.png" >/dev/null
$AB keyboard type "Renew the passport" >/dev/null
$AB wait 900 >/dev/null
say "typing survived the save: $($AB eval "document.activeElement?.value")"
$AB press Escape >/dev/null
$AB wait 600 >/dev/null
say "last row after closing: $($AB eval "[...document.querySelectorAll('#main [data-task-key] [data-arrow-item]')].at(-1)?.textContent")"
$AB screenshot "$OUT/new-task-closed.png" >/dev/null

say "order before: $(titles)"
$AB eval "(() => { const rows = [...document.querySelectorAll('#main [data-task-key]')]; const a = rows[0].getBoundingClientRect(); const b = rows[2].getBoundingClientRect(); window.__drag = { x: a.left + 200, from: a.top + a.height / 2, to: b.top + b.height / 2 + 6 }; })()" >/dev/null
X=$($AB eval "Math.round(window.__drag.x)")
FROM=$($AB eval "Math.round(window.__drag.from)")
TO=$($AB eval "Math.round(window.__drag.to)")
$AB mouse move "$X" "$FROM" >/dev/null
$AB mouse down >/dev/null
$AB mouse move "$X" "$((FROM + 10))" >/dev/null
$AB mouse move "$X" "$(((FROM + TO) / 2))" >/dev/null
$AB screenshot "$OUT/drag-task.png" >/dev/null
$AB mouse move "$X" "$TO" >/dev/null
$AB mouse up >/dev/null
$AB wait 700 >/dev/null
say "order after dragging the first row below the third: $(titles)"

$AB click "#main [data-task-key] [data-arrow-item]" >/dev/null
$AB press Meta+ArrowDown >/dev/null
$AB wait 400 >/dev/null
say "order after Cmd+Down on the first row: $(titles)"

$AB eval "document.querySelector('#main [data-task-key] [role=checkbox]').click()" >/dev/null
$AB wait 1500 >/dev/null
$AB screenshot "$OUT/row-leaving.png" >/dev/null
$AB wait 900 >/dev/null
say "rows after completing one: $($AB eval "document.querySelectorAll('#main [data-task-key]').length")"

$AB eval "(() => { const rows = [...document.querySelectorAll('nav [data-menu-project]')]; const a = rows[1].getBoundingClientRect(); const b = rows[2].getBoundingClientRect(); window.__drag = { x: a.left + 60, from: a.top + a.height / 2, to: b.top + b.height / 2 + 4 }; })()" >/dev/null
say "sidebar Projects before: $($AB eval "[...document.querySelectorAll('nav [data-menu-project]')].map((row) => row.textContent).join(' | ')")"
X=$($AB eval "Math.round(window.__drag.x)")
FROM=$($AB eval "Math.round(window.__drag.from)")
TO=$($AB eval "Math.round(window.__drag.to)")
$AB mouse move "$X" "$FROM" >/dev/null
$AB mouse down >/dev/null
$AB mouse move "$X" "$((FROM + 10))" >/dev/null
$AB mouse move "$X" "$TO" >/dev/null
$AB screenshot "$OUT/drag-project.png" >/dev/null
$AB mouse up >/dev/null
$AB wait 700 >/dev/null
say "sidebar Projects after dragging the second below the third: $($AB eval "[...document.querySelectorAll('nav [data-menu-project]')].map((row) => row.textContent).join(' | ')")"

say "Areas before: $($AB eval "[...document.querySelectorAll('nav [data-menu-area] > div:first-child')].map((row) => row.textContent).join(' | ')")"
$AB eval "document.querySelector('nav [data-menu-area] a').focus()" >/dev/null
$AB press Meta+ArrowDown >/dev/null
$AB wait 500 >/dev/null
say "Areas after Cmd+Down on the first: $($AB eval "[...document.querySelectorAll('nav [data-menu-area] > div:first-child')].map((row) => row.textContent).join(' | ')")"
