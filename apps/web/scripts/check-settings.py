"""Settings, the sidebar entry and first-run onboarding, end to end.

Needs the throwaway backend from local-backend.sh and the web app running in dev mode:

    SCRATCH=/tmp/lifeos-local-backend sh scripts/local-backend.sh
    (cd $SCRATCH && CONVEX_AGENT_MODE=anonymous npx convex dev) &
    WAKU_PUBLIC_CONVEX_URL=http://127.0.0.1:3210 npx waku dev --port 4041 &
    pip install playwright && playwright install chromium
    SCRATCH=/tmp/lifeos-local-backend python scripts/check-settings.py <output folder>

BASE, CONVEX_URL, THEME (light or dark) and MOTION (reduce) change the run.
The Mac app is stood in for by ?__mac=fresh, ready or trouble (dev builds only, see src/lib/mac.ts).
It prints ok or FAIL per step, saves screenshots and exits non-zero on a failure.
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:4041")
CONVEX_URL = os.environ.get("CONVEX_URL", "http://127.0.0.1:3210")
SCRATCH = os.environ.get("SCRATCH", "/tmp/lifeos-local-backend")
THEME = os.environ.get("THEME", "light")
MOTION = os.environ.get("MOTION", "no-preference")
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
NAMESPACE = re.sub(r"[^a-zA-Z0-9]", "", CONVEX_URL)
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
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 900}, color_scheme=THEME, reduced_motion=MOTION)
        page = context.new_page()
        page.on("pageerror", lambda error: failed.append(f"page error: {error}") or print(f"FAIL  page error: {error}"))
        page.goto(f"{BASE}/design")
        page.evaluate(
            "([namespace, s]) => { localStorage.setItem(`__convexAuthJWT_${namespace}`, s.accessToken);"
            " localStorage.setItem(`__convexAuthRefreshToken_${namespace}`, s.refreshToken); }",
            [NAMESPACE, session],
        )

        def shot(name):
            page.screenshot(path=str(OUT / f"{name}-{THEME}.png"))

        def path():
            return page.evaluate("location.pathname")

        def visit(where):
            page.goto(f"{BASE}/{where}")
            page.wait_for_selector("nav[aria-label=Lists] a")
            page.wait_for_timeout(900)

        def lamp(scope, word):
            return scope.locator("[role=status]", has_text=re.compile(rf"^\s*{word}"))

        def row(label):
            return page.locator("#main div.px-3\\.5", has=page.get_by_text(label, exact=True)).first

        visit("today")
        nav = page.locator("nav[aria-label=Lists]")
        expect("the sidebar no longer says Synced from Things", nav.get_by_text("from Things").count(), 0)
        expect("the sidebar has no Sign out button", nav.get_by_role("button", name="Sign out").count(), 0)
        expect("in a browser the Settings entry shows no warning", nav.get_by_text("needs attention").count(), 0)
        nav.get_by_role("link", name="Settings").click()
        page.wait_for_selector("h1:has-text('Settings')")
        expect("the Settings entry opens Settings", path(), "/settings")
        expect(
            "every section is there",
            page.locator("#main h2").all_inner_texts(),
            ["Account", "Permissions", "Connections and sync", "Features", "Keyboard"],
        )
        expect("the account names the GitHub login", row("@avi").count(), 1)
        expect("a browser explains that permissions live in the Mac app", row("These live in the Mac app").count(), 1)
        expect("a browser has no Import now button", page.get_by_role("button", name="Import now").count(), 0)
        expect("the Things Import shows its counts", "Tasks" in row("Things Import").inner_text(), True)
        expect("calendars can be switched from Settings", row("Apple Calendar").get_by_role("switch").count() > 0, True)
        smart = row("Templates").get_by_role("switch")
        expect("Templates has its switch under Features", smart.count(), 1)
        if smart.is_enabled():
            before = smart.get_attribute("aria-checked")
            smart.click()
            page.wait_for_timeout(200)
            expect("the switch flips in the same frame", smart.get_attribute("aria-checked") != before, True)
            page.keyboard.press("ControlOrMeta+z")
            page.wait_for_timeout(400)
            expect("and Cmd+Z puts it back", smart.get_attribute("aria-checked"), before)
        shot("settings-browser")

        page.get_by_role("button", name="Show").click()
        expect("Show opens the shortcut sheet", page.get_by_role("dialog", name="Keyboard shortcuts").count(), 1)
        expect("the sheet lists the Settings key", page.get_by_role("dialog").get_by_text("Settings", exact=True).count(), 1)
        page.keyboard.press("Escape")

        visit("today")
        page.keyboard.press("ControlOrMeta+,")
        page.wait_for_timeout(300)
        expect("Cmd+, opens Settings", path(), "/settings")
        visit("inbox")
        page.keyboard.press("ControlOrMeta+k")
        page.wait_for_selector("[cmdk-root]")
        page.keyboard.type("settings")
        page.wait_for_timeout(150)
        page.keyboard.press("Enter")
        page.wait_for_timeout(300)
        expect("the command bar goes to Settings", path(), "/settings")

        visit("settings?__mac=ready")
        expect("the Mac app shows three permissions", [row(name).count() for name in ["Apple Calendar", "Things data", "Keychain token"]], [1, 1, 1])
        expect("a granted permission says Allowed and offers no button", [lamp(row("Things data"), "Allowed").count(), row("Things data").get_by_role("button").count()], [1, 0])
        expect("onboarding stays away once it is finished", page.get_by_role("dialog").count(), 0)
        expect("nothing is wrong, so the Settings entry shows no warning", nav.get_by_text("needs attention").count(), 0)
        page.get_by_role("button", name="Import now").click()
        page.set_viewport_size({"width": 1440, "height": 1560})
        page.wait_for_timeout(300)
        shot("settings")
        page.set_viewport_size({"width": 390, "height": 1900})
        page.wait_for_timeout(300)
        shot("settings-phone")
        page.set_viewport_size({"width": 1440, "height": 900})

        visit("settings?__mac=trouble")
        expect("a refused calendar says so and offers System Settings", [lamp(row("Things data").locator("xpath=preceding-sibling::div"), "Not allowed").count(), page.get_by_role("button", name="Open System Settings").count()], [1, 1])
        expect("a missing token is named", lamp(page, "No token").count(), 1)
        expect("a failed send is reported", page.get_by_text("did not finish").count(), 1)
        expect("the Settings entry warns when something is wrong", nav.get_by_text("needs attention").count(), 1)
        shot("settings-trouble")

        visit("today?__mac=fresh")
        setup = page.get_by_role("dialog")
        setup.get_by_role("heading").wait_for()
        page.keyboard.press("Space")
        setup.get_by_role("button", name="Get started").click()
        setup.get_by_role("heading", name="Apple Calendar").wait_for()
        expect("first run opens the welcome, and Get started opens onboarding", setup.get_by_role("heading").inner_text(), "Apple Calendar")
        expect("it starts at step one, not asked", [setup.get_by_text("1 of 4").count(), lamp(setup, "Not asked").count()], [1, 1])
        page.wait_for_timeout(300)
        shot("onboarding")
        for index, title in enumerate(["Apple Calendar", "Things data", "Keychain token"]):
            expect(f"step {index + 1} is {title}", setup.get_by_role("heading").inner_text(), title)
            if index == 1:
                setup.get_by_role("button", name="Skip").click()
                continue
            setup.get_by_role("button", name="Allow").click()
            setup.get_by_role("button", name="Continue").wait_for()
            expect(f"{title} shows the real answer", lamp(setup, "Allowed").count(), 1)
            if index == 0:
                shot("onboarding-allowed")
            setup.get_by_role("button", name="Continue").click()
        expect("Oura is the last, optional step", [setup.get_by_role("heading").inner_text(), setup.get_by_text("4 of 4").count()], ["Oura", 1])
        setup.get_by_role("button").filter(has_text=re.compile("Not now|Continue")).click()
        setup.get_by_role("heading", name="This Mac is ready").wait_for()
        expect("the last screen sums it up", setup.get_by_role("heading").inner_text(), "This Mac is ready")
        expect("a skipped step reads as not asked", lamp(setup.locator("ul li", has_text="Things data"), "Not asked").count(), 1)
        page.wait_for_timeout(900)
        shot("onboarding-ready")
        setup.get_by_role("button", name="Open LifeOS").click()
        setup.wait_for(state="detached", timeout=4000)
        expect("onboarding closes and stays closed", page.get_by_role("dialog").count(), 0)
        expect("the skipped permission is flagged on the Settings entry", nav.get_by_text("needs attention").count(), 1)
        nav.get_by_role("link", name="Settings").click()
        page.wait_for_timeout(300)
        row("Things data").get_by_role("button", name="Allow").click()
        lamp(row("Things data"), "Allowed").wait_for(state="attached")
        expect("the skipped permission is one click from Settings", nav.get_by_text("needs attention").count(), 0)
        browser.close()
    if failed:
        print(f"\n{len(failed)} failed")
        sys.exit(1)
    print("\nall passed")


main()
