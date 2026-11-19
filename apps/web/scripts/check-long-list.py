"""A long list draws only the rows near the screen, and nothing you can do to it changes.

On the seeded Inbox (304 Tasks) it checks that few rows are drawn, that scrolling never shows an empty row or
moves the page, and that the arrow keys, Shift+arrows, Select All, the lasso, the open card,
drag to reorder, N, completing a Task and Cmd+arrows all behave as they do on a short list.
It then checks the Planner's Brain Dump and a long group in Anytime the same way.

Needs the throwaway backend from local-backend.sh and the web app running:

    SCRATCH=/tmp/lifeos-local-backend sh scripts/local-backend.sh
    (cd $SCRATCH && CONVEX_AGENT_MODE=anonymous npx convex dev --typecheck disable) &
    WAKU_PUBLIC_CONVEX_URL=http://127.0.0.1:3210 npx waku dev --port 4061 &
    SCRATCH=/tmp/lifeos-local-backend uv run --with playwright python scripts/check-long-list.py <output folder>

It reseeds the backend first, with scratch:seedBulk on top. BASE, CONVEX_URL, WIDTH (1440 or 390),
THEME (light or dark), ENGINE (chromium or webkit), ANCHORING (off turns the browser's own scroll
anchoring off, as in older Safari), THROTTLE (slows Chromium's CPU that many times) and ONLY (comma-separated check names) change the run. It exits non-zero on a failure.
"""

import json
import os
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:4061")
CONVEX_URL = os.environ.get("CONVEX_URL", "http://127.0.0.1:3210")
SCRATCH = os.environ.get("SCRATCH", "/tmp/lifeos-local-backend")
THEME = os.environ.get("THEME", "light")
WIDTH = int(os.environ.get("WIDTH", "1440"))
ENGINE = os.environ.get("ENGINE", "chromium")
ONLY = [name for name in os.environ.get("ONLY", "").split(",") if name]
ANCHORING = os.environ.get("ANCHORING", "on")
THROTTLE = float(os.environ.get("THROTTLE", "1"))
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
NAMESPACE = re.sub(r"[^a-zA-Z0-9]", "", CONVEX_URL)
ZONE = subprocess.check_output(["node", "-e", "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)"], text=True).strip()
SUFFIX = f"-{WIDTH}-{THEME}-{ENGINE}" + ("-unanchored" if ANCHORING == "off" else "")
ENV = {**os.environ, "CONVEX_AGENT_MODE": "anonymous"}
MOD = "Meta" if sys.platform == "darwin" else "Control"
ROWS = "#main [data-task-key]"
DRAWN = "#main [data-task-key]:not([data-row-gap])"
INBOX_ROWS = 304
failed = []

WATCH_SCROLL = """() => {
  const main = document.getElementById('main');
  const seen = (window.__scroll = { empty: 0, short: 0, frames: 0 });
  const frame = () => {
    const view = main.getBoundingClientRect();
    let empty = 0;
    for (const row of main.querySelectorAll('[data-task-key]')) {
      const box = row.getBoundingClientRect();
      const visible = Math.min(box.bottom, view.bottom) - Math.max(box.top, view.top);
      if (visible <= 0) continue;
      if (row.hasAttribute('data-row-gap')) empty += visible;
      else if (box.height < 30) seen.short += 1;
    }
    seen.empty = Math.max(seen.empty, empty);
    seen.frames += 1;
    if (window.__scroll === seen) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}"""

FOCUSED = """() => {
  const row = document.activeElement?.closest('[data-task-key]');
  if (!row) return null;
  const rows = [...document.querySelectorAll('#main [data-task-key]')];
  const box = document.activeElement.getBoundingClientRect();
  const view = document.getElementById('main').getBoundingClientRect();
  return { index: rows.indexOf(row), onScreen: box.top >= view.top - 1 && box.bottom <= view.bottom + 1 };
}"""

TOP_ROW = """() => {
  const view = document.getElementById('main').getBoundingClientRect();
  for (const row of document.querySelectorAll('#main [data-task-key]')) {
    const box = row.getBoundingClientRect();
    if (box.top >= view.top + 60) return { key: row.dataset.taskKey, top: Math.round(box.top) };
  }
  return null;
}"""

