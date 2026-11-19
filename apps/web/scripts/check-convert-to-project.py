"""Convert to Project from the Task menu, the command bar and the Big one hint, with Undo, end to end.

Needs the throwaway backend from local-backend.sh and the web app running:

    SCRATCH=/tmp/lifeos-local-backend sh scripts/local-backend.sh
    (cd $SCRATCH && CONVEX_AGENT_MODE=anonymous npx convex dev --typecheck disable) &
    WAKU_PUBLIC_CONVEX_URL=http://127.0.0.1:3210 npx waku dev --port 4048 &
    SCRATCH=/tmp/lifeos-local-backend uv run --with playwright python scripts/check-convert-to-project.py <output folder>

BASE, CONVEX_URL, THEME (light or dark) and WIDTH (1440 or 390) change the run. It reseeds the backend and exits non-zero on a failure.
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
WIDTH = int(os.environ.get("WIDTH", "1440"))
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
NAMESPACE = re.sub(r"[^a-zA-Z0-9]", "", CONVEX_URL)
PICKER = "Wire up the vault picker"
PARCEL = "Pick up the parcel from the post office"
BIG = [{"minutes": 1530, "probability": 0.05}, {"minutes": 2550, "probability": 0.79}, {"minutes": 5100, "probability": 0.15}]
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
    convex("scratch:seed")
    session = json.loads(convex("scratch:signIn"))
    convex("scratch:storeSecret", json.dumps({"last4": "test"}))
    convex("scratch:switchAi", json.dumps({"on": True}))
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

        def shot(name):
            page.wait_for_timeout(500)
            page.screenshot(path=str(OUT / f"convert-{name}-{WIDTH}-{THEME}.png"))

        def row(title):
            return page.locator("#main [data-task-key]", has_text=title).first

        def on_project():
            page.wait_for_url(re.compile(r"/project\?id="), timeout=8000)
            page.locator("#main [data-task-key]").first.wait_for()

        def titles():
            return [each.inner_text().split("\n")[0] for each in page.locator("#main [data-task-key]").all()]

        def undo_back(to):
            page.get_by_role("button", name="Undo").first.click()
            page.wait_for_url(re.compile(f"/{to}$"), timeout=8000)
            row(PICKER if to == "anytime" else PARCEL).wait_for()

        try:
            steps(page, shot, row, on_project, titles, undo_back)
        except Exception:
            page.screenshot(path=str(OUT / f"convert-failure-{WIDTH}-{THEME}.png"))
            raise
        browser.close()
    if failed:
        sys.exit(f"{len(failed)} check(s) failed")


def steps(page, shot, row, on_project, titles, undo_back):
        page.goto(f"{BASE}/anytime")
        row(PICKER).wait_for()
        page.wait_for_timeout(800)
        row(PICKER).click(button="right")
        page.get_by_role("menuitem", name="Convert to Project").click()
        on_project()
        expect("the menu opens the new Project", page.get_by_role("heading", name=PICKER).count() >= 1, True)
        expect("the open Checklist Item is a Task in it", "Empty state" in titles(), True)
        shot("menu")
        undo_back("anytime")
        expect("Undo brings the Task back and leaves the Project", row(PICKER).count(), 1)
        shot("undone")

        row(PICKER).locator("[data-arrow-item]").first.click()
        page.keyboard.press("Meta+k")
        page.get_by_role("dialog").get_by_role("combobox").fill("convert")
        page.get_by_role("option", name="Convert to Project").wait_for()
        page.keyboard.press("Enter")
        on_project()
        expect("the command bar opens the new Project", "Empty state" in titles(), True)
        undo_back("anytime")

        convex("scratch:suggestEstimate", json.dumps({"title": PARCEL, "guesses": BIG, "reason": "From the title."}))
        page.goto(f"{BASE}/today")
        row(PARCEL).wait_for()
        page.wait_for_timeout(800)
        row(PARCEL).locator("[data-arrow-item]").first.click()
        page.keyboard.press("Enter")
        hint = page.get_by_role("button", name="Make it a Project")
        hint.wait_for()
        page.locator("[data-open-card]").first.screenshot(path=str(OUT / f"convert-card-{WIDTH}-{THEME}.png"))
        hint.click()
        page.wait_for_url(re.compile(r"/project\?id="), timeout=8000)
        page.get_by_role("heading", name=PARCEL).first.wait_for()
        expect("the hint opens an empty Project with the Task's title", page.locator("#main [data-task-key]").count(), 0)
        shot("hint")
        undo_back("today")
        expect("Undo puts the parcel back in Today", row(PARCEL).count(), 1)


main()
