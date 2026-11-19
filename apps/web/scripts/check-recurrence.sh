#!/bin/sh
set -eu

BASE="${BASE:-http://localhost:3990}"
OUT="${1:?usage: check-recurrence.sh <output folder>}"
AB="agent-browser --session ${AB_SESSION:-lifeos-check}"
NAME=""

say() {
  echo "check-recurrence: $1"
}

shot() {
  $AB screenshot "$OUT/$1-$NAME.png" >/dev/null
  echo "$OUT/$1-$NAME.png"
}

js() {
  $AB eval "$1" >/dev/null
}

expect() {
  if js "(() => { if (!($1)) throw new Error('check failed'); })()"; then
    say "ok, $2"
  else
    say "FAILED, $2"
    exit 1
  fi
}

tag() {
  js "(() => { document.querySelectorAll('[data-check]').forEach((el) => el.removeAttribute('data-check')); const el = [...document.querySelectorAll('$1')].find((each) => (each.getAttribute('aria-label') || each.textContent.trim()).startsWith('$2') && each.offsetParent !== null); if (!el) throw new Error('No $1 starting with $2'); el.setAttribute('data-check', ''); el.scrollIntoView({ block: 'center' }); })()"
}

press() {
  tag "$1" "$2"
  $AB click '[data-check]' >/dev/null
  $AB wait "${3:-400}" >/dev/null
}

menu_item() {
  js "[...document.querySelectorAll('[role=menuitem]')].find((item) => item.textContent.trim().startsWith('$1')).click()"
  $AB wait 450 >/dev/null
}

open_submenu() {
  tag "[role=menuitem]" "$1"
  $AB hover '[data-check]' >/dev/null
  $AB wait 450 >/dev/null
}

right_click() {
  tag "$1" "$2"
  js "(() => { const el = document.querySelector('[data-check]'); const box = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: box.left + 60, clientY: box.top + 12, detail: 1 })); })()"
  $AB wait 450 >/dev/null
}

undo() {
  js "[...document.querySelectorAll('[data-toaster] button')].find((button) => button.textContent.includes('Undo')).click()"
  $AB wait 900 >/dev/null
}

row() {
  echo "[...document.querySelectorAll('#main [data-task-key]')].find((el) => el.textContent.includes('$1'))"
}

open_card() {
  press "#main [data-task-key] [data-arrow-item]" "$1" 300
  $AB press Enter >/dev/null
  $AB wait 600 >/dev/null
}

close_card() {
  $AB press Escape >/dev/null
  $AB wait 500 >/dev/null
}

repeat_label() {
  echo "document.querySelector('[data-open-card] button[aria-label^=Repeat]').getAttribute('aria-label')"
}

card_repeat() {
  open_card "Book a physio appointment"
  $AB click '[data-open-card] button[aria-label^=Repeat]' >/dev/null
  $AB wait 450 >/dev/null
  shot card-repeat-list
  press "[data-radix-popper-content-wrapper] button" "Every weekday" 900
  expect "$(repeat_label) === 'Repeat: Every weekday'" "the card's Repeat becomes a chip reading Every weekday"
  shot card-repeat-chip
  $AB click '[data-open-card] button[aria-label^=Repeat]' >/dev/null
  $AB wait 450 >/dev/null
  expect "document.querySelector('[data-radix-popper-content-wrapper]').textContent.includes('Next:')" "the popover says when the next one comes"
  shot card-repeat-next
  $AB press Escape >/dev/null
  $AB wait 300 >/dev/null
  undo
  expect "$(repeat_label) === 'Repeat'" "undo stops the new repeat"

  $AB click '[data-open-card] button[aria-label^=Repeat]' >/dev/null
  $AB wait 450 >/dev/null
  press "[data-radix-popper-content-wrapper] button" "Custom" 400
  shot card-custom
  press "[data-radix-popper-content-wrapper] [role=radio]" "Month" 300
  press "[data-radix-popper-content-wrapper] [role=radio]" "On the third" 300
  press "[role=radiogroup][aria-label=Ends] [role=radio]" "After" 300
  press "[data-radix-popper-content-wrapper] button" "More: How many times" 200
  shot card-custom-month
  press "[data-radix-popper-content-wrapper] button" "Repeat" 900
  expect "$(repeat_label) === 'Repeat: Every month on the third Thu, 6 times'" "Custom saves a monthly repeat that ends after six"
  undo
  expect "$(repeat_label) === 'Repeat'" "undo clears the custom repeat"

  $AB click '[data-open-card] button[aria-label^=Repeat]' >/dev/null
  $AB wait 450 >/dev/null
  press "[data-radix-popper-content-wrapper] button" "After I finish it" 400
  press "[data-radix-popper-content-wrapper] button" "More: How long after" 200
  press "[data-radix-popper-content-wrapper] button" "More: How long after" 200
  shot card-custom-after
  press "[role=radiogroup][aria-label=Ends] [role=radio]" "On a date" 300
  shot card-custom-until
  $AB press Escape >/dev/null
  $AB wait 300 >/dev/null
  close_card
}

