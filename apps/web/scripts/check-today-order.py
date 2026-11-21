"""Today keeps a hand order: drag a row, Cmd+Down, undo, and the order survives a reload.

Needs the throwaway backend from local-backend.sh and the web app running:

    SCRATCH=/tmp/lifeos-local-backend sh scripts/local-backend.sh
    (cd $SCRATCH && CONVEX_AGENT_MODE=anonymous npx convex dev --typecheck disable) &
    WAKU_PUBLIC_CONVEX_URL=http://127.0.0.1:3210 npx waku dev --port 4061 &
    SCRATCH=/tmp/lifeos-local-backend uv run --with playwright python scripts/check-today-order.py <output folder>

It reseeds the backend first. BASE, CONVEX_URL and SCRATCH change the run. It exits non-zero on a failure.
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
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
NAMESPACE = re.sub(r"[^a-zA-Z0-9]", "", CONVEX_URL)
TODAY = date.today().isoformat()
ZONE = subprocess.check_output(["node", "-e", "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)"], text=True).strip()
ENV = {**os.environ, "CONVEX_AGENT_MODE": "anonymous"}
ROWS = "#main ul[data-sortable] > [data-task-key]"
failed = []


def convex(*args):
    return subprocess.check_output(["npx", "convex", *args], cwd=SCRATCH, text=True, env=ENV, stderr=subprocess.DEVNULL)


def expect(step, got, wanted):
    if got == wanted:
        print(f"ok    {step}")
    else:
        print(f"FAIL  {step}: wanted {wanted!r}, got {got!r}")
        failed.append(step)


def titles(page):
    return page.locator(f"#main ul[data-sortable]").first.locator("> [data-task-key] [data-arrow-item]").all_inner_texts()


def drag(page, source, target):
    rows = page.locator(f"#main ul[data-sortable]").first.locator("> [data-task-key]")
    a = rows.nth(source).bounding_box()
    b = rows.nth(target).bounding_box()
    x = a["x"] + a["width"] / 2
    page.mouse.move(x, a["y"] + a["height"] / 2)
    page.mouse.down()
    page.mouse.move(x, a["y"] + a["height"] / 2 + 10, steps=4)
    page.mouse.move(x, b["y"] + b["height"] / 2 + 6, steps=12)
    page.mouse.up()
    page.wait_for_timeout(700)


def run(page, width, theme):
    tag = f"{width}-{theme}"
    page.set_viewport_size({"width": width, "height": 900})
    page.emulate_media(color_scheme=theme)
    page.goto(f"{BASE}/today")
    page.locator(ROWS).first.wait_for()
    page.wait_for_timeout(800)
    before = titles(page)
    print(f"info  {tag} Today: {before}")
    if len(before) < 3:
        failed.append(f"{tag}: Today needs three Tasks")
        return
    drag(page, 0, 2)
    dragged = before[1:3] + [before[0]] + before[3:]
    expect(f"{tag}: dragging the first row below the third moves it there", titles(page), dragged)
    page.screenshot(path=str(OUT / f"today-dragged-{tag}.png"))
    page.keyboard.press("Meta+z")
    page.wait_for_timeout(700)
    expect(f"{tag}: undo puts Today back in its first order", titles(page), before)

    drag(page, 0, 2)
    page.reload()
    page.locator(ROWS).first.wait_for()
    page.wait_for_timeout(800)
    expect(f"{tag}: the hand order survives a reload", titles(page), dragged)

    page.locator(ROWS).first.locator("[data-arrow-item]").click()
    page.keyboard.press("Meta+ArrowDown")
    page.wait_for_timeout(500)
    expect(f"{tag}: Cmd+Down moves the first row down one", titles(page), [dragged[1], dragged[0]] + dragged[2:])
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    page.keyboard.press("Meta+z")
    page.wait_for_timeout(700)
    expect(f"{tag}: undo puts the row back", titles(page), dragged)
    page.screenshot(path=str(OUT / f"today-undone-{tag}.png"))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for width, theme in [(1440, "light"), (1440, "dark"), (390, "light"), (390, "dark")]:
            convex("run", "scratch:seed", json.dumps({"today": TODAY, "timeZone": ZONE}))
            session = json.loads(convex("run", "scratch:signIn"))
            context = browser.new_context(device_scale_factor=2)
            page = context.new_page()
            page.on("pageerror", lambda error: failed.append(f"page error: {error}") or print(f"FAIL  page error: {error}"))
            page.goto(f"{BASE}/design")
            page.evaluate(
                "([namespace, s]) => { localStorage.setItem(`__convexAuthJWT_${namespace}`, s.accessToken);"
                " localStorage.setItem(`__convexAuthRefreshToken_${namespace}`, s.refreshToken); }",
                [NAMESPACE, session],
            )
            run(page, width, theme)
            context.close()
        browser.close()
    if failed:
        sys.exit(f"{len(failed)} failed")


main()
