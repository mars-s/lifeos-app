"""The Smart Estimate chip on the Task card, end to end.

Needs the throwaway backend from local-backend.sh and the web app running:

    SCRATCH=/tmp/lifeos-local-backend sh scripts/local-backend.sh
    (cd $SCRATCH && CONVEX_AGENT_MODE=anonymous npx convex dev) &
    WAKU_PUBLIC_CONVEX_URL=http://127.0.0.1:3210 npx waku dev --port 4048 &
    SCRATCH=/tmp/lifeos-local-backend uv run --with playwright python scripts/check-smart-estimate.py <output folder>

No OpenAI call is made: scratch:suggestEstimate stores the guesses (or a thinking or vague state) the way suggest would.
BASE, CONVEX_URL and THEME (light or dark) change the run. It exits non-zero on a failure.
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:4048")
CONVEX_URL = os.environ.get("CONVEX_URL", "http://127.0.0.1:3210")
SCRATCH = os.environ.get("SCRATCH", "/tmp/lifeos-local-backend")
THEME = os.environ.get("THEME", "light")
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
NAMESPACE = re.sub(r"[^a-zA-Z0-9]", "", CONVEX_URL)
TITLE = "Pick up the parcel from the post office"
REASON = "Like “Book a physio appointment”, which took 0:12. You usually run 33% over, so not 0:10."
GUESSES = [{"minutes": 10, "probability": 0.05}, {"minutes": 15, "probability": 0.86}, {"minutes": 30, "probability": 0.09}]
failed = []


def convex(function, args="{}"):
    return subprocess.check_output(["npx", "convex", "run", function, args], cwd=SCRATCH, text=True)


def suggest(**fields):
    convex("scratch:suggestEstimate", json.dumps({"title": TITLE, **fields}))


def expect(step, got, wanted):
    if got == wanted:
        print(f"ok    {step}")
    else:
        print(f"FAIL  {step}: wanted {wanted!r}, got {got!r}")
        failed.append(step)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    session = json.loads(convex("scratch:signIn"))
    convex("scratch:storeSecret", json.dumps({"last4": "test"}))
    suggest(state="thinking")
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
        page.goto(f"{BASE}/today")
        page.wait_for_selector("#main [data-task-key]")
        page.wait_for_timeout(800)

        row = page.locator("#main [data-task-key]", has_text=TITLE).first
        row.locator("[data-arrow-item]").first.click()
        page.keyboard.press("Enter")
        group = page.locator("[role=group][aria-label=Estimate]").first
        card = page.locator("[data-open-card]").first

        def chip_labels():
            return [b.get_attribute("aria-label") or b.inner_text() for b in group.locator("button").all()]

        def shot(name):
            box = card.bounding_box()
            page.screenshot(path=str(OUT / f"smart-estimate-{name}-{THEME}.png"), clip={**box, "y": box["y"] - 8, "height": box["height"] + 16})

        group.get_by_text("Guessing an Estimate…").wait_for(state="attached")
        expect("while thinking, the presets are gone", chip_labels(), [])
        expect("three ghost chips hold the row", group.locator("span.h-7[aria-hidden=true]").count(), 3)
        shot("thinking")

        suggest(guesses=GUESSES, reason=REASON)
        best = group.get_by_role("button", name="0:15, 86% likely, the best guess")
        best.wait_for()
        expect("the guesses replace the presets, shortest first", chip_labels(), ["0:10, 5% likely", "0:15, 86% likely, the best guess", "0:30, 9% likely"])
        expect("a guess does not set the Estimate", best.get_attribute("aria-pressed"), "false")
        best.hover()
        tooltip = page.get_by_role("tooltip").filter(has_text="Book a physio")
        tooltip.wait_for(state="visible")
        expect("hovering the best guess shows its odds and reason", tooltip.inner_text(), f"86% likely. {REASON}")
        shot("guesses")

        best.click()
        page.wait_for_timeout(400)
        expect("one click sets the Estimate", best.get_attribute("aria-pressed"), "true")
        expect("the guesses stay after picking", len(chip_labels()), 3)
        page.get_by_text("Estimate set to 0:15").first.wait_for()
        page.get_by_role("button", name="Undo").first.click()
        page.wait_for_timeout(600)
        expect("undo clears it again", best.get_attribute("aria-pressed"), "false")

        suggest(guesses=[{"minutes": 1530, "probability": 0.05}, {"minutes": 2550, "probability": 0.79}, {"minutes": 5100, "probability": 0.15}], reason="From the title and notes.")
        week = group.get_by_role("button", name="1 week, 79% likely, the best guess")
        week.wait_for()
        expect("big guesses read in days and weeks", chip_labels()[:3], ["3 days, 5% likely", "1 week, 79% likely, the best guess", "2 weeks, 15% likely"])
        week.hover()
        expect(
            "the hover says what a day means",
            page.get_by_role("tooltip").filter(has_text="Working Hours").inner_text(),
            "79% likely. From the title and notes. A day here is your Working Hours, 8:30.",
        )
        expect("a big guess suggests splitting it", group.get_by_text("Big one. Split it into a Project?").count(), 1)
        shot("big")

        suggest(state="vague")
        group.get_by_text("Too vague to guess").wait_for()
        expect("a vague Task falls back to the presets", chip_labels(), ["0:10", "0:15", "0:30", "1:00", "2:00"])
        shot("vague")

        suggest(guesses=[{"minutes": 2550, "probability": 0.79}, {"minutes": 5100, "probability": 0.15}], reason="From the title and notes.")
        group.get_by_role("button", name="Break it into steps").click()
        page.wait_for_timeout(400)
        expect("breaking it into steps opens the Checklist", page.evaluate("document.activeElement?.closest('[data-open-card]') !== null && document.activeElement?.tagName"), "INPUT")
        page.keyboard.press("Escape")
        page.keyboard.press("ControlOrMeta+k")
        page.wait_for_selector("[cmdk-root]")
        page.keyboard.type("smart")
        page.wait_for_timeout(150)
        page.locator("[cmdk-item]", has_text="Turn Smart Estimates off").first.click()
        page.wait_for_timeout(500)
        row.locator("[data-arrow-item]").first.click()
        page.keyboard.press("Enter")
        group.get_by_role("button", name="2:00").wait_for()
        expect("off keeps the presets exactly as before", chip_labels(), ["0:10", "0:15", "0:30", "1:00", "2:00"])
        expect("off shows no note", group.locator("p[role=status]").count(), 0)
        page.keyboard.press("Escape")
        page.keyboard.press("ControlOrMeta+k")
        page.keyboard.type("smart")
        page.wait_for_timeout(150)
        page.locator("[cmdk-item]", has_text="Turn Smart Estimates on").first.click()
        browser.close()
    sys.exit(1 if failed else 0)


main()
