"""Smart Blocks on the Timebox, end to end: draw a block, preview its fill, edit it, place it, undo it.

Needs the throwaway backend from local-backend.sh and the web app running:

    SCRATCH=/tmp/lifeos-local-backend sh scripts/local-backend.sh
    (cd $SCRATCH && CONVEX_AGENT_MODE=anonymous npx convex dev --typecheck disable) &
    WAKU_PUBLIC_CONVEX_URL=http://127.0.0.1:3210 npx waku dev --port 4061 &
    SCRATCH=/tmp/lifeos-local-backend uv run --with playwright python scripts/check-smart-blocks.py <output folder>

It reseeds the backend first and works on tomorrow, so the clock never cuts the window. BASE, CONVEX_URL and THEME (light or dark)
change the run. It exits non-zero on a failure.
"""

import json
import os
import re
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:4061")
CONVEX_URL = os.environ.get("CONVEX_URL", "http://127.0.0.1:3210")
SCRATCH = os.environ.get("SCRATCH", "/tmp/lifeos-local-backend")
THEME = os.environ.get("THEME", "light")
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
NAMESPACE = re.sub(r"[^a-zA-Z0-9]", "", CONVEX_URL)
TODAY = date.today().isoformat()
TOMORROW = (date.today() + timedelta(days=1)).isoformat()
ZONE = subprocess.check_output(["node", "-e", "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)"], text=True).strip()
HOUR_PX = 56
SUFFIX = "" if THEME == "light" else "-dark"
failed = []


def convex(function, args="{}"):
    return subprocess.check_output(["npx", "convex", "run", function, args], cwd=SCRATCH, text=True)


def expect(step, got, wanted):
    if got == wanted:
        print(f"ok    {step}")
    else:
        print(f"FAIL  {step}: wanted {wanted!r}, got {got!r}")
        failed.append(step)


def draw(page, day, start_minute, end_minute):
    column = page.locator(f"[data-cal-day='{day}']")
    box = column.bounding_box()
    x = box["x"] + box["width"] * 0.5
    page.mouse.move(x, box["y"] + start_minute / 60 * HOUR_PX)
    page.mouse.down()
    page.mouse.move(x, box["y"] + end_minute / 60 * HOUR_PX, steps=12)
    page.mouse.up()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    convex("scratch:seed", json.dumps({"today": TODAY, "timeZone": ZONE}))
    session = json.loads(convex("scratch:signIn"))
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 900}, color_scheme=THEME, device_scale_factor=2)
        page = context.new_page()
        page.on("pageerror", lambda error: failed.append(f"page error: {error}") or print(f"FAIL  page error: {error}"))
        page.goto(f"{BASE}/design")
        page.evaluate(
            "([namespace, s]) => { localStorage.setItem(`__convexAuthJWT_${namespace}`, s.accessToken);"
            " localStorage.setItem(`__convexAuthRefreshToken_${namespace}`, s.refreshToken); }",
            [NAMESPACE, session],
        )
        page.goto(f"{BASE}/planner")
        page.locator(f"[data-plan-day='{TODAY}'] [data-task-key]").first.wait_for()
        page.get_by_role("button", name="Next day").click()
        page.locator(f"[data-cal-day='{TOMORROW}']").wait_for()
        page.wait_for_timeout(800)
        page.locator("[data-plan-scroll=timebox]").evaluate(f"(node) => node.scrollTo({{ top: {13 * HOUR_PX} }})")
        page.wait_for_timeout(300)

        blocks_before = page.locator("[data-block-id]").count()
        draw(page, TOMORROW, 15 * 60, 17 * 60)
        bar = page.get_by_role("region", name="Smart Block")
        bar.wait_for(timeout=5000)
        page.locator("[data-spread-preview]").first.wait_for()
        page.wait_for_timeout(500)
        ghosts = page.locator("[data-spread-preview]").count()
        expect("drawing a window previews its fill as ghost blocks", ghosts > 0, True)
        expect("nothing is written before Enter", page.locator("[data-block-id]").count(), blocks_before)
        proposed = bar.get_by_role("list", name="Proposed Tasks").locator("li")
        first = bar.get_by_role("button", name=re.compile("^Leave out ")).first.get_attribute("aria-label")[len("Leave out ") :]
        print(f"info  {proposed.count()} proposed, first is {first!r}")
        page.screenshot(path=str(OUT / f"app-smart-block-fill{SUFFIX}.png"))

        bar.get_by_role("button", name=re.compile(f"^Leave out {re.escape(first)}")).click()
        page.wait_for_timeout(300)
        expect("leaving a Task out takes it off the fill", first in bar.get_by_role("list", name="Proposed Tasks").inner_text(), False)

        edge = page.get_by_role("separator", name="Move the end")
        handle = edge.bounding_box()
        page.mouse.move(handle["x"] + handle["width"] / 2, handle["y"] + handle["height"] / 2)
        page.mouse.down()
        page.mouse.move(handle["x"] + handle["width"] / 2, handle["y"] + handle["height"] / 2 - HOUR_PX / 2, steps=8)
        page.mouse.up()
        page.wait_for_timeout(300)
        expect("resizing the window updates it live", "3:00 – 4:30 pm" in bar.inner_text(), True)

        bar.get_by_role("textbox", name="Smart Block title").fill("Deep work")
        page.keyboard.press("Enter")
        page.wait_for_timeout(1200)
        expect("Enter closes the preview", bar.count(), 0)
        placed = page.locator("[data-block-id]").count() - blocks_before
        expect("Enter places the previewed Work Blocks", placed > 0, True)
        expect("the zone stays on the Timebox with its title", page.get_by_role("button", name=re.compile("^Deep work, ")).count(), 1)
        page.mouse.move(10, 10)
        page.wait_for_timeout(300)
        page.screenshot(path=str(OUT / f"app-smart-block{SUFFIX}.png"))

        page.get_by_role("button", name="Undo").first.click()
        page.wait_for_timeout(1000)
        expect("one undo removes the block and its fill", page.locator("[data-block-id]").count(), blocks_before)
        expect("the zone is gone after undo", page.get_by_role("button", name=re.compile("^Deep work, ")).count(), 0)

        page.keyboard.press("ControlOrMeta+k")
        page.wait_for_selector("[cmdk-root]")
        page.keyboard.type("new smart block")
        page.wait_for_timeout(150)
        offered = page.locator("[cmdk-item]", has_text=re.compile("^New Smart Block$"))
        expect("the command bar offers New Smart Block", offered.count(), 1)
        offered.click()
        bar.wait_for()
        page.wait_for_timeout(500)
        shown = page.locator("[data-block-id]").count()
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        expect("Escape discards the preview", bar.count(), 0)
        expect("Escape writes nothing", page.locator("[data-block-id]").count(), shown)

        page.goto(f"{BASE}/settings/features/smartBlocks")
        page.get_by_role("list", name="Area priority").wait_for()
        page.wait_for_timeout(500)
        page.screenshot(path=str(OUT / f"app-settings-smart-blocks{SUFFIX}.png"))
        browser.close()
    sys.exit(1 if failed else 0)


main()
