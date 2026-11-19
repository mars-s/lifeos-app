"""The welcome moment, its hand-off into the setup steps and the closing beat, end to end.

Needs the throwaway backend from local-backend.sh and the web app running in dev mode
(see check-settings.py for the commands), plus ffmpeg for the recording.

    SCRATCH=/tmp/lifeos-local-backend python scripts/check-welcome.py <output folder>

BASE, CONVEX_URL, THEME (light or dark) and MOTION (reduce) change the run.
The welcome is replayed with ?welcome (dev builds only), which never stores that setup finished.
It prints ok or FAIL per step, saves welcome-<theme>.png, closing-<theme>.png,
welcome-frames-<theme>.png and welcome-<theme>.mp4, and exits non-zero on a failure.
"""

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:4041")
CONVEX_URL = os.environ.get("CONVEX_URL", "http://127.0.0.1:3210")
SCRATCH = os.environ.get("SCRATCH", "/tmp/lifeos-local-backend")
THEME = os.environ.get("THEME", "light")
MOTION = os.environ.get("MOTION", "no-preference")
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
NAMESPACE = re.sub(r"[^a-zA-Z0-9]", "", CONVEX_URL)
SIZE = {"width": 1280, "height": 800}
FRAME_AT_MS = [120, 420, 700, 1000, 1500, 2100]
CROP = {"x": 340, "y": 160, "width": 600, "height": 460}
failed = []


def convex(function, args="{}"):
    return subprocess.check_output(["npx", "convex", "run", function, args], cwd=SCRATCH, text=True)


def expect(step, got, wanted):
    if got == wanted:
        print(f"ok    {step}")
    else:
        print(f"FAIL  {step}: wanted {wanted!r}, got {got!r}")
        failed.append(step)


def signed_in(browser, session, **options):
    context = browser.new_context(viewport=SIZE, color_scheme=THEME, reduced_motion=MOTION, **options)
    page = context.new_page()
    page.on("pageerror", lambda error: failed.append(f"page error: {error}") or print(f"FAIL  page error: {error}"))
    page.goto(f"{BASE}/design")
    page.evaluate(
        "([namespace, s]) => { localStorage.setItem(`__convexAuthJWT_${namespace}`, s.accessToken);"
        " localStorage.setItem(`__convexAuthRefreshToken_${namespace}`, s.refreshToken); }",
        [NAMESPACE, session],
    )
    return context, page


def title(page):
    return page.evaluate("document.querySelector('[role=dialog] h2 [torph-sr]')?.textContent ?? document.querySelector('[role=dialog] h2')?.textContent")


def visit(page, where):
    page.goto(f"{BASE}/{where}")
    page.wait_for_selector("nav[aria-label=Lists] a")


def replay_from_command_bar(page):
    page.keyboard.press("ControlOrMeta+k")
    page.wait_for_selector("[cmdk-root]")
    page.keyboard.type("replay welcome")
    page.wait_for_timeout(150)
    page.keyboard.press("Enter")
    page.get_by_role("dialog").get_by_role("heading").wait_for()


