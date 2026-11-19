"""The day Goal, the day meter and Spread across the day, end to end.

Needs the throwaway backend from local-backend.sh and the web app running:

    SCRATCH=/tmp/lifeos-local-backend sh scripts/local-backend.sh
    (cd $SCRATCH && CONVEX_AGENT_MODE=anonymous npx convex dev) &
    WAKU_PUBLIC_CONVEX_URL=http://127.0.0.1:3210 npx waku dev --port 4061 &
    SCRATCH=/tmp/lifeos-local-backend uv run --with playwright python scripts/check-day-goal.py <output folder>

It reseeds the backend first. BASE, CONVEX_URL and THEME (light or dark) change the run. It exits non-zero on a failure.
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
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
NAMESPACE = re.sub(r"[^a-zA-Z0-9]", "", CONVEX_URL)
TODAY = date.today().isoformat()
ZONE = subprocess.check_output(["node", "-e", "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)"], text=True).strip()
GUESSED = "Pick up the parcel from the post office"
failed = []


def convex(function, args="{}"):
    return subprocess.check_output(["npx", "convex", "run", function, args], cwd=SCRATCH, text=True)


def expect(step, got, wanted):
    if got == wanted:
        print(f"ok    {step}")
    else:
        print(f"FAIL  {step}: wanted {wanted!r}, got {got!r}")
        failed.append(step)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    convex("scratch:seed", json.dumps({"today": TODAY, "timeZone": ZONE}))
    session = json.loads(convex("scratch:signIn"))
    convex("scratch:storeSecret", json.dumps({"last4": "test"}))
    convex("scratch:switchAi", json.dumps({"on": True}))
    convex("scratch:suggestEstimate", json.dumps({"title": GUESSED, "guesses": [{"minutes": 20, "probability": 0.7}], "reason": "Like a past errand"}))
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
        column = page.locator(f"[data-plan-day='{TODAY}']")
        column.locator("[data-task-key]").first.wait_for()
        page.wait_for_timeout(900)

        meter = column.locator("[role=meter]")
        trigger = column.locator("button[aria-haspopup=dialog]").first
        planned = int(meter.get_attribute("aria-valuenow"))
        expect("a Smart Estimate shows as hollow guess dots", column.locator("[data-dot=guess]").count() > 0, True)
        expect("the readout marks the total as approximate", "~" in trigger.inner_text(), True)
        print(f"info  today has {planned} minutes planned")
        expect("the readout talks about free time by default", "free" in trigger.inner_text(), True)

        trigger.hover()
        page.wait_for_timeout(600)
        page.screenshot(path=str(OUT / f"day-meter-hover-{THEME}.png"), clip={"x": 270, "y": 60, "width": 620, "height": 420})

        trigger.click()
        dialog = page.get_by_role("dialog")
        dialog.wait_for()
        dialog.get_by_role("button", name="6:00").click()
        page.wait_for_timeout(500)
        expect("a preset sets the Goal", dialog.get_by_role("button", name="6:00").get_attribute("aria-pressed"), "true")
        expect("the readout now names the goal", "goal" in trigger.inner_text(), True)
        expect("the meter marks the goal", column.locator("[data-goal-mark]").count() <= 1, True)
        page.get_by_text("Goal set to 6:00").first.wait_for()
        expect("the breakdown lists Tasks with no Area", dialog.get_by_text("No Area").count(), 1)
        page.screenshot(path=str(OUT / f"day-goal-{THEME}.png"), clip={"x": 250, "y": 30, "width": 860, "height": 700})

        slider = dialog.get_by_role("slider")
        slider.focus()
        page.keyboard.press("ArrowRight")
        page.wait_for_timeout(400)
        expect("an arrow nudges the goal a quarter hour", slider.get_attribute("aria-valuenow"), "375")
        box = slider.bounding_box()
        page.mouse.move(box["x"] + box["width"] * 0.25, box["y"] + box["height"] / 2)
        page.mouse.down()
        page.mouse.move(box["x"] + box["width"] * 0.34, box["y"] + box["height"] / 2, steps=6)
        page.mouse.up()
        page.wait_for_timeout(400)
        scrubbed = int(slider.get_attribute("aria-valuenow"))
        expect("scrubbing snaps to the quarter hour", scrubbed % 15, 0)

        dialog.get_by_role("textbox").fill("5h30")
        page.keyboard.press("Enter")
        page.wait_for_timeout(400)
        expect("a typed goal lands", slider.get_attribute("aria-valuenow"), "330")
        dialog.get_by_role("button", name=re.compile("^Free time")).click()
        page.wait_for_timeout(400)
        expect("reset goes back to free time", "free" in trigger.inner_text(), True)
        page.keyboard.press("Escape")
        page.keyboard.press("ControlOrMeta+z")
        page.wait_for_timeout(600)
        expect("Cmd+Z undoes the reset", "goal" in trigger.inner_text(), True)

        blocks_before = page.locator("[data-block-id]").count()
        column.get_by_role("button", name=re.compile("^Spread today")).click()
        bar = page.get_by_role("region", name="Spread across the day")
        bar.wait_for()
        page.wait_for_timeout(700)
        ghosts = page.locator("[data-spread-preview]").count()
        print(f"info  {bar.inner_text().splitlines()[0]}")
        expect("the spread previews ghost blocks first", ghosts > 0, True)
        expect("nothing is written before confirming", page.locator("[data-block-id]").count(), blocks_before)
        page.screenshot(path=str(OUT / f"spread-preview-{THEME}.png"))

        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        expect("Escape cancels the preview", page.locator("[data-spread-preview]").count(), 0)

        page.keyboard.press("ControlOrMeta+k")
        page.wait_for_selector("[cmdk-root]")
        page.keyboard.type("spread")
        page.wait_for_timeout(150)
        expect("the command bar offers Spread", page.locator("[cmdk-item]", has_text="Spread today across the day").count(), 1)
        page.keyboard.press("Enter")
        bar.wait_for()
        page.get_by_role("button", name=re.compile("^Place blocks")).click()
        page.wait_for_timeout(900)
        expect("confirming places every previewed block", page.locator("[data-block-id]").count(), blocks_before + ghosts)
        page.screenshot(path=str(OUT / f"spread-placed-{THEME}.png"))
        page.get_by_role("button", name="Undo").first.click()
        page.wait_for_timeout(900)
        expect("one undo removes the whole spread", page.locator("[data-block-id]").count(), blocks_before)
        browser.close()
    sys.exit(1 if failed else 0)


main()