row_glyph() {
  expect "$(row 'Read two papers on retrieval').textContent.includes('repeats every weekday')" "a repeating row names its repeat"
  shot row-glyph
}

menu_repeat() {
  right_click "#main [data-task-key]" "Pick up the parcel"
  open_submenu "Repeat"
  shot menu-repeat
  menu_item "Every day"
  expect "$(row 'Pick up the parcel').textContent.includes('repeats every day')" "the context menu sets Every day"
  undo
  expect "!$(row 'Pick up the parcel').textContent.includes('repeats')" "undo takes the repeat back off"
  right_click "#main [data-task-key]" "Pick up the parcel"
  open_submenu "Repeat"
  menu_item "Custom"
  $AB wait 300 >/dev/null
  shot menu-custom
  press "[data-radix-popper-content-wrapper] [role=radio]" "Day" 200
  press "[data-radix-popper-content-wrapper] button" "More: How often" 200
  press "[data-radix-popper-content-wrapper] button" "Repeat" 900
  expect "$(row 'Pick up the parcel').textContent.includes('repeats every 2 days')" "Custom from the context menu repeats that Task every 2 days"
  undo
  expect "!$(row 'Pick up the parcel').textContent.includes('repeats')" "undo takes it off again"
}

upcoming_ghost() {
  $AB open "$BASE/upcoming" >/dev/null
  $AB wait 1200 >/dev/null
  expect "document.querySelectorAll('#main [data-menu-occurrence]').length >= 2" "Upcoming shows each rule's next occurrence"
  tag "#main [data-menu-occurrence] button" "Repeats next: Send Gary"
  shot upcoming-ghost
  $AB click '[data-check]' >/dev/null
  $AB wait 450 >/dev/null
  shot ghost-menu
  BEFORE=$($AB eval "document.querySelector('[data-check]').closest('[data-menu-occurrence]').dataset.occurrenceDate")
  menu_item "Skip This One"
  $AB wait 600 >/dev/null
  expect "[...document.querySelectorAll('#main [data-menu-occurrence]')].every((el) => !el.textContent.includes('Send Gary') || el.dataset.occurrenceDate !== $BEFORE)" "Skip moves the occurrence on"
  shot ghost-skipped
  undo
  expect "[...document.querySelectorAll('#main [data-menu-occurrence]')].some((el) => el.textContent.includes('Send Gary') && el.dataset.occurrenceDate === $BEFORE)" "undo brings the skipped occurrence back"
  press "#main [data-menu-occurrence] button" "Repeats next: Send Gary" 450
  menu_item "Stop Repeating"
  expect "![...document.querySelectorAll('#main [data-menu-occurrence]')].some((el) => el.textContent.includes('Send Gary'))" "Stop Repeating removes the occurrence"
  undo
  expect "[...document.querySelectorAll('#main [data-menu-occurrence]')].some((el) => el.textContent.includes('Send Gary'))" "undo starts it again"
}

template_row() {
  echo "[...document.querySelectorAll('#main [data-template-id]')].find((el) => el.textContent.includes('$1') || [...el.querySelectorAll('input')].some((input) => input.value === '$1'))"
}

