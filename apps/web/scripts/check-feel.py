"""The app answers in the frame you act, with the network held back.

Every server message is delayed, so anything that shows in time did not wait for the save:
New Task and edits on it, a row leaving, Undo before and after the save, Undo of New Task
closing its card, a failed list keeping its header, and Move Up and Move Down for an Area.

Needs the throwaway backend from local-backend.sh and the web app running:

    SCRATCH=/tmp/lifeos-local-backend sh scripts/local-backend.sh
    (cd $SCRATCH && CONVEX_AGENT_MODE=anonymous npx convex dev --typecheck disable) &
    WAKU_PUBLIC_CONVEX_URL=http://127.0.0.1:3210 npx waku dev --port 4061 &
    SCRATCH=/tmp/lifeos-local-backend uv run --with playwright python scripts/check-feel.py <output folder>

It reseeds the backend first. BASE, CONVEX_URL, WIDTH (1440 or 390), THEME (light or dark) and
MOTION (no-preference or reduce) change the run. It exits non-zero on a failure.
"""

import json
import os
import re
import subprocess
import sys
import time
from datetime import date
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:4061")
CONVEX_URL = os.environ.get("CONVEX_URL", "http://127.0.0.1:3210")
SCRATCH = os.environ.get("SCRATCH", "/tmp/lifeos-local-backend")
THEME = os.environ.get("THEME", "light")
MOTION = os.environ.get("MOTION", "no-preference")
WIDTH = int(os.environ.get("WIDTH", "1440"))
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
NAMESPACE = re.sub(r"[^a-zA-Z0-9]", "", CONVEX_URL)
ZONE = subprocess.check_output(["node", "-e", "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)"], text=True).strip()
SUFFIX = f"-{WIDTH}-{THEME}" + ("-reduced" if MOTION == "reduce" else "")
ENV = {**os.environ, "CONVEX_AGENT_MODE": "anonymous"}
LAG_MS = 1500
LONG_LAG_MS = 5000
SOON_MS = 400
LEAVE_MS = 1000
MOD = "Meta" if sys.platform == "darwin" else "Control"
failed = []

HOLD_SERVER_MESSAGES = """(() => {
  const Native = WebSocket;
  window.__lag = 0;
  const held = [];
  const release = () => {
    while (held.length > 0 && held[0].at <= performance.now()) held.shift().deliver();
    if (held.length > 0) setTimeout(release, held[0].at - performance.now());
  };
  const later = (run) => (event) => {
    const at = Math.max(held.at(-1)?.at ?? 0, performance.now() + window.__lag);
    held.push({ at, deliver: () => run(event) });
    if (held.length === 1) release();
  };
  window.WebSocket = class extends Native {
    set onmessage(run) { super.onmessage = run && later((event) => run.call(this, event)); }
    get onmessage() { return super.onmessage; }
    addEventListener(type, run, options) { return super.addEventListener(type, type === 'message' ? later(run) : run, options); }
  };
})()"""

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


def rows(table):
    out = convex("data", table, "--limit", "5000", "--format", "jsonArray")
    return json.loads(out) if out.strip().startswith("[") else []


def task_titled(title):
    found = [task for task in rows("tasks") if task["title"] == title]
    return found[0] if found else None


def expect(step, got, wanted):
    if got == wanted:
        print(f"ok    {step}")
    else:
        print(f"FAIL  {step}: wanted {wanted!r}, got {got!r}")
        failed.append(step)


def lag(page, ms):
    page.evaluate("(ms) => { window.__lag = ms; }", ms)


def settle(page, held=LAG_MS):
    lag(page, 0)
    page.wait_for_timeout(held + 700)


def go(page, path, ready="#main [data-task-key]"):
    page.goto(f"{BASE}{path}")
    page.locator(ready).first.wait_for()
    page.wait_for_timeout(600)


def shot(page, name):
    page.screenshot(path=str(OUT / f"feel-{name}{SUFFIX}.png"))


