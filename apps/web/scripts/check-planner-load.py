"""Big Estimates and repeat ghosts in the Planner day columns and day meter (#54, #55).

Needs the throwaway backend from local-backend.sh and the web app running:

    SCRATCH=/tmp/lifeos-local-backend sh scripts/local-backend.sh
    (cd $SCRATCH && CONVEX_AGENT_MODE=anonymous npx convex dev) &
    WAKU_PUBLIC_CONVEX_URL=http://127.0.0.1:3210 npx waku dev --port 4061 &
    SCRATCH=/tmp/lifeos-local-backend uv run --with playwright python scripts/check-planner-load.py <output folder>

It reseeds the backend first. BASE, CONVEX_URL, THEME (light or dark) and WIDTH change the run. It exits non-zero on a failure.
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
WIDTH = int(os.environ.get("WIDTH", "1440"))
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
NAMESPACE = re.sub(r"[^a-zA-Z0-9]", "", CONVEX_URL)
TODAY = date.today()
ZONE = subprocess.check_output(["node", "-e", "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)"], text=True).strip()
BIG = "Write the thesis"
failed = []


def convex(function, args="{}"):
    return subprocess.check_output(["npx", "convex", "run", function, args], cwd=SCRATCH, text=True)


def expect(step, got, wanted):
    if got == wanted:
        print(f"ok    {step}")
    else:
        print(f"FAIL  {step}: wanted {wanted!r}, got {got!r}")
        failed.append(step)


def planned(column):
    return int(column.locator("[role=meter]").first.get_attribute("aria-valuenow"))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    convex("scratch:seed", json.dumps({"today": TODAY.isoformat(), "timeZone": ZONE}))
    session = json.loads(convex("scratch:signIn"))
    tag = f"{THEME}-{WIDTH}"
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": WIDTH, "height": 900}, color_scheme=THEME, device_scale_factor=2)
        page = context.new_page()
        page.on("pageerror", lambda error: failed.append(f"page error: {error}") or print(f"FAIL  page error: {error}"))
        page.goto(f"{BASE}/design")
        page.evaluate(
            "([namespace, s]) => { localStorage.setItem(`__convexAuthJWT_${namespace}`, s.accessToken);"
            " localStorage.setItem(`__convexAuthRefreshToken_${namespace}`, s.refreshToken); }",
            [NAMESPACE, session],
        )
        page.goto(f"{BASE}/planner")
        page.locator("[data-plan-day]").first.wait_for()
        page.wait_for_timeout(1200)

        ghosts = page.locator("[data-plan-ghost]")
        expect("repeats that are not made yet show as ghosts", ghosts.count() > 1, True)
        first_ghost_day = ghosts.first.evaluate("(row) => row.closest('[data-plan-day]').dataset.planDay")
        print(f"info  {ghosts.count()} ghosts, first on {first_ghost_day}")
        ghost_column = page.locator(f"[data-plan-day='{first_ghost_day}']")
        ghost_column.scroll_into_view_if_needed()
        expect("a ghost has no checkbox to tick", ghosts.first.get_by_role("checkbox").count(), 0)
        ghost_column.screenshot(path=str(OUT / f"ghost-column-{tag}.png"))

        tomorrow = (TODAY + timedelta(days=1)).isoformat()
        column = page.locator(f"[data-plan-day='{tomorrow}']")
        column.scroll_into_view_if_needed()
        before = planned(column)
        column.get_by_role("textbox", name=re.compile("^Add a Task to")).fill(BIG)
        page.keyboard.press("Enter")
        row = column.locator("[data-task-key]", has_text=BIG)
        row.wait_for()
        page.keyboard.press("Escape")
        row.get_by_role("button", name=f"Set an Estimate for {BIG}").click()
        field = page.get_by_role("textbox", name=re.compile("^Another Estimate"))
        field.fill("85h")
        page.keyboard.press("Enter")
        page.keyboard.press("Escape")
        page.wait_for_timeout(900)
        after = planned(column)
        print(f"info  tomorrow went from {before} to {after} minutes planned")
        expect("an 85 hour Estimate adds no more than one day's share", 0 < after - before <= 8 * 60 + 30, True)
        expect("the Task shows what is left for other days", row.get_by_text(re.compile(r"\d+:\d\d left")).count(), 1)
        column.screenshot(path=str(OUT / f"big-task-{tag}.png"))

        column.get_by_role("button", name=re.compile("^Spread ")).click()
        bar = page.get_by_role("region", name="Spread across the day")
        bar.wait_for()
        page.wait_for_timeout(700)
        heights = page.locator("[data-spread-preview]").evaluate_all("(blocks) => blocks.map((b) => b.getBoundingClientRect().height)")
        print(f"info  spread preview heights {heights}")
        page.screenshot(path=str(OUT / f"spread-big-{tag}.png"))
        page.keyboard.press("Escape")
        browser.close()
    sys.exit(1 if failed else 0)


main()