templates_named() {
  echo "[...document.querySelectorAll('#main [data-template-id]')].filter((el) => el.textContent.includes('$1')).length"
}

fill() {
  tag "$1" "$2"
  js "(() => { const el = document.querySelector('[data-check]'); el.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '$3'); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()"
  $AB wait 700 >/dev/null
}

input_named() {
  echo "[...document.querySelectorAll('#main [data-template-id] input')].some((input) => input.value === '$1')"
}

go() {
  js "document.querySelector('nav a[href=\"/$1\"]').click()"
  $AB wait 900 >/dev/null
}

templates() {
  go today
  right_click "#main [data-task-key]" "Draft the thesis outline"
  shot menu-task-template
  menu_item "Save as Template"
  go templates
  SAVED=$($AB eval "$(templates_named 'Draft the thesis outline')")
  expect "$SAVED > 0" "Save as Template adds the Task to Templates"
  shot templates-list
  undo
  expect "$(templates_named 'Draft the thesis outline') === $SAVED - 1" "undo takes the new Template away"

  press "#main [data-template-id] [data-arrow-item]" "Invoice a client" 700
  shot template-open
  fill "#main [data-template-id] input[name=title]" "Title" "Invoice Harry"
  expect "$(input_named 'Invoice Harry')" "the title saves on Enter"
  undo
  expect "$(input_named 'Invoice a client')" "undo restores the title"
  fill "#main [data-template-id] input[name=new-checklist-item]" "Add a Checklist Item" "Attach the timesheet"
  expect "$(input_named 'Attach the timesheet')" "a Checklist Item joins the Template"
  undo
  expect "!$(input_named 'Attach the timesheet')" "undo removes it"

  $AB click '#main [data-template-id] button[aria-label^=Deadline]' >/dev/null
  $AB wait 450 >/dev/null
  shot template-deadline
  press "[data-radix-popper-content-wrapper] button" "14d" 700
  expect "$(template_row 'Invoice a client').textContent.includes('Due 14 days later')" "the Deadline offset becomes 14 days"
  $AB press Escape >/dev/null
  $AB wait 300 >/dev/null
  undo
  expect "$(template_row 'Invoice a client').textContent.includes('Due 7 days later')" "undo puts it back to 7 days"

  $AB click '#main [data-template-id] button[aria-label^="Area or Project"]' >/dev/null
  $AB wait 450 >/dev/null
  shot template-home
  press "[data-radix-popper-content-wrapper] button" "Korvant" 700
  expect "$(template_row 'Invoice a client').textContent.includes('Korvant')" "the Template moves to Korvant"
  undo
  expect "$(template_row 'Invoice a client').textContent.includes('Paperless')" "undo moves it home"

  press "#main [data-template-id] button" "Delete Template" 700
  expect "$(template_row 'Invoice a client') === undefined" "Delete Template removes it"
  shot templates-deleted
  undo
  expect "$(template_row 'Invoice a client') !== undefined" "undo brings it back"

  go today
  right_click "#main h1" "Today"
  open_submenu "New Task from Template"
  shot menu-from-template
  menu_item "Weekly review"
  $AB wait 600 >/dev/null
  expect "document.querySelector('[data-open-card] input[name=title]').value === 'Weekly review'" "New Task from Template opens the new Task at once"
  expect "document.querySelector('[data-open-card]').textContent.includes('Look over each Area')" "the new Task has the Template's Checklist"
  shot new-from-template
  close_card
  undo
  expect "!document.querySelector('#main').textContent.includes('Weekly review')" "undo removes the new Task"
}

mkdir -p "$OUT"
for size in "1440 900" "390 844"; do
  set -- $size
  $AB set viewport "$1" "$2" >/dev/null
  for theme in light dark; do
    NAME="$1-$theme"
    $AB set media "$theme" >/dev/null
    $AB open "$BASE/today" >/dev/null
    $AB wait 1200 >/dev/null
    card_repeat
    row_glyph
    menu_repeat
    upcoming_ghost
    templates
  done
done