def soon(step, locator, shown=True):
    started = time.time()
    within = SOON_MS if shown else LEAVE_MS
    try:
        locator.first.wait_for(state="visible" if shown else "hidden", timeout=within)
        expect(f"{step} (in {round((time.time() - started) * 1000)} ms, with the server held back)", True, True)
    except Exception:
        expect(f"{step} within {within} ms, with the server held back", "not in time", "in time")


def row(page, title):
    return page.locator("#main [data-task-key]").filter(has=page.get_by_text(title, exact=True))


def title_field(page):
    return page.get_by_role("textbox", name="Title", exact=True)


def new_task(page, title, over):
    box = page.locator(over).first.bounding_box()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.keyboard.press("n")
    soon(f"{title}: N shows the draft row", title_field(page))
    page.keyboard.type(title)


def undo_toast(page):
    page.locator("[data-toaster]").get_by_role("button", name="Undo").first.click()


def check_new_task(page):
    go(page, "/inbox")
    lag(page, LONG_LAG_MS)
    new_task(page, "Lagged thought", "#main ul")
    page.keyboard.press("Tab")
    page.get_by_role("button", name="When: Inbox").click()
    page.get_by_role("button", name="This Evening", exact=True).click()
    soon("an edit made before the create returns shows on the card", page.get_by_role("button", name="When: This Evening"))
    shot(page, "edit-before-create")
    page.keyboard.press(f"{MOD}+z")
    soon("undoing that edit before the create returns shows on the card", page.get_by_role("button", name="When: Inbox"))
    page.get_by_role("button", name="When: Inbox").click()
    page.get_by_role("button", name="Today", exact=True).click()
    soon("a second edit shows on the card", page.get_by_role("button", name="When: Today"))
    page.keyboard.press("Escape")
    expect("the create has still not returned", page.locator("#main [data-task-id^='optimistic:']").count(), 1)
    settle(page, LONG_LAG_MS)
    saved = task_titled("Lagged thought")
    expect("the Task saves once the server answers", saved is not None, True)
    expect("the kept edit was sent after the create", saved and saved["when"], {"kind": "scheduled", "date": date.today().isoformat(), "evening": False})
    moves = [row for row in rows("activity") if row["action"] == "task.setWhen"]
    expect("the undone edit was never sent", len(moves), 1)
    expect("nothing is reported as failed", page.locator("[data-toaster]").get_by_text(re.compile("could not|did not")).count(), 0)


def check_escape(page):
    go(page, "/inbox")
    before = len(rows("tasks"))
    new_task(page, "", "#main ul")
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)
    expect("N then Escape leaves no row", title_field(page).count(), 0)
    expect("N then Escape creates no Task", len(rows("tasks")), before)


def check_row_exit(page):
    go(page, "/inbox")
    target = page.locator("#main [data-task-key]").first
    key = target.get_attribute("data-task-key")
    full = round(target.bounding_box()["height"])
    target.locator("[data-arrow-item]").click()
    page.evaluate(WATCH_ROW_HEIGHT, key)
    page.keyboard.press("Backspace")
    page.wait_for_timeout(120)
    shot(page, "row-leaving")
    page.wait_for_timeout(900)
    heights = page.evaluate("window.__heights")
    between = [height for height in heights if 2 < height < full - 2]
    if MOTION == "reduce":
        expect("with reduced motion a trashed row leaves at once", between, [])
    else:
        expect("a trashed row collapses over several frames", len(between) >= 3, True)
    expect("the trashed row is gone", page.locator(f"#main [data-task-key='{key}']").count(), 0)
    page.wait_for_timeout(5200)


