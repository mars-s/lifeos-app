"""The AI mark, the glimm band and the Trip loading state on the Task card, end to end.

Needs the throwaway backend from local-backend.sh and the web app running in dev mode:

    SCRATCH=/tmp/lifeos-local-backend sh scripts/local-backend.sh
    (cd $SCRATCH && CONVEX_AGENT_MODE=anonymous npx convex dev --typecheck disable) &
    WAKU_PUBLIC_CONVEX_URL=<its VITE_CONVEX_URL> npx waku dev --port 4061 &
    SCRATCH=/tmp/lifeos-local-backend CONVEX_URL=<its VITE_CONVEX_URL> uv run --with playwright python scripts/check-ai-motion.py <output folder>

No model or map search is called: scratch:tripState, scratch:stepsThinking, scratch:suggestSteps and
scratch:suggestEstimate store each state the way the backend would. The map tiles come from OpenFreeMap.
THEME (light or dark) and MOTION=reduced-motion change the run. RECORD=1 also saves a recording as
app-ai-motion.webm. It exits non-zero on a failure.
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
REDUCED = os.environ.get("MOTION") == "reduced-motion"
RECORD = os.environ.get("RECORD") == "1"
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
NAMESPACE = re.sub(r"[^a-zA-Z0-9]", "", CONVEX_URL)
TITLE = "Get moleskine notebooks from officeworks"
STEPS = ["Check which notebooks are left", "Drive to Officeworks", "Buy three ruled notebooks"]
SUFFIX = f"{THEME}{'-reduced' if REDUCED else ''}"
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
    convex("scratch:storeSecret", json.dumps({"last4": "sk42", "name": "openai"}))
    convex("scratch:seedPlaces", json.dumps({"title": TITLE}))
    convex("scratch:tripState", json.dumps({"title": TITLE, "state": "looking"}))
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        context = browser.new_context(
            viewport={"width": 1280, "height": 900},
            color_scheme=THEME,
            device_scale_factor=2,
            reduced_motion="reduce" if REDUCED else "no-preference",
            **({"record_video_dir": str(OUT), "record_video_size": {"width": 1280, "height": 900}} if RECORD else {}),
        )
        page = context.new_page()
        page.on("pageerror", lambda error: failed.append(f"page error: {error}") or print(f"FAIL  page error: {error}"))
        page.goto(f"{BASE}/design")
        page.evaluate(
            "([namespace, s]) => { localStorage.setItem(`__convexAuthJWT_${namespace}`, s.accessToken);"
            " localStorage.setItem(`__convexAuthRefreshToken_${namespace}`, s.refreshToken); }",
            [NAMESPACE, session],
        )

        def shoot(name):
            box = card.bounding_box()
            page.screenshot(path=str(OUT / f"{name}-{SUFFIX}.png"), clip={**box, "y": box["y"] - 8, "height": box["height"] + 16})

        def band_drawn(scope):
            canvas = scope.locator("canvas[aria-hidden=true]").first
            frames = set()
            for _ in range(6):
                frames.add(canvas.screenshot())
                page.wait_for_timeout(250)
            return len(frames) > 1

        page.goto(f"{BASE}/settings")
        features = page.locator("section", has=page.get_by_role("heading", name="Features"))
        features.get_by_role("link", name="AI").wait_for()
        page.wait_for_timeout(500)
        expect("the AI Feature wears the band mark", features.locator("svg path[d='M76 196 196 76']").count(), 1)
        features.screenshot(path=str(OUT / f"app-ai-mark-settings-{SUFFIX}.png"))

        page.goto(f"{BASE}/today")
        page.wait_for_selector("#main [data-task-key]")
        page.wait_for_timeout(800)
        row = page.locator("#main [data-task-key]", has_text=TITLE).first
        row.locator("[data-arrow-item]").first.click()
        page.keyboard.press("Enter")
        card = page.locator("[data-open-card]").first

        looking = card.locator("section[aria-label='Finding a trip']")
        looking.wait_for()
        expect("a Trip being looked up names the place", looking.get_by_role("status").inner_text(), "Finding the nearest Officeworks…")
        expect("and marks itself busy", looking.get_attribute("aria-busy"), "true")
        page.wait_for_timeout(1400)
        if REDUCED:
            expect("reduced motion draws no moving band", band_drawn(looking), False)
            expect(
                "and the mark stands still",
                looking.locator("svg path").first.evaluate("el => getComputedStyle(el).animationName"),
                "none",
            )
        else:
            expect("the band is moving over the placeholder", band_drawn(looking), True)
        before = looking.bounding_box()
        frame_before = looking.locator("div.h-36").bounding_box()
        shoot("app-trip-loading")

        convex("scratch:tripState", json.dumps({"title": TITLE, "state": "found"}))
        trip = card.locator("section[aria-label^='Trip to']")
        trip.wait_for()
        expect("the found Trip takes the placeholder's place", trip.get_attribute("aria-label"), "Trip to Officeworks, Ultimo")
        page.wait_for_timeout(700)
        after = trip.bounding_box()
        frame_after = trip.locator("div.h-36").bounding_box()
        expect("the map lands exactly where the placeholder was", frame_after, frame_before)
        expect("and the card does not jump", (after["y"], after["height"]), (before["y"], before["height"]))
        page.wait_for_selector(".trip-map canvas", timeout=20_000)
        page.wait_for_timeout(3500)
        shoot("app-trip-found")

        convex("scratch:tripState", json.dumps({"title": TITLE, "state": "failed"}))
        again = card.get_by_role("button", name="Try again")
        again.wait_for()
        page.wait_for_timeout(600)
        expect("a failed search says so", card.get_by_text("Could not find the nearest Officeworks just now.").count(), 1)
        shoot("app-trip-failed")
        again.click()
        looking.wait_for()
        expect("Try again looks at once", looking.get_by_role("status").inner_text(), "Finding the nearest Officeworks…")
        convex("scratch:tripState", json.dumps({"title": TITLE, "state": "found"}))
        trip.wait_for()

        tool = card.get_by_role("button", name="Break into steps").first
        tool.wait_for()
        expect("the Break into steps tool wears the band mark", tool.locator("svg path[d='M76 196 196 76']").count(), 1)
        convex("scratch:stepsThinking", json.dumps({"title": TITLE}))
        convex("scratch:suggestEstimate", json.dumps({"title": TITLE, "state": "thinking"}))
        preview = card.get_by_role("region", name="Suggested steps")
        preview.wait_for()
        preview.get_by_role("status").wait_for(state="attached")
        page.wait_for_timeout(1500)
        if not REDUCED:
            expect("the band moves over the steps while the model thinks", band_drawn(preview), True)
            expect(
                "and the mark in the header pulses",
                preview.locator("h3 svg path").first.evaluate("el => getComputedStyle(el).animationName"),
                "pending",
            )
        shoot("app-ai-motion")

        convex("scratch:suggestSteps", json.dumps({"title": TITLE, "steps": STEPS}))
        convex(
            "scratch:suggestEstimate",
            json.dumps({"title": TITLE, "guesses": [{"minutes": 30, "probability": 0.71}, {"minutes": 60, "probability": 0.2}], "reason": "A short shop."}),
        )
        preview.get_by_role("button", name="Add 3 steps").wait_for()
        card.get_by_role("button", name=re.compile("the best guess")).wait_for()
        page.wait_for_timeout(1600)
        expect(
            "once the steps land the mark rests",
            preview.locator("h3 svg path").first.evaluate("el => getComputedStyle(el).animationName"),
            "none",
        )
        shoot("app-ai-rest")
        context.close()
        if RECORD:
            page.video.save_as(str(OUT / f"app-ai-motion-{SUFFIX}.webm"))
        browser.close()
    if failed:
        print(f"{len(failed)} failed")
        sys.exit(1)


main()
