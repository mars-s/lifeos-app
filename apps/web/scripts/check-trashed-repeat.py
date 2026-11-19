"""A repeating Task in the Trash pauses its rule, so its ghosts leave the Planner until it comes back (#66).

Needs the throwaway backend from local-backend.sh and the web app running:

    SCRATCH=/tmp/lifeos-local-backend sh scripts/local-backend.sh
    (cd $SCRATCH && CONVEX_AGENT_MODE=anonymous npx convex dev) &
    WAKU_PUBLIC_CONVEX_URL=http://127.0.0.1:3210 npx waku dev --port 4061 &
    SCRATCH=/tmp/lifeos-local-backend uv run --with playwright python scripts/check-trashed-repeat.py <output folder>

It reseeds the backend first. BASE, CONVEX_URL, THEME (light or dark) and WIDTH change the run. It exits non-zero on a failure.
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
WIDTH = int(os.environ.get("WIDTH", "1440"))
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
NAMESPACE = re.sub(r"[^a-zA-Z0-9]", "", CONVEX_URL)
TODAY = date.today().isoformat()
ZONE = subprocess.check_output(["node", "-e", "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)"], text=True).strip()
REPEATING = "Read two papers on retrieval"
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
        ghosts = page.locator("[data-plan-ghost]", has_text=REPEATING)

        def open_planner():
            page.goto(f"{BASE}/planner")
            page.locator("[data-plan-day]").first.wait_for()
            page.wait_for_timeout(1200)

        open_planner()
        shown = ghosts.count()
        print(f"info  {shown} ghosts of the repeating Task")
        expect("the repeating Task shows ghosts on the coming days", shown > 0, True)

        row = page.locator(f"[data-plan-day='{TODAY}'] [data-task-key]", has_text=REPEATING)
        row.locator("[data-arrow-item]").click()
        page.keyboard.press("Backspace")
        page.wait_for_timeout(900)
        expect("trashing it takes its ghosts away", ghosts.count(), 0)
        page.screenshot(path=str(OUT / f"trashed-repeat-{tag}.png"))

        page.keyboard.press("ControlOrMeta+z")
        page.wait_for_timeout(900)
        expect("undo brings the ghosts back", ghosts.count(), shown)

        row.locator("[data-arrow-item]").click()
        page.keyboard.press("Backspace")
        page.wait_for_timeout(900)
        expect("trashing it again takes them away again", ghosts.count(), 0)
        page.goto(f"{BASE}/trash")
        trashed = page.locator("#main [data-menu-trash^=task]", has_text=REPEATING)
        trashed.wait_for()
        trashed.locator("[data-arrow-item]").click()
        page.wait_for_timeout(900)
        open_planner()
        expect("putting it back from the Trash brings the ghosts back", ghosts.count(), shown)
        page.screenshot(path=str(OUT / f"restored-repeat-{tag}.png"))
        browser.close()
    sys.exit(1 if failed else 0)


main()