WATCH_ROW_HEIGHT = """(key) => {
  window.__heights = [];
  const started = performance.now();
  const frame = () => {
    const row = document.querySelector(`#main [data-task-key="${key}"]`);
    if (!row || performance.now() - started > 2500) return;
    window.__heights.push(Math.round(row.getBoundingClientRect().height));
    requestAnimationFrame(frame);
  };
  frame();
}"""


def convex(*args):
    return subprocess.check_output(["npx", "convex", *args], cwd=SCRATCH, text=True, env=ENV, stderr=subprocess.DEVNULL)


def expect(step, got, wanted):
    if got == wanted:
        print(f"ok    {step}")
    else:
        print(f"FAIL  {step}: wanted {wanted!r}, got {got!r}")
        failed.append(step)


def go(page, path="/inbox"):
    page.goto(f"{BASE}{path}")
    page.locator(ROWS).first.wait_for()
    page.wait_for_timeout(700)


def shot(page, name):
    page.screenshot(path=str(OUT / f"long-list-{name}{SUFFIX}.png"))


def titles(page):
    return page.evaluate(
        "() => [...document.querySelectorAll('#main [data-task-key]:not([data-row-gap]) [data-arrow-item]')].map((item) => item.innerText.split('\\n')[0])"
    )


def keys(page):
    return page.evaluate("() => [...document.querySelectorAll('#main [data-task-key]')].map((row) => row.dataset.taskKey)")


def scroll_to(page, top):
    page.evaluate("(top) => document.getElementById('main').scrollTo({ top })", top)
    page.wait_for_timeout(250)


