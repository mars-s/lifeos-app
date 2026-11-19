"""The Smart Estimate chip on the Task card, end to end.

Needs the throwaway backend from local-backend.sh and the web app running:

    SCRATCH=/tmp/lifeos-local-backend sh scripts/local-backend.sh
    (cd $SCRATCH && CONVEX_AGENT_MODE=anonymous npx convex dev) &
    WAKU_PUBLIC_CONVEX_URL=http://127.0.0.1:3210 npx waku dev --port 4048 &
    SCRATCH=/tmp/lifeos-local-backend uv run --with playwright python scripts/check-smart-estimate.py <output folder>

No OpenAI call is made: scratch:suggestEstimate stores the suggestion the way suggest would.
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
    session = json.loads(convex("scratch:signIn"))
    convex("scratch:suggestEstimate", json.dumps({"title": TITLE, "minutes": 15, "reason": REASON}))
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
        chip = group.get_by_role("button", name="0:15, suggested")
        chip.wait_for()
        expect("the suggested chip is marked", chip.count(), 1)
        expect("only one chip is suggested", group.locator("button[aria-label$='suggested']").count(), 1)
        expect("the suggestion does not set the Estimate", chip.get_attribute("aria-pressed"), "false")

        chip.hover()
        tooltip = page.get_by_role("tooltip").filter(has_text="Book a physio")
        tooltip.wait_for(state="visible")
        expect("hovering shows the reason", tooltip.inner_text(), REASON)
        card = page.locator("[data-open-card]").first
        box = card.bounding_box()
        page.screenshot(path=str(OUT / f"smart-estimate-card-{THEME}.png"), clip={**box, "y": box["y"] - 8, "height": box["height"] + 16})

        chip.click()
        page.wait_for_timeout(400)
        selected = group.get_by_role("button", name="0:15")
        expect("one click sets the Estimate", selected.get_attribute("aria-pressed"), "true")
        expect("the suggestion steps aside once set", group.locator("button[aria-label$='suggested']").count(), 0)
        page.get_by_text("Estimate set to 0:15").first.wait_for()
        expect("the change offers undo", page.get_by_role("button", name="Undo").count() > 0, True)
        page.get_by_role("button", name="Undo").first.click()
        page.wait_for_timeout(600)
        expect("undo brings the suggestion back", group.get_by_role("button", name="0:15, suggested").count(), 1)

        convex("scratch:suggestEstimate", json.dumps({"title": TITLE, "minutes": 45, "reason": "Like “Review the onboarding copy”, which took 0:30. You usually run 33% over on Tasks like this, so not 0:30."}))
        extra = group.get_by_role("button", name="0:45, suggested")
        extra.wait_for()
        expect("a suggestion off the usual chips gets its own chip", extra.count(), 1)
        card.screenshot(path=str(OUT / f"smart-estimate-extra-{THEME}.png"))

        page.keyboard.press("Escape")
        page.keyboard.press("ControlOrMeta+k")
        page.wait_for_selector("[cmdk-root]")
        page.keyboard.type("smart")
        page.wait_for_timeout(150)
        item = page.locator("[cmdk-item]", has_text="Turn Smart Estimates off")
        expect("the command bar offers the switch", item.count(), 1)
        page.screenshot(path=str(OUT / f"smart-estimate-bar-{THEME}.png"))
        page.keyboard.press("Enter")
        page.wait_for_timeout(500)
        page.keyboard.press("ControlOrMeta+k")
        page.keyboard.type("smart")
        page.wait_for_timeout(150)
        expect("the switch flips", page.locator("[cmdk-item]", has_text="Turn Smart Estimates on").count(), 1)
        page.keyboard.press("Enter")
        browser.close()
    sys.exit(1 if failed else 0)


main()
