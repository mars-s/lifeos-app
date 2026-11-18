#!/bin/sh
set -eu

BASE="${BASE:-http://localhost:4010}"
OUT="${1:?usage: check-planner.sh <output folder>}"
SCRATCH="${SCRATCH:-${TMPDIR:-/tmp}/lifeos-local-backend}"
THEME="${THEME:-light}"
MOTION="${MOTION:-}"
AB="agent-browser --session ${AB_SESSION:-lifeos-planner-check}"
NAMESPACE=$(printf '%s' "${CONVEX_URL:-http://127.0.0.1:3210}" | tr -cd 'a-zA-Z0-9')
TAG="$THEME${MOTION:+-reduced}"
FAILED=0

mkdir -p "$OUT"
shot() { $AB screenshot "$OUT/planner-$1-$TAG.png" >/dev/null; echo "$OUT/planner-$1-$TAG.png"; }
js() { $AB eval "$1" | sed 's/^"//; s/"$//'; }
expect() {
  if [ "$2" = "$3" ]; then echo "ok    $1"; else echo "FAIL  $1: wanted $3, got $2"; FAILED=1; fi
}
drag() {
  $AB mouse move "$1" "$2" >/dev/null
  $AB mouse down >/dev/null
  $AB mouse move "$(($1 + 4))" "$(($2 + 8))" >/dev/null
  $AB mouse move "$((($1 + $3) / 2))" "$((($2 + $4) / 2))" >/dev/null
  $AB mouse move "$(($3 - 2))" "$(($4 - 3))" >/dev/null
  $AB mouse move "$3" "$4" >/dev/null
  $AB wait 350 >/dev/null
}
centre() { js "(() => { const box = ($1)?.getBoundingClientRect(); return box ? Math.round(box.x + box.width / 2) + ' ' + Math.round(box.y + ${2:-box.height / 2}) : '' })()"; }
count() { js "document.querySelectorAll('$1').length"; }
toast() { js "document.querySelector('[data-toaster]')?.innerText.split('\\n')[0] ?? ''"; }
LAST="[...document.querySelectorAll('[data-block-id]')].at(-1)"
label() { js "$LAST?.getAttribute('aria-label')?.split('. ')[0] ?? ''"; }
planned() { js "document.querySelector('[data-plan-day=\"$1\"] [role=meter]')?.getAttribute('aria-valuenow') ?? ''"; }
reseed() { (cd "$SCRATCH" && npx convex run scratch:seed "{\"today\":\"$(date +%F)\",\"timeZone\":\"$(node -e 'console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)')\"}" >/dev/null); }

TODAY=$(date +%F)
TOMORROW=$(node -e 'const d = new Date(); d.setDate(d.getDate() + 1); console.log([d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-"))')
DUMP='[data-plan-list=inbox] [data-task-key]'
DAY="[data-plan-list=\"day:$TODAY\"] [data-task-key]"
NEXT="[data-plan-list=\"day:$TOMORROW\"] [data-task-key]"

reseed
$AB open "$BASE/design" >/dev/null
SIGNED_IN=$(cd "$SCRATCH" && npx convex run scratch:signIn)
$AB eval "(() => { const s = $SIGNED_IN; localStorage.setItem('__convexAuthJWT_$NAMESPACE', s.accessToken); localStorage.setItem('__convexAuthRefreshToken_$NAMESPACE', s.refreshToken); })()" >/dev/null
$AB set media "$THEME" $MOTION >/dev/null

$AB set viewport 1440 900 >/dev/null
$AB open "$BASE/planner" >/dev/null
$AB wait 1800 >/dev/null
shot 1440-rest
expect "Brain Dump lists the Inbox" "$(count "$DUMP")" 4
BEFORE=$(count "$NEXT")
TOTAL=$(planned "$TOMORROW")

set -- $(centre "document.querySelector('$DUMP')" 20)
FROM_X=$1; FROM_Y=$2
set -- $(centre "document.querySelector('[data-plan-list=\"day:$TOMORROW\"]')" 60)
drag "$FROM_X" "$FROM_Y" "$1" "$2"
shot 1440-drag-to-day
$AB mouse up >/dev/null
$AB wait 700 >/dev/null
expect "a dropped Task lands in the day" "$(count "$NEXT")" "$((BEFORE + 1))"
expect "the Brain Dump loses it" "$(count "$DUMP")" 3
NOW_TOTAL=$(planned "$TOMORROW")
[ "$NOW_TOTAL" != "$TOTAL" ] && echo "ok    the day total moved from $TOTAL to $NOW_TOTAL" || { echo "FAIL  the day total stayed at $TOTAL"; FAILED=1; }
shot 1440-dropped
$AB press Meta+z >/dev/null
$AB wait 700 >/dev/null
expect "Cmd+Z puts it back" "$(count "$DUMP")" 4