def wheel(page, total, step=400, pause=16):
    box = page.locator("#main").bounding_box()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    for _ in range(abs(total) // step):
        page.mouse.wheel(0, step if total > 0 else -step)
        page.wait_for_timeout(pause)
    page.wait_for_timeout(300)


def on_screen(page, nth):
    key = page.evaluate(
        """(nth) => {
          const view = document.getElementById('main').getBoundingClientRect();
          const rows = [...document.querySelectorAll('#main [data-task-key]:not([data-row-gap])')];
          return rows.filter((row) => row.getBoundingClientRect().top >= view.top + 60)[nth].dataset.taskKey;
        }""",
        nth,
    )
    return page.locator(f"#main [data-task-key='{key}']")


def selected_count(page):
    bar = page.get_by_text(re.compile(r"^\d+ Tasks? selected$"))
    return int(bar.first.text_content().split()[0]) if bar.count() else 0


def title_field(page):
    return page.get_by_role("textbox", name="Title", exact=True)


def check_window(page):
    go(page)
    expect("every Task keeps its place in the list", page.locator(ROWS).count(), INBOX_ROWS)
    drawn = page.locator(DRAWN).count()
    expect(f"only the rows near the screen are drawn ({drawn} of {INBOX_ROWS})", drawn < 90, True)
    height = page.evaluate("document.getElementById('main').scrollHeight")
    expect("the page is as tall as every row", height > INBOX_ROWS * 38, True)
    shot(page, "top")


def check_scroll(page):
    go(page)
    before = page.evaluate("document.getElementById('main').scrollHeight")
    page.evaluate(WATCH_SCROLL)
    wheel(page, 12_000)
    wheel(page, -4_000)
    seen = page.evaluate("window.__scroll")
    expect(f"scrolling by wheel never shows an empty row (worst {round(seen['empty'])} px over {seen['frames']} frames)", seen["empty"] < 1, True)
    expect("a row that scrolls into view is whole at once, it does not grow in", seen["short"], 0)
    shot(page, "middle")
    anchor = page.evaluate(TOP_ROW)
    wheel(page, -800, step=100)
    wheel(page, 800, step=100)
    again = page.evaluate(f"() => Math.round(document.querySelector('#main [data-task-key=\"{anchor['key']}\"]').getBoundingClientRect().top)")
    expect("scrolling away and back leaves a row where it was", again, anchor["top"])
    scroll_to(page, 10**7)
    page.wait_for_timeout(300)
    last = page.locator(ROWS).last
    expect("a jump to the end shows the last row", (last.get_attribute("data-row-gap"), last.is_visible()), (None, True))
    expect("the page is as tall after scrolling as before", page.evaluate("document.getElementById('main').scrollHeight"), before)
    scroll_to(page, 0)
    expect("back at the top the first row is drawn", page.locator(ROWS).first.get_attribute("data-row-gap"), None)


def check_arrows(page):
    go(page)
    for _ in range(80):
        page.keyboard.press("ArrowDown")
    page.wait_for_timeout(700)
    expect("80 presses of the down arrow reach the 80th row, on screen", page.evaluate(FOCUSED), {"index": 79, "onScreen": True})
    wheel(page, 6_000)
    page.keyboard.press("ArrowDown")
    page.wait_for_timeout(250)
    expect("after scrolling away, the down arrow goes on from the focused row", page.evaluate(FOCUSED), {"index": 80, "onScreen": True})
    for _ in range(30):
        page.keyboard.press("ArrowUp")
    page.wait_for_timeout(150)
    expect("the up arrow walks back", page.evaluate(FOCUSED), {"index": 50, "onScreen": True})
    shot(page, "arrows")


def check_selection(page):
    go(page)
    page.locator(ROWS).nth(2).click()
    for _ in range(70):
        page.keyboard.press("Shift+ArrowDown")
    page.wait_for_timeout(200)
    expect("Shift+Down 70 times selects 71 rows", selected_count(page), 71)
    expect("the selection end is focused and on screen", page.evaluate(FOCUSED), {"index": 72, "onScreen": True})
    page.keyboard.press("Escape")
    page.locator(ROWS).nth(4).click()
    wheel(page, 6_000)
    page.keyboard.press("Shift+ArrowDown")
    page.wait_for_timeout(250)
    expect("Shift+Down after scrolling away extends from the clicked row", (selected_count(page), page.evaluate(FOCUSED)), (2, {"index": 5, "onScreen": True}))
    page.keyboard.press("Escape")
    page.keyboard.press(f"{MOD}+a")
    page.wait_for_timeout(200)
    expect("Select All takes every Task, drawn or not", selected_count(page), INBOX_ROWS)
    shot(page, "select-all")
    wheel(page, 5_000)
    expect("the selection holds while its rows scroll off", selected_count(page), INBOX_ROWS)
    expect("rows that scroll into view show as selected", page.locator(f"{DRAWN}[data-selected]").count() > 10, True)
    page.keyboard.press("Escape")
    expect("Escape clears it", selected_count(page), 0)


def check_lasso(page):
    if WIDTH < 768:
        return
    go(page)
    box = page.locator("#main").bounding_box()
    first = page.locator(ROWS).first.bounding_box()
    page.mouse.move(first["x"] + first["width"] + 30, first["y"] + 4)
    page.mouse.down()
    page.mouse.move(first["x"] + first["width"] - 60, first["y"] + 120, steps=6)
    page.mouse.move(first["x"] + first["width"] - 60, box["y"] + box["height"] - 4, steps=10)
    page.wait_for_timeout(2500)
    shot(page, "lasso")
    page.mouse.up()
    count = selected_count(page)
    expect(f"a lasso dragged to the bottom edge keeps selecting as the list scrolls ({count} rows)", count > 60, True)
    page.wait_for_timeout(300)
    expect("letting go keeps the selection", selected_count(page), count)
    scroll_to(page, 0)
    expect("the rows it started on are still selected after they scrolled off and back", page.locator(ROWS).first.get_attribute("data-selected"), "")
    page.keyboard.press("Escape")


def check_card(page):
    go(page)
    wheel(page, 2_000)
    target = on_screen(page, 4)
    key = target.get_attribute("data-task-key")
    target.dblclick()
    page.locator("#main [data-open-card]").wait_for()
    page.wait_for_timeout(500)
    title_field(page).click()
    page.keyboard.type(" kept")
    shot(page, "card")
    wheel(page, 7_000)
    expect("the open card stays open after it scrolls off", page.locator(f"#main [data-task-key='{key}'][data-open-card]").count(), 1)
    wheel(page, -7_000)
    expect("its unsaved words are still there", " kept" in title_field(page).input_value(), True)
    page.keyboard.press("Escape")
    page.wait_for_timeout(600)
    expect("Escape closes it", page.locator("#main [data-open-card]").count(), 0)
    expect("and focus goes back to its row", page.evaluate("document.activeElement?.closest('[data-task-key]')?.dataset.taskKey"), key)


def drag(page, start, end, steps=20, hold=0):
    page.mouse.move(*start)
    page.mouse.down()
    for step in range(1, steps + 1):
        page.mouse.move(start[0] + (end[0] - start[0]) * step / steps, start[1] + (end[1] - start[1]) * step / steps)
        page.wait_for_timeout(16)
    page.wait_for_timeout(hold)
    page.mouse.up()
    page.wait_for_timeout(900)


def centre(box):
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2


def check_reorder(page):
    if WIDTH < 768:
        return
    go(page)
    before = keys(page)
    drag(page, centre(page.locator(ROWS).nth(3).bounding_box()), centre(page.locator(ROWS).nth(9).bounding_box()))
    after = keys(page)
    expect("dragging the 4th row onto the 10th puts it there", (after.index(before[3]), len(after)), (9, INBOX_ROWS))
    box = page.locator("#main").bounding_box()
    moved = before[1]
    drag(page, centre(page.locator(ROWS).nth(after.index(moved)).bounding_box()), (box["x"] + box["width"] / 2, box["y"] + box["height"] - 6), hold=2500)
    shot(page, "after-long-drag")
    landed = keys(page).index(moved)
    expect(f"a drag held at the bottom edge scrolls the list and drops far down (row {landed + 1})", landed > 30, True)
    expect("the dropped row is drawn where it landed", page.locator(f"#main [data-task-key='{moved}']").get_attribute("data-row-gap"), None)
    expect("no row is left lifted", page.locator("#main [data-dragging]").count(), 0)
    wheel(page, 3_000)
    on_screen(page, 6).locator("[data-arrow-item]").focus()
    at = page.evaluate(FOCUSED)["index"]
    key = keys(page)[at]
    page.keyboard.press(f"{MOD}+ArrowDown")
    page.wait_for_timeout(500)
    expect("Cmd+Down moves the focused row one place", keys(page).index(key), at + 1)


def check_new_task(page):
    go(page)
    box = page.locator("#main ul").first.bounding_box()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + 100)
    page.keyboard.press("n")
    title_field(page).wait_for(timeout=3000)
    page.wait_for_timeout(700)
    field = title_field(page).bounding_box()
    view = page.locator("#main").bounding_box()
    expect("N opens a draft and brings it on screen", view["y"] <= field["y"] and field["y"] + field["height"] <= view["y"] + view["height"], True)
    expect("the draft is the last row of the Inbox", page.locator(ROWS).last.get_attribute("data-task-id").startswith("optimistic:"), True)
    shot(page, "new-task")
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)
    expect("Escape leaves nothing behind", page.locator(ROWS).count(), INBOX_ROWS)
    page.keyboard.press("n")
    title_field(page).wait_for(timeout=3000)
    page.keyboard.type("One more thought")
    page.keyboard.press("Enter")
    page.wait_for_timeout(1200)
    expect("a saved Task joins the list", page.locator(ROWS).count(), INBOX_ROWS + 1)
    expect("and shows at the end", titles(page)[-1], "One more thought")