def check_undo(page):
    go(page, "/inbox")
    target = page.locator("#main [data-task-key]").first
    title = target.locator("[data-arrow-item]").inner_text().split("\n")[0]
    after = page.locator("#main [data-task-key]").nth(1).locator("[data-arrow-item]").inner_text().split("\n")[0]

    lag(page, LAG_MS)
    target.locator("[data-arrow-item]").click()
    page.keyboard.press("Backspace")
    soon("a trashed row leaves before the save returns", row(page, title), False)
    page.keyboard.press(f"{MOD}+z")
    soon("Undo before the save returns puts the row back", row(page, title))
    page.wait_for_timeout(450)
    shot(page, "undo-before-save")
    titles = [text.split("\n")[0] for text in page.locator("#main [data-task-key] [data-arrow-item]").all_inner_texts()]
    expect("the row is back above the row it was above", titles[:2], [title, after])
    settle(page)
    expect("the row is still there once the server has answered", row(page, title).count(), 1)
    expect("the Task is not in Trash", (task_titled(title) or {}).get("trashedAt"), None)
    page.wait_for_timeout(4000)

    target = row(page, title)
    target.locator("[data-arrow-item]").click()
    page.keyboard.press("Backspace")
    page.wait_for_timeout(700)
    expect("the Task is in Trash once saved", (task_titled(title) or {}).get("trashedAt") is not None, True)
    lag(page, LAG_MS)
    page.keyboard.press(f"{MOD}+z")
    soon("Undo after the save puts the row back before the server answers", row(page, title))
    settle(page)
    expect("the Task left Trash", (task_titled(title) or {}).get("trashedAt"), None)
    page.wait_for_timeout(4000)

    lag(page, LAG_MS)
    target = row(page, title)
    target.get_by_role("checkbox").click()
    row(page, title).first.wait_for(state="hidden", timeout=3000)
    undo_toast(page)
    soon("Undo of a completed Task puts the row back", row(page, title))
    expect("the row comes back unticked", row(page, title).get_by_role("checkbox").get_attribute("aria-checked"), "false")
    settle(page)
    expect("the Task is open on the server", (task_titled(title) or {}).get("status"), {"kind": "open"})
    page.wait_for_timeout(4000)


def check_undo_new_task(page, path, label):
    go(page, path, "#main h1, #main h2")
    heading = page.locator("#main").get_by_role("heading").first.bounding_box()
    title = f"Loose in {label}"
    page.mouse.move(heading["x"] + 4, heading["y"] + 4)
    page.keyboard.press("n")
    title_field(page).wait_for(timeout=3000)
    page.keyboard.type(title)
    page.keyboard.press("Tab")
    page.wait_for_timeout(700)
    expect(f"{label}: the new Task is saved with its card still open", (task_titled(title) is not None, title_field(page).count()), (True, 1))
    shot(page, f"new-task-card-{label.lower()}")
    lag(page, LAG_MS)
    undo_toast(page)
    soon(f"{label}: Undo of New Task closes the open card", title_field(page), False)
    soon(f"{label}: Undo of New Task takes the row away", row(page, title), False)
    settle(page)
    expect(f"{label}: the Task is gone from the server", task_titled(title), None)
    expect(f"{label}: no card is left open", page.locator("#main [data-open-card]").count(), 0)

    lag(page, LAG_MS)
    title = f"Never saved in {label}"
    page.mouse.move(heading["x"] + 4, heading["y"] + 4)
    page.keyboard.press("n")
    title_field(page).wait_for(timeout=3000)
    page.keyboard.type(title)
    page.keyboard.press("Tab")
    undo_toast(page)
    soon(f"{label}: Undo before the create returns closes the card", title_field(page), False)
    settle(page)
    expect(f"{label}: nothing is left on the server or the screen", (task_titled(title), row(page, title).count()), (None, 0))
    page.wait_for_timeout(3000)