def walk_the_steps(page):
    setup = page.get_by_role("dialog")
    for _ in range(4):
        setup.get_by_role("button").filter(has_text=re.compile("Skip|Not now|Continue")).first.click()
        page.wait_for_timeout(350)
    return setup


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    session = json.loads(convex("scratch:signIn"))
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context, page = signed_in(browser, session)
        setup = page.get_by_role("dialog")

        visit(page, "today?__mac=fresh")
        setup.get_by_role("heading").wait_for()
        if MOTION == "reduce":
            expect("reduced motion shows the greeting and the button at once", setup.get_by_role("button", name="Get started").is_visible(), True)
        else:
            expect("the welcome opens on the wordmark", title(page), "LifeOS")
            expect("the button waits for the mark to arrive", setup.locator("[inert] button").count(), 1)
            page.keyboard.press("Enter")
            page.wait_for_timeout(120)
            expect("any key skips to the end of the arrival, and does not start setup", [setup.locator("[inert] button").count(), setup.get_by_role("button", name="Get started").count()], [0, 1])
        page.wait_for_timeout(700)
        expect("the greeting names Avi", bool(re.fullmatch(r"Good (morning|afternoon|evening), Avi", title(page))), True)
        expect("Get started holds the focus", page.evaluate("document.activeElement?.textContent"), "Get started")
        page.screenshot(path=str(OUT / f"welcome-{THEME}.png"))
        setup.get_by_role("button", name="Get started").click()
        setup.get_by_role("heading", name="Apple Calendar").wait_for()
        expect("Get started lands on step one", setup.get_by_text("1 of 4").count(), 1)
        page.wait_for_timeout(600)
        walk_the_steps(page)
        expect("the last screen sums it up", setup.get_by_role("heading").inner_text(), "This Mac is ready")
        setup.get_by_role("button", name="Open LifeOS").click()
        setup.get_by_role("heading", name="You’re set").wait_for()
        page.wait_for_timeout(800)
        page.screenshot(path=str(OUT / f"closing-{THEME}.png"))
        setup.wait_for(state="detached", timeout=4000)
        expect("the closing beat lands in the app on its own", page.get_by_role("dialog").count(), 0)

        visit(page, "today?__mac=ready")
        page.wait_for_timeout(600)
        expect("a Mac that finished setup sees no welcome", page.get_by_role("dialog").count(), 0)
        replay_from_command_bar(page)
        expect("Replay Welcome in the command bar shows it again", setup.get_by_role("heading").count(), 1)
        setup.get_by_role("button", name="Get started").click()
        setup.get_by_role("heading", name="Apple Calendar").wait_for()
        walk_the_steps(page)
        setup.get_by_role("button", name="Open LifeOS").click()
        page.keyboard.press("Escape")
        setup.wait_for(state="detached", timeout=2000)
        expect("any key skips the closing beat", page.get_by_role("dialog").count(), 0)

        visit(page, "today?__mac=ready&welcome")
        setup.get_by_role("heading").wait_for()
        expect("?welcome replays it in a dev build", setup.get_by_role("heading").count(), 1)
        visit(page, "today?__mac=ready")
        page.wait_for_timeout(600)
        expect("a replay does not change what the Mac remembers", page.get_by_role("dialog").count(), 0)

        if MOTION != "reduce":
            frames = []
            page.goto(f"{BASE}/today?__mac=fresh")
            setup.get_by_role("heading").wait_for(state="attached")
            started = page.evaluate("performance.now()")
            for index, at in enumerate(FRAME_AT_MS):
                page.wait_for_timeout(max(0, at - (page.evaluate("performance.now()") - started)))
                frame = OUT / f"frame-{index}.png"
                page.screenshot(path=str(frame), clip=CROP)
                frames.append(frame)
            strip = OUT / f"welcome-frames-{THEME}.png"
            inputs = [part for frame in frames for part in ("-i", str(frame))]
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", f"hstack=inputs={len(frames)}", str(strip)], check=True)
            for frame in frames:
                frame.unlink()
            print(f"saved {strip}")
        context.close()

        if MOTION != "reduce":
            video_dir = OUT / "video"
            rolling = time.monotonic()
            context, page = signed_in(browser, json.loads(convex("scratch:signIn")), record_video_dir=str(video_dir), record_video_size=SIZE)
            setup = page.get_by_role("dialog")
            page.goto(f"{BASE}/today?__mac=fresh")
            setup.get_by_role("heading").wait_for(state="attached")
            lead = max(0.0, time.monotonic() - rolling - 0.25)
            page.wait_for_timeout(2900)
            setup.get_by_role("button", name="Get started").click()
            page.wait_for_timeout(1300)
            walk_the_steps(page)
            page.wait_for_timeout(700)
            setup.get_by_role("button", name="Open LifeOS").click()
            setup.wait_for(state="detached", timeout=4000)
            page.wait_for_timeout(1200)
            source = page.video.path()
            context.close()
            film = OUT / f"welcome-{THEME}.mp4"
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-i", str(source), "-ss", f"{lead:.2f}", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart", str(film)],
                check=True,
            )
            Path(source).unlink()
            video_dir.rmdir()
            print(f"saved {film}")
        browser.close()
    if failed:
        print(f"\n{len(failed)} failed")
        sys.exit(1)
    print("\nall passed")


main()