def check_complete(page):
    go(page)
    wheel(page, 1_600)
    target = on_screen(page, 6)
    key = target.get_attribute("data-task-key")
    count = page.locator(ROWS).count()
    full = round(target.bounding_box()["height"])
    page.evaluate(WATCH_ROW_HEIGHT, key)
    target.get_by_role("checkbox").click()
    page.wait_for_timeout(2600)
    heights = page.evaluate("window.__heights")
    expect("a completed row collapses over several frames", len([height for height in heights if 2 < height < full - 2]) >= 3, True)
    expect("and leaves the list", page.locator(ROWS).count(), count - 1)
    page.locator("[data-toaster]").get_by_role("button", name="Undo").first.click()
    page.wait_for_timeout(900)
    expect("Undo puts it back, drawn", page.locator(f"#main [data-task-key='{key}']").get_attribute("data-row-gap"), None)


def check_short_lists(page):
    go(page, "/today")
    expect("a short list draws every row", page.locator("#main [data-row-gap]").count(), 0)
    go(page, "/logbook")
    expect("the Logbook's day sections draw every row", page.locator("#main [data-row-gap]").count(), 0)


DUMP = "[data-plan-list=inbox]"

DUMP_STATE = """() => {
  const list = document.querySelector('[data-plan-list=inbox]');
  const view = list.getBoundingClientRect();
  const rows = [...list.querySelectorAll('[data-task-key]')];
  const seen = rows.filter((row) => row.getBoundingClientRect().bottom > view.top && row.getBoundingClientRect().top < view.bottom);
  return { rows: rows.length, drawn: rows.filter((row) => !row.hasAttribute('data-row-gap')).length, empty: seen.filter((row) => row.hasAttribute('data-row-gap')).length };
}"""

