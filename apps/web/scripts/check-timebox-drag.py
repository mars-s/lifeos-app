"""Moving and resizing a Work Block changes the block and nothing else: no lasso, no selected Tasks.

Needs the throwaway backend from local-backend.sh and the web app running:

    SCRATCH=/tmp/lifeos-local-backend sh scripts/local-backend.sh
    (cd $SCRATCH && CONVEX_AGENT_MODE=anonymous npx convex dev --typecheck disable) &
    WAKU_PUBLIC_CONVEX_URL=http://127.0.0.1:3210 npx waku dev --port 4061 &
    SCRATCH=/tmp/lifeos-local-backend uv run --with playwright python scripts/check-timebox-drag.py

It reseeds the backend first. BASE and CONVEX_URL change the run. It exits non-zero on a failure.
"""

import json
import os
import re
import subprocess
import sys
from datetime import date

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:4061")
CONVEX_URL = os.environ.get("CONVEX_URL", "http://127.0.0.1:3210")
SCRATCH = os.environ.get("SCRATCH", "/tmp/lifeos-local-backend")
NAMESPACE = re.sub(r"[^a-zA-Z0-9]", "", CONVEX_URL)
ZONE = subprocess.check_output(["node", "-e", "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)"], text=True).strip()
ENV = {**os.environ, "CONVEX_AGENT_MODE": "anonymous"}
BLOCK = "[data-block-id]"
LABEL = "document.querySelector('[data-block-id]')?.getAttribute('aria-label')?.split('. ')[0]"
LASSO = "#main > .pointer-events-none.border-brand\\/45"
failed = []


def convex(*args):
    return subprocess.check_output(["npx", "convex", "run", *args], cwd=SCRATCH, text=True, env=ENV, stderr=subprocess.DEVNULL)


def expect(step, got, wanted):
    ok = got == wanted
    print(f"{'ok  ' if ok else 'FAIL'}  {step}" + ("" if ok else f": wanted {wanted!r}, got {got!r}"))
    if not ok:
        failed.append(step)


def drag(page, start, by):
    page.mouse.move(*start)
    page.mouse.down()
    for step in range(1, 9):
        page.mouse.move(start[0] + by[0] * step / 8, start[1] + by[1] * step / 8)
        page.wait_for_timeout(30)


def no_selection(page, step):
    expect(f"{step} draws no lasso", page.locator(LASSO).count(), 0)
    expect(f"{step} selects no Tasks", page.locator("[data-selected]").count(), 0)


with sync_playwright() as playwright:
    convex("scratch:seed", json.dumps({"today": date.today().isoformat(), "timeZone": ZONE}))
    session = json.loads(convex("scratch:signIn"))
    browser = playwright.chromium.launch()
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    context.add_init_script(
        f"localStorage.setItem('__convexAuthJWT_{NAMESPACE}', {json.dumps(session['accessToken'])});"
        f"localStorage.setItem('__convexAuthRefreshToken_{NAMESPACE}', {json.dumps(session['refreshToken'])});"
    )
    page = context.new_page()
    page.goto(f"{BASE}/planner")
    page.wait_for_selector(BLOCK)
    page.wait_for_timeout(1200)
    before = page.evaluate(LABEL)
    page.locator(BLOCK).first.evaluate("block => block.scrollIntoView({ block: 'center' })")
    page.wait_for_timeout(300)
    box = page.locator(BLOCK).first.bounding_box()

    drag(page, (box["x"] + box["width"] - 14, box["y"] + 8), (-520, 84))
    no_selection(page, "moving a Work Block across the lists")
    page.mouse.up()
    page.wait_for_timeout(700)
    moved = page.evaluate(LABEL)
    expect("the Work Block moved", moved != before, True)
    expect("nothing is selected after the drop", page.get_by_text(re.compile("^[0-9]+ selected$")).count(), 0)

    page.locator(BLOCK).first.evaluate("block => block.scrollIntoView({ block: 'center' })")
    page.wait_for_timeout(300)
    handle = page.locator(f"{BLOCK} > span[aria-hidden]").first.bounding_box()
    drag(page, (handle["x"] + handle["width"] / 2, handle["y"] + handle["height"] / 2), (-400, 56))
    no_selection(page, "resizing a Work Block")
    page.mouse.up()
    page.wait_for_timeout(700)
    expect("the Work Block grew", page.evaluate(LABEL) != moved, True)

    page.keyboard.press("Meta+z")
    page.wait_for_timeout(500)
    page.keyboard.press("Meta+z")
    page.wait_for_timeout(700)
    expect("two undos put the Work Block back", page.evaluate(LABEL), before)
    browser.close()

print("\nall passed" if not failed else f"\n{len(failed)} failed")
sys.exit(1 if failed else 0)