BLOCKS=$(count '[data-block-id]')
set -- $(centre "document.querySelector('$DUMP')" 20)
FROM_X=$1; FROM_Y=$2
set -- $(centre "document.querySelector('[data-cal-day=\"$TODAY\"]')" "(16.5 * 56)")
drag "$FROM_X" "$FROM_Y" "$1" "$2"
shot 1440-drag-to-calendar
$AB mouse up >/dev/null
$AB wait 800 >/dev/null
expect "dropping on the calendar makes a Work Block" "$(count '[data-block-id]')" "$((BLOCKS + 1))"
expect "and schedules the Task for today" "$(count "$DUMP")" 3
shot 1440-block-made

LABEL=$(label)
set -- $(centre "$LAST" 6)
drag "$1" "$2" "$1" "$(($2 + 56))"
shot 1440-block-moving
$AB mouse up >/dev/null
$AB wait 700 >/dev/null
MOVED=$(label)
[ "$MOVED" != "$LABEL" ] && echo "ok    moved: $MOVED" || { echo "FAIL  the block did not move: $LABEL"; FAILED=1; }

set -- $(centre "$LAST" "box.height - 3")
drag "$1" "$2" "$1" "$(($2 + 42))"
shot 1440-block-resizing
$AB mouse up >/dev/null
$AB wait 700 >/dev/null
RESIZED=$(label)
[ "$RESIZED" != "$MOVED" ] && echo "ok    resized: $RESIZED" || { echo "FAIL  the block did not resize: $MOVED"; FAILED=1; }
$AB press Meta+z >/dev/null
$AB wait 600 >/dev/null
expect "Cmd+Z undoes the resize" "$(label)" "$MOVED"

js "$LAST.querySelector('[role=checkbox]').click()" >/dev/null
$AB wait 900 >/dev/null
expect "ticking a block completes its Task" "$(js "$LAST.querySelector('[role=checkbox]')?.getAttribute('aria-checked')")" true
shot 1440-block-done
$AB press Meta+z >/dev/null
$AB wait 700 >/dev/null

js "document.querySelector('[role=radio][data-value=week]').click()" >/dev/null
$AB wait 900 >/dev/null
shot 1440-week
js "document.querySelector('[role=radio][data-value=day]').click()" >/dev/null
$AB wait 500 >/dev/null

FIRST=$(js "document.querySelector('$DAY')?.dataset.taskKey ?? ''")
TODAY_COUNT=$(count "$DAY")
NEXT_COUNT=$(count "$NEXT")
js "document.querySelector('$DAY [data-arrow-item]').focus()" >/dev/null
$AB press Meta+ArrowRight >/dev/null
$AB wait 700 >/dev/null
expect "Cmd+Right moves the focused Task to the next day" "$(count "$NEXT")" "$((NEXT_COUNT + 1))"
expect "and focus follows it" "$(js "document.activeElement?.closest('[data-task-key]')?.dataset.taskKey ?? ''")" "$FIRST"
$AB press Meta+ArrowLeft >/dev/null
$AB wait 700 >/dev/null
expect "Cmd+Left moves it back" "$(count "$DAY")" "$TODAY_COUNT"
$AB press Meta+ArrowUp >/dev/null
$AB wait 500 >/dev/null
$AB press Meta+ArrowUp >/dev/null
$AB wait 500 >/dev/null
BLOCKS=$(count '[data-block-id]')
$AB press b >/dev/null
$AB wait 800 >/dev/null
expect "B makes a Work Block for the selected Task" "$(count '[data-block-id]')" "$((BLOCKS + 1))"
shot 1440-keyboard

js "(() => { const input = document.querySelector('[data-plan-day=\"$TOMORROW\"] input[name=title]'); input.focus(); })()" >/dev/null
$AB keyboard type "Check the Planner script" >/dev/null
$AB press Enter >/dev/null
$AB wait 900 >/dev/null
expect "Add task puts a Task in the day" "$(js "[...document.querySelectorAll('$NEXT')].some((row) => row.innerText.includes('Check the Planner script'))")" true

js "document.querySelector('$DAY button[aria-label*=Estimate]').click()" >/dev/null
$AB wait 500 >/dev/null
shot 1440-estimate
$AB press Escape >/dev/null
js "document.activeElement?.blur()" >/dev/null
js "document.querySelector('$DAY [data-arrow-item]').focus()" >/dev/null
$AB press Enter >/dev/null
$AB wait 700 >/dev/null
shot 1440-card
$AB press Escape >/dev/null

$AB set viewport 390 844 >/dev/null
$AB open "$BASE/planner" >/dev/null
$AB wait 1500 >/dev/null
shot 390-days
js "document.querySelector('[role=radio][data-value=dump]').click()" >/dev/null
$AB wait 500 >/dev/null
shot 390-dump
js "document.querySelector('[role=radio][data-value=timebox]').click()" >/dev/null
$AB wait 700 >/dev/null
shot 390-timebox
js "document.querySelector('[role=radio][data-value=week]').click()" >/dev/null
$AB wait 700 >/dev/null
shot 390-week
expect "nothing scrolls sideways on a phone" "$(js "document.documentElement.scrollWidth <= window.innerWidth")" true

ERRORS=$($AB errors | grep -c . || true)
expect "no page errors" "$ERRORS" 0
$AB close >/dev/null
exit "$FAILED"