DUMP_ROW = """() => {
  const list = document.querySelector('[data-plan-list=inbox]');
  const view = list.getBoundingClientRect();
  const row = [...list.querySelectorAll('[data-task-key]:not([data-row-gap])')].find((each) => each.getBoundingClientRect().top >= view.top + 200);
  return { key: row.dataset.taskKey, top: row.getBoundingClientRect().top };
}"""


def check_brain_dump(page):
    if WIDTH < 768:
        return
    page.goto(f"{BASE}/planner")
    page.locator(f"{DUMP} [data-task-key]").first.wait_for()
    page.wait_for_timeout(1200)
    state = page.evaluate(DUMP_STATE)
    expect("the Brain Dump keeps a place for every Task", state["rows"] >= INBOX_ROWS, True)
    expect(f"and draws only the tiles near the screen ({state['drawn']} of {state['rows']})", state["drawn"] < 90, True)
    box = page.locator(DUMP).bounding_box()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    worst = 0
    for _ in range(30):
        page.mouse.wheel(0, 400)
        page.wait_for_timeout(16)
        worst = max(worst, page.evaluate(DUMP_STATE)["empty"])
    expect("scrolling the Brain Dump never shows an empty tile", worst, 0)
    page.evaluate("document.querySelector('[data-plan-list=inbox]').scrollTo({ top: 10 ** 7 })")
    page.wait_for_timeout(400)
    expect("a jump to its end shows tiles", page.evaluate(DUMP_STATE)["empty"], 0)
    page.evaluate(
        "() => { for (const gap of document.querySelectorAll('[data-plan-list=inbox] [data-row-gap]')) gap.style.height = `${gap.offsetHeight + 13}px`;"
        " document.querySelector('[data-plan-list=inbox]').scrollTo({ top: 10 ** 7 }); }"
    )
    page.wait_for_timeout(300)
    jumps = []
    for _ in range(40):
        before = page.evaluate(DUMP_ROW)
        page.mouse.wheel(0, -100)
        page.wait_for_timeout(60)
        after = page.evaluate(f"() => document.querySelector('[data-plan-list=inbox] [data-task-key=\"{before['key']}\"]').getBoundingClientRect().top")
        jumps.append(round(after - before["top"]))
    expect("scrolling back up through tiles whose height was guessed wrong moves 100 px a notch, no jumps", sorted(set(jumps)), [100])
    shot(page, "brain-dump")
    page.evaluate("document.querySelector('[data-plan-list=inbox]').scrollTo({ top: 0 })")
    page.wait_for_timeout(300)
    tile = page.locator(f"{DUMP} [data-task-key]").nth(1)
    key = tile.get_attribute("data-task-key")
    day = page.locator("[data-plan-day]").nth(1)
    drag(page, centre(tile.bounding_box()), (centre(day.bounding_box())[0], day.bounding_box()["y"] + 200))
    expect("a tile dragged from the Brain Dump lands in the day", day.locator(f"[data-task-key='{key}']").count(), 1)
    expect("and leaves the Brain Dump", page.locator(f"{DUMP} [data-task-key='{key}']").count(), 0)
    page.locator("[data-plan-day]").nth(1).locator("[data-arrow-item]").first.focus()
    page.evaluate("document.querySelector('[data-plan-list=inbox]').scrollTo({ top: 4000 })")
    page.wait_for_timeout(300)
    page.keyboard.press("ArrowLeft")
    page.keyboard.press("ArrowLeft")
    page.wait_for_timeout(300)
    focused = page.evaluate(
        "() => { const row = document.activeElement?.closest('[data-plan-list=inbox] [data-task-key]');"
        " return row ? [...document.querySelectorAll('[data-plan-list=inbox] [data-task-key]')].indexOf(row) : null; }"
    )
    expect("the left arrow from a day lands on the same place in the Brain Dump, drawn or not", focused, 0)


