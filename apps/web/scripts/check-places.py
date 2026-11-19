"""Features in Settings, the Places page and a Trip on the Task card, end to end.

Needs the throwaway backend from local-backend.sh and the web app running in dev mode:

    SCRATCH=/tmp/lifeos-local-backend sh scripts/local-backend.sh
    (cd $SCRATCH && CONVEX_AGENT_MODE=anonymous npx convex dev) &
    WAKU_PUBLIC_CONVEX_URL=http://127.0.0.1:3210 npx waku dev --port 4061 &
    SCRATCH=/tmp/lifeos-local-backend uv run --with playwright python scripts/check-places.py <output folder>

scratch:seedPlaces stands in for a saved Home and a Trip found by Places, so nothing is sent to OpenStreetMap or OpenAI.
The map tiles come from OpenFreeMap, so the map needs the network.
BASE, CONVEX_URL and THEME (light or dark) change the run. It exits non-zero on a failure.
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:4061")
CONVEX_URL = os.environ.get("CONVEX_URL", "http://127.0.0.1:3210")
SCRATCH = os.environ.get("SCRATCH", "/tmp/lifeos-local-backend")
THEME = os.environ.get("THEME", "light")
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
NAMESPACE = re.sub(r"[^a-zA-Z0-9]", "", CONVEX_URL)
TITLE = "Get moleskine notebooks from officeworks"
MOD = "Meta" if sys.platform == "darwin" else "Control"
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
    convex("scratch:seed", json.dumps({}))
    convex("scratch:storeSecret", json.dumps({"last4": "test"}))
    convex("scratch:seedPlaces", json.dumps({"title": TITLE}))
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        context = browser.new_context(viewport={"width": 1280, "height": 900}, color_scheme=THEME, device_scale_factor=2)
        page = context.new_page()
        page.on("pageerror", lambda error: failed.append(f"page error: {error}") or print(f"FAIL  page error: {error}"))
        page.goto(f"{BASE}/design")
        page.evaluate(
            "([namespace, s]) => { localStorage.setItem(`__convexAuthJWT_${namespace}`, s.accessToken);"
            " localStorage.setItem(`__convexAuthRefreshToken_${namespace}`, s.refreshToken); }",
            [NAMESPACE, session],
        )

        def path():
            return page.evaluate("location.pathname")

        def lamp(title):
            return feature_row(title).get_by_role("status").inner_text().split("\n")[0]

        def feature_row(title):
            return page.locator("#main div.px-3\\.5", has=page.get_by_role("link", name=title, exact=True)).first

        page.goto(f"{BASE}/settings")
        features = page.locator("section", has=page.get_by_role("heading", name="Features"))
        features.get_by_role("link", name="Places").wait_for()
        page.wait_for_timeout(600)
        expect("every Feature has a row", features.get_by_role("link").all_inner_texts(), ["Smart Estimates", "Places"])
        expect("Places says it is on", lamp("Places"), "On")
        expect("Smart Estimates says it is on", lamp("Smart Estimates"), "On")
        expect("each row has its own switch", features.get_by_role("switch").count(), 2)
        features.screenshot(path=str(OUT / f"app-settings-features-{THEME}.png"))

        switch = feature_row("Smart Estimates").get_by_role("switch")
        switch.click()
        page.wait_for_timeout(400)
        expect("the switch flips in the same frame without opening the page", (switch.get_attribute("aria-checked"), path()), ("false", "/settings"))
        expect("and the row says Off", lamp("Smart Estimates"), "Off")
        page.keyboard.press(f"{MOD}+z")
        page.wait_for_timeout(500)
        expect("Cmd+Z switches it back on", switch.get_attribute("aria-checked"), "true")

        features.get_by_role("link", name="Places").click()
        page.get_by_role("heading", name="Places", level=1).wait_for()
        page.wait_for_url("**/settings/features/places")
        expect("the row opens its own page", path(), "/settings/features/places")
        page.get_by_text("12 Harbour Street, Haymarket").wait_for()
        page.get_by_text("Key saved, ends in").wait_for()
        expect("Home is saved", page.get_by_text("12 Harbour Street, Haymarket").count(), 1)
        expect("Work and Uni wait for an address", page.get_by_role("textbox").count(), 2)
        expect("the page says where the address goes", page.get_by_text("goes once to OpenStreetMap").count(), 1)
        expect("and that public transport is not there yet", page.get_by_text("Public transport is not available yet.").count(), 1)
        expect("the key Places needs is on its page", page.get_by_text("Key saved, ends in").count(), 1)
        page.wait_for_timeout(500)
        page.screenshot(path=str(OUT / f"app-settings-places-{THEME}.png"), full_page=True)

        page.get_by_role("radio", name="Walk").click()
        page.wait_for_timeout(600)
        expect("the Travel Mode changes", page.get_by_role("radio", name="Walk").get_attribute("aria-checked"), "true")
        page.keyboard.press(f"{MOD}+z")
        page.wait_for_timeout(600)
        expect("and undoes", page.get_by_role("radio", name="Drive").get_attribute("aria-checked"), "true")

        page.locator("#main").get_by_role("link", name="Settings", exact=True).click()
        page.get_by_role("heading", name="Settings", level=1).wait_for()
        page.wait_for_url("**/settings")
        expect("Back returns to Settings", path(), "/settings")

        page.keyboard.press("ControlOrMeta+k")
        page.wait_for_selector("[cmdk-root]")
        page.keyboard.type("places settings")
        page.wait_for_timeout(150)
        page.locator("[cmdk-item]", has_text="Places settings").first.click()
        page.get_by_role("heading", name="Places", level=1).wait_for()
        page.wait_for_url("**/settings/features/places")
        expect("the command bar jumps to a Feature page", path(), "/settings/features/places")

        page.goto(f"{BASE}/today")
        page.wait_for_selector("#main [data-task-key]")
        page.wait_for_timeout(800)
        row = page.locator("#main [data-task-key]", has_text=TITLE).first
        row.locator("[data-arrow-item]").first.click()
        page.keyboard.press("Enter")
        card = page.locator("[data-open-card]").first
        trip = card.locator("section[aria-label^='Trip to']")
        trip.wait_for()
        expect("the card names the nearest branch", trip.get_attribute("aria-label"), "Trip to Officeworks, Ultimo")
        expect("with distance and travel time", "1.9\u00a0km" in trip.inner_text() and "5\u00a0min" in trip.inner_text(), True)
        maps = trip.get_by_role("link", name="Open in Maps")
        expect("Open in Maps goes to Apple Maps", (maps.get_attribute("href") or "").startswith("https://maps.apple.com/?daddr=-33.8813"), True)
        page.wait_for_selector(".trip-map canvas", timeout=20_000)
        page.wait_for_timeout(4000)
        box = card.bounding_box()
        page.screenshot(path=str(OUT / f"app-task-place-map-{THEME}.png"), clip={**box, "y": box["y"] - 8, "height": box["height"] + 16})

        trip.get_by_role("button", name="Other branches").click()
        trip.get_by_role("button", name=re.compile("^Officeworks Alexandria")).click()
        page.wait_for_timeout(300)
        expect("another branch can be picked", trip.get_attribute("aria-label"), "Trip to Officeworks, Alexandria")
        trip.get_by_role("button", name="Dismiss").click()
        page.wait_for_timeout(300)
        expect("dismissing hides the Trip", card.locator("section[aria-label^='Trip to']").count(), 0)
        page.keyboard.press(f"{MOD}+z")
        card.locator("section[aria-label^='Trip to']").wait_for()
        expect("and Cmd+Z brings it back", card.locator("section[aria-label^='Trip to']").get_attribute("aria-label"), "Trip to Officeworks, Alexandria")
        browser.close()
    if failed:
        print(f"{len(failed)} failed")
        sys.exit(1)


main()