def check_failed_list(page):
    for path, fault, name in [("/anytime", "lists:anytime", "Anytime"), ("/today", "today:get", "Today"), ("/inbox", "lists:inbox", "Inbox")]:
        page.goto(f"{BASE}{path}?__fail={fault}")
        notice = page.locator("#main [role=alert]")
        notice.wait_for(timeout=5000)
        expect(f"{name}: a failed list keeps its title", page.locator("#main").get_by_role("heading", name=name, exact=True).count(), 1)
        expect(f"{name}: the notice sits under the header", notice.get_by_text("This list did not load").count(), 1)
        header = page.locator("#main header").first.bounding_box()
        expect(f"{name}: the header is above the notice", header["y"] < notice.bounding_box()["y"], True)
        shot(page, f"failed-{name.lower()}")
    expect("Try Again is offered", page.locator("#main [role=alert]").get_by_role("button", name="Try Again").count(), 1)


def area_titles(page):
    return [text.split("\n")[0] for text in page.locator("aside [data-menu-area] > a, aside [data-menu-area] > div > a").all_inner_texts()]


def check_area_reorder(page):
    go(page, "/today", "#main h1")
    if WIDTH < 768:
        page.get_by_role("button", name="Open the sidebar").click()
        page.wait_for_timeout(400)
    areas = page.locator("aside [data-menu-area]")
    before = [area.get_attribute("data-menu-area") for area in areas.all()]
    if len(before) < 2:
        return expect("the seed has two Areas to reorder", len(before) >= 2, True)
    order = lambda: [area.get_attribute("data-menu-area") for area in page.locator("aside [data-menu-area]").all()]
    lag(page, LAG_MS)
    areas.first.locator("a").first.click(button="right")
    menu = page.get_by_role("menu")
    menu.wait_for(timeout=3000)
    expect("the first Area cannot move up", menu.get_by_role("menuitem", name="Move Up").get_attribute("aria-disabled"), "true")
    shot(page, "area-menu")
    menu.get_by_role("menuitem", name="Move Down").click()
    page.wait_for_timeout(SOON_MS)
    expect("Move Down in the Area menu moves it one place, before the save returns", order()[:2], [before[1], before[0]])
    page.keyboard.press(f"{MOD}+z")
    page.wait_for_timeout(SOON_MS)
    expect("Undo puts the Area back before the save returns", order(), before)
    settle(page)
    expect("the Areas are in their first order once the server answers", order(), before)
    page.locator("aside [data-menu-area]").nth(1).locator("a").first.focus()
    page.keyboard.press(f"{MOD}+ArrowUp")
    page.wait_for_timeout(SOON_MS)
    expect("Cmd+Up moves the focused Area up", order()[:2], [before[1], before[0]])
    page.keyboard.press(f"{MOD}+ArrowDown")
    page.wait_for_timeout(700)
    expect("Cmd+Down moves it back", order(), before)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    convex("run", "scratch:seed", json.dumps({"today": date.today().isoformat(), "timeZone": ZONE}))
    session = json.loads(convex("run", "scratch:signIn"))
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": WIDTH, "height": 900}, color_scheme=THEME, reduced_motion=MOTION, device_scale_factor=2)
        context.add_init_script(HOLD_SERVER_MESSAGES)
        page = context.new_page()
        page.on("pageerror", lambda error: failed.append(f"page error: {error}") or print(f"FAIL  page error: {error}"))
        page.goto(f"{BASE}/design")
        page.evaluate(
            "([namespace, s]) => { localStorage.setItem(`__convexAuthJWT_${namespace}`, s.accessToken);"
            " localStorage.setItem(`__convexAuthRefreshToken_${namespace}`, s.refreshToken); }",
            [NAMESPACE, session],
        )
        check_new_task(page)
        check_escape(page)
        check_row_exit(page)
        check_undo(page)
        for path, label in [("/anytime", "Anytime"), ("/someday", "Someday"), ("/upcoming", "Upcoming")]:
            check_undo_new_task(page, path, label)
        check_failed_list(page)
        check_area_reorder(page)
        browser.close()
    print(f"{len(failed)} failed" if failed else "all ok")
    sys.exit(1 if failed else 0)


main()