def check_grouped(page):
    go(page, "/anytime")
    more = page.get_by_role("button", name=re.compile(r"^Show \d+ more$")).first
    count = int(more.inner_text().split()[1])
    more.click()
    page.wait_for_timeout(900)
    expect(f"Show {count} more opens the whole group", page.get_by_role("button", name="Show fewer").count(), 1)
    gaps = page.locator("#main [data-row-gap]").count()
    expect("a long group draws only what is near the screen", gaps > 0 if count > 60 else gaps == 0, True)
    page.evaluate(WATCH_SCROLL)
    wheel(page, 4_000)
    seen = page.evaluate("window.__scroll")
    expect(f"scrolling through it never shows an empty row (worst {round(seen['empty'])} px)", seen["empty"] < 1, True)
    shot(page, "anytime-group")
    area = page.locator("aside [data-menu-area] a").first
    if WIDTH < 768:
        return
    area.click()
    page.locator(ROWS).first.wait_for()
    page.wait_for_timeout(700)
    rows = page.locator(ROWS).count()
    page.evaluate(WATCH_SCROLL)
    wheel(page, 3_000)
    seen = page.evaluate("window.__scroll")
    expect(f"an Area with {rows} Tasks scrolls without an empty row", seen["empty"] < 1, True)
    shot(page, "area")


CHECKS = [check_window, check_scroll, check_arrows, check_selection, check_lasso, check_card, check_reorder, check_new_task, check_complete, check_short_lists, check_brain_dump, check_grouped]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    args = json.dumps({"today": date.today().isoformat(), "timeZone": ZONE})
    convex("run", "scratch:seed", args)
    convex("run", "scratch:seedBulk", args)
    session = json.loads(convex("run", "scratch:signIn"))
    with sync_playwright() as playwright:
        browser = getattr(playwright, ENGINE).launch(headless=True)
        context = browser.new_context(viewport={"width": WIDTH, "height": 900}, color_scheme=THEME, device_scale_factor=2)
        if ANCHORING == "off":
            context.add_init_script("document.addEventListener('DOMContentLoaded', () => document.head.append(Object.assign(document.createElement('style'), { textContent: '* { overflow-anchor: none !important }' })))")
        page = context.new_page()
        if THROTTLE > 1 and ENGINE == "chromium":
            context.new_cdp_session(page).send("Emulation.setCPUThrottlingRate", {"rate": THROTTLE})
        page.goto(f"{BASE}/design")
        page.evaluate(
            "([namespace, s]) => { localStorage.setItem(`__convexAuthJWT_${namespace}`, s.accessToken);"
            " localStorage.setItem(`__convexAuthRefreshToken_${namespace}`, s.refreshToken); }",
            [NAMESPACE, session],
        )
        page.wait_for_timeout(1500)
        page.on("pageerror", lambda error: failed.append(f"page error: {error}") or print(f"FAIL  page error: {error}"))
        page.on("console", lambda message: message.type == "error" and (failed.append(f"console: {message.text}") or print(f"FAIL  console: {message.text[:300]}")))
        for check in CHECKS:
            if not ONLY or check.__name__ in ONLY:
                print(f"--- {check.__name__}")
                check(page)
        browser.close()
    print(f"{len(failed)} failed" if failed else "all ok")
    sys.exit(1 if failed else 0)


main()
