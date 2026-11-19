"""The undo toast keeps its words beside its buttons, and stands aside for an open picker.

A long title wraps beside Undo and Dismiss (#61). A toast under an open picker or menu steps
aside, holds its countdown, and comes back with a working Undo when the picker closes (#63).

Needs the throwaway backend from local-backend.sh and the web app running:

    SCRATCH=/tmp/lifeos-local-backend sh scripts/local-backend.sh
    (cd $SCRATCH && CONVEX_AGENT_MODE=anonymous npx convex dev --typecheck disable) &
    WAKU_PUBLIC_CONVEX_URL=http://127.0.0.1:3210 npx waku dev --port 4061 &
    SCRATCH=/tmp/lifeos-local-backend uv run --with playwright python scripts/check-toast.py <output folder>

It reseeds the backend first. BASE, CONVEX_URL, WIDTH (1440 or 390), THEME (light or dark) and
MOTION (no-preference or reduce) change the run. It exits non-zero on a failure.
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
MOTION = os.environ.get("MOTION", "no-preference")
WIDTH = int(os.environ.get("WIDTH", "1440"))
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
NAMESPACE = re.sub(r"[^a-zA-Z0-9]", "", CONVEX_URL)
ZONE = subprocess.check_output(["node", "-e", "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)"], text=True).strip()
SUFFIX = f"-{WIDTH}-{THEME}" + ("-reduced" if MOTION == "reduce" else "")
ENV = {**os.environ, "CONVEX_AGENT_MODE": "anonymous"}
UNDO_WINDOW_MS = 5000
failed = []

TOAST_LAYOUT = """() => {
  const toast = document.querySelector('[data-toaster] li');
  const box = (node) => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
  const range = document.createRange();
  range.selectNodeContents(toast.querySelector('p'));
  const words = [...range.getClientRects()].filter((r) => r.width > 0).map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom }));
  const buttons = [...toast.querySelectorAll('button')].map(box);
  const card = box(toast.firstElementChild);
  const meets = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  return {
    underAButton: words.some((word) => buttons.some((button) => meets(word, button))),
    outsideTheCard: [...words, ...buttons].some((r) => r.left < card.left || r.right > card.right + 0.5 || r.top < card.top || r.bottom > card.bottom + 0.5),
    offScreen: card.left < 0 || card.right > innerWidth || card.bottom > innerHeight,
    lines: Math.round(toast.querySelector('p').getBoundingClientRect().height / parseFloat(getComputedStyle(toast.querySelector('p')).lineHeight)),
  };
}"""

COVERED_ROWS = """() => {
  const picker = document.querySelector('[data-radix-popper-content-wrapper]');
  return [...picker.querySelectorAll('button')].filter((button) => {
    const r = button.getBoundingClientRect();
    const spots = [[r.left + 6, r.top + 6], [r.right - 6, r.top + 6], [r.left + 6, r.bottom - 6], [r.right - 6, r.bottom - 6], [(r.left + r.right) / 2, (r.top + r.bottom) / 2]];
    return spots.some(([x, y]) => !picker.contains(document.elementFromPoint(x, y)));
  }).map((button) => button.textContent.trim());
}"""

TOAST_IN_THE_WAY = """() => {
  const picker = document.querySelector('[data-radix-popper-content-wrapper]')?.firstElementChild?.getBoundingClientRect();
  const toast = document.querySelector('[data-toaster] li')?.getBoundingClientRect();
  return !!picker && !!toast && toast.left < picker.right && picker.left < toast.right && toast.top < picker.bottom && picker.top < toast.bottom;
}"""


def convex(*args):
    return subprocess.check_output(["npx", "convex", *args], cwd=SCRATCH, text=True, env=ENV, stderr=subprocess.DEVNULL)


def task_titled(title):
    out = convex("data", "tasks", "--limit", "5000", "--format", "jsonArray")
    return [task for task in (json.loads(out) if out.strip().startswith("[") else []) if task["title"] == title]


def expect(step, got, wanted):
    if got == wanted:
        print(f"ok    {step}")
    else:
        print(f"FAIL  {step}: wanted {wanted!r}, got {got!r}")
        failed.append(step)


def shot(page, name):
    page.screenshot(path=str(OUT / f"toast-{name}{SUFFIX}.png"))


def toaster(page):
    return page.locator("[data-toaster]")


def undo_button(page):
    return toaster(page).get_by_role("button", name="Undo")


def check_long_title(page, button, name, lines):
    page.goto(f"{BASE}/design")
    page.wait_for_load_state("networkidle")
    page.locator("#controls").get_by_role("button", name=button, exact=True).click()
    undo_button(page).wait_for()
    page.wait_for_timeout(700)
    layout = page.evaluate(TOAST_LAYOUT)
    shot(page, name)
    expect(f"{button}: no word of the title sits under a button", layout["underAButton"], False)
    expect(f"{button}: the title and buttons stay inside the toast", layout["outsideTheCard"], False)
    expect(f"{button}: the toast stays on screen", layout["offScreen"], False)
    expect(f"{button}: the title takes {lines} line(s)", layout["lines"] in lines, True)
    toaster(page).get_by_role("button", name="Dismiss").click()
    page.wait_for_timeout(400)


def open_when_low_on_the_screen(page, title):
    page.goto(f"{BASE}/inbox")
    page.locator("#main [data-task-key]").first.wait_for()
    page.wait_for_timeout(600)
    rows = page.locator("#main [data-task-key]")
    box = rows.nth(min(4, rows.count() - 1)).bounding_box()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.keyboard.press("n")
    page.get_by_role("textbox", name="Title", exact=True).wait_for()
    page.keyboard.type(title)
    page.keyboard.press("Tab")
    undo_button(page).wait_for()
    page.get_by_role("button", name="When: Inbox").click()
    page.get_by_role("button", name="Someday", exact=True).wait_for()
    page.wait_for_timeout(700)


def check_picker(page):
    open_when_low_on_the_screen(page, "Low thought")
    in_the_way = page.evaluate(TOAST_IN_THE_WAY)
    shot(page, "picker-open")
    if WIDTH <= 640:
        expect("on a phone the picker opens where the toast sits", in_the_way, True)
        expect("no picker row is covered while the toast is up", page.evaluate(COVERED_ROWS), [])
        expect("the toast is out of sight while the picker is over it", toaster(page).locator("li").first.evaluate("(node) => getComputedStyle(node).opacity"), "0")
        expect("its Undo cannot be reached by keyboard while it is away", undo_button(page).evaluate("(node) => node.closest('[inert]') !== null"), True)
    else:
        expect("on a wide screen the picker is clear of the toast", in_the_way, False)
        expect("so the toast stays where it is", toaster(page).locator("li").first.evaluate("(node) => getComputedStyle(node).opacity"), "1")
    page.wait_for_timeout(UNDO_WINDOW_MS + 800)
    page.get_by_role("button", name="Someday", exact=True).click()
    page.get_by_role("button", name="When: Someday").wait_for()
    page.keyboard.press("Escape")
    page.wait_for_timeout(700)
    shot(page, "picker-closed")
    if WIDTH <= 640:
        expect("Someday could be tapped under where the toast was", len(task_titled("Low thought")), 1)
        expect("the toast comes back once the picker closes", undo_button(page).count() > 0 and undo_button(page).first.is_visible(), True)


def check_undo_after_waiting(page):
    open_when_low_on_the_screen(page, "Held thought")
    page.wait_for_timeout(UNDO_WINDOW_MS + 800)
    page.keyboard.press("Escape")
    page.keyboard.press("Escape")
    page.wait_for_timeout(700)
    if WIDTH > 640:
        return
    expect("the toast waited for the picker to close", undo_button(page).count() > 0, True)
    undo_button(page).first.click()
    page.wait_for_timeout(1500)
    expect("Undo still works after the picker held the toast back", len(task_titled("Held thought")), 0)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    convex("run", "scratch:seed", json.dumps({"today": date.today().isoformat(), "timeZone": ZONE}))
    session = json.loads(convex("run", "scratch:signIn"))
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": WIDTH, "height": 900}, color_scheme=THEME, reduced_motion=MOTION, device_scale_factor=2)
        page = context.new_page()
        page.on("pageerror", lambda error: failed.append(f"page error: {error}") or print(f"FAIL  page error: {error}"))
        page.goto(f"{BASE}/design")
        page.evaluate(
            "([namespace, s]) => { localStorage.setItem(`__convexAuthJWT_${namespace}`, s.accessToken);"
            " localStorage.setItem(`__convexAuthRefreshToken_${namespace}`, s.refreshToken); }",
            [NAMESPACE, session],
        )
        check_long_title(page, "Complete a Task", "long-title", {1, 2})
        check_long_title(page, "Trash a long Project", "longest-title", {2})
        check_long_title(page, "Reschedule", "short-title", {1})
        check_picker(page)
        check_undo_after_waiting(page)
        browser.close()
    print(f"{len(failed)} failed" if failed else "all ok")
    sys.exit(1 if failed else 0)


main()
