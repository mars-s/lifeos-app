#!/bin/sh
set -eu

BASE="${BASE:-http://localhost:3990}"
OUT="${1:?usage: check-trash.sh <output folder>}"
AB="agent-browser --session ${AB_SESSION:-lifeos-check}"
menu_item() {
  $AB eval "[...document.querySelectorAll('[role=menuitem]')].find((item) => item.textContent.includes('$1')).click()" >/dev/null
}
right_click() {
  $AB eval "(() => { const el = document.querySelector('$1'); const box = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: box.left + 40, clientY: box.top + 10, detail: 1 })); })()" >/dev/null
  $AB wait 300 >/dev/null
}
count() {
  $AB eval "document.querySelectorAll('$1').length"
}
say() {
  echo "check-trash: $1"
}

mkdir -p "$OUT"
$AB set viewport 1440 900 >/dev/null
$AB open "$BASE/inbox" >/dev/null
$AB wait 900 >/dev/null
$AB click "#main [data-task-key] [data-arrow-item]" >/dev/null
$AB press Backspace >/dev/null
$AB wait 500 >/dev/null
right_click "nav [data-menu-area] a"
$AB screenshot "$OUT/area-menu.png" >/dev/null
menu_item "Move Area to Trash"
$AB wait 600 >/dev/null

$AB open "$BASE/trash" >/dev/null
$AB wait 900 >/dev/null
say "rows in Trash: $(count '#main [data-menu-trash]')"
$AB screenshot "$OUT/trash.png" >/dev/null

right_click "#main [data-menu-trash^=task]"
$AB screenshot "$OUT/trash-menu.png" >/dev/null
menu_item "Delete Forever"
$AB wait 400 >/dev/null
$AB screenshot "$OUT/trash-confirm.png" >/dev/null
$AB press Escape >/dev/null
$AB wait 300 >/dev/null

$AB click "#main [data-menu-trash^=area] [data-arrow-item]" >/dev/null
$AB wait 700 >/dev/null
say "rows after putting the Area back: $(count '#main [data-menu-trash]')"
say "Areas in the sidebar: $(count 'nav [data-menu-area]')"
$AB screenshot "$OUT/trash-put-back.png" >/dev/null
$AB eval "[...document.querySelectorAll('[data-toaster] button')].find((button) => button.textContent.includes('Undo'))?.click()" >/dev/null
$AB wait 700 >/dev/null
say "rows after undo: $(count '#main [data-menu-trash]')"

$AB eval "[...document.querySelectorAll('#main button')].find((button) => button.textContent.includes('Empty Trash')).click()" >/dev/null
$AB wait 400 >/dev/null
$AB screenshot "$OUT/trash-empty-confirm.png" >/dev/null
$AB eval "[...document.querySelectorAll('[role=alertdialog] button')].find((button) => button.textContent.includes('Empty Trash')).click()" >/dev/null
$AB wait 1200 >/dev/null
say "rows after Empty Trash: $(count '#main [data-menu-trash]')"
$AB screenshot "$OUT/trash-empty.png" >/dev/null
