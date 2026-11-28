"""The Timebox pane is the timeline (#88): predictions, keeping, Keep all, the rail and the named gaps, and the week view.

Needs the throwaway backend from local-backend.sh and the web app running:

    SCRATCH=/tmp/lifeos-local-backend sh scripts/local-backend.sh
    (cd $SCRATCH && CONVEX_AGENT_MODE=anonymous npx convex dev --typecheck disable) &
    WAKU_PUBLIC_CONVEX_URL=http://127.0.0.1:3210 npx waku dev --port 4061 &
    SCRATCH=/tmp/lifeos-local-backend uv run --with playwright python scripts/check-timeline.py <output folder>

It reseeds the backend and sets the browser's clock to NOW today (12:40 unless set), then in light and dark at 1440 px and 390 px it shoots the day pane and the week
pane, and in light at 1440 px, at 8 am, it keeps one prediction by click, one by Enter, one by drag, undoes them,
and keeps all with Cmd+Enter. BASE and CONVEX_URL change the run. It exits non-zero on a failure.
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
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
NAMESPACE = re.sub(r"[^a-zA-Z0-9]", "", CONVEX_URL)
ZONE = subprocess.check_output(["node", "-e", "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)"], text=True).strip()
TODAY = subprocess.check_output(["date", "+%F"], text=True).strip()
NOW = os.environ.get("NOW", "12:40")
ENV = {**os.environ, "CONVEX_AGENT_MODE": "anonymous"}
PANE = "section[aria-label='Timebox']"
PREDICTION = f"{PANE} [data-prediction-id]"
KEPT = f"{PANE} [data-look='kept']"
failed = []


def convex(*args):
    return subprocess.check_output(["npx", "convex", "run", *args], cwd=SCRATCH, text=True, env=ENV, stderr=subprocess.DEVNULL)


def expect(step, got, wanted):
    ok = got == wanted
    print(f"{'ok  ' if ok else 'FAIL'}  {step}" + ("" if ok else f": wanted {wanted!r}, got {got!r}"))
    if not ok:
        failed.append(step)


def signed_in(browser, width, height, theme, now=NOW):
    session = json.loads(convex("scratch:signIn"))
    context = browser.new_context(viewport={"width": width, "height": height}, color_scheme=theme, device_scale_factor=2)
    context.add_init_script(
        f"localStorage.setItem('__convexAuthJWT_{NAMESPACE}', {json.dumps(session['accessToken'])});"
        f"localStorage.setItem('__convexAuthRefreshToken_{NAMESPACE}', {json.dumps(session['refreshToken'])});"
    )
    context.clock.install(time=f"{TODAY}T{now}:00")
    page = context.new_page()
    page.goto(f"{BASE}/planner")
    page.wait_for_selector(PANE, state="attached")
    page.wait_for_timeout(1500)
    return context, page


def show_timebox(page, width):
    if width < 900:
        page.get_by_role("radio", name="Timebox").click()
        page.wait_for_timeout(400)


def shoot(page, name):
    page.locator(PANE).screenshot(path=str(OUT / name))


def centre(page, selector):
    page.locator(selector).first.evaluate("element => element.scrollIntoView({ block: 'center' })")
    page.wait_for_timeout(300)


OUT.mkdir(parents=True, exist_ok=True)
convex("scratch:seed", json.dumps({"today": TODAY, "timeZone": ZONE}))

with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    for theme in ["light", "dark"]:
        suffix = "" if theme == "light" else "-dark"
        for width, height in [(1440, 900), (390, 844)]:
            context, page = signed_in(browser, width, height, theme)
            show_timebox(page, width)
            if page.locator(PREDICTION).count() > 0:
                centre(page, PREDICTION)
            shoot(page, f"timeline-app-day-{width}{suffix}.png")
            page.get_by_role("radio", name=re.compile("^(Week|3 days)$")).click()
            page.wait_for_timeout(900)
            shoot(page, f"timeline-app-week-{width}{suffix}.png")
            context.close()

    context, page = signed_in(browser, 1440, 900, "light", "08:00")
    pane = page.locator(PANE)
    predicted = page.locator(PREDICTION).count()
    expect("today or tomorrow has predictions", predicted > 0, True)
    expect("the rail carries the Energy Curve", pane.locator("svg.pointer-events-none path").count() > 0, True)
    expect("a gap after now is named", pane.locator("[data-gap]").count() > 0, True)
    expect("the header counts the predictions", pane.get_by_text(re.compile(r"^\d+ predicted")).count(), 1)

    def first_id():
        centre(page, PREDICTION)
        return page.locator(PREDICTION).first.get_attribute("data-prediction-id")

    def kept(step, prediction):
        page.wait_for_timeout(900)
        expect(step, page.locator(f"[data-prediction-id='{prediction}']").count(), 0)
        page.keyboard.press("Meta+z")
        page.wait_for_timeout(1200)
        expect(f"{step}, and Cmd+Z takes it back", page.locator(f"[data-prediction-id='{prediction}']").count(), 1)

    kept_before = page.locator(KEPT).count()
    clicked = first_id()
    page.locator(PREDICTION).first.click()
    page.wait_for_timeout(600)
    expect("the kept block is filled", page.locator(KEPT).count(), kept_before + 1)
    kept("a click keeps a prediction", clicked)

    entered = first_id()
    page.locator(PREDICTION).first.focus()
    page.keyboard.press("Enter")
    kept("Enter keeps a prediction", entered)

    dragged = first_id()
    box = page.locator(PREDICTION).first.bounding_box()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + 6)
    page.mouse.down()
    for step in range(1, 9):
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + 6 + 56 * step / 8)
        page.wait_for_timeout(30)
    shoot(page, "timeline-app-drag.png")
    page.mouse.up()
    page.wait_for_timeout(300)
    expect("the toast says it was kept", page.get_by_text(re.compile("^Kept ")).count() > 0, True)
    kept("dropping a prediction keeps it", dragged)
    expect("every prediction is back", page.locator(PREDICTION).count(), predicted)

    page.locator("body").click(position={"x": 5, "y": 5})
    page.keyboard.press("Meta+Enter")
    page.wait_for_timeout(1200)
    expect("Cmd+Enter keeps all", page.locator(PREDICTION).count(), 0)
    shoot(page, "timeline-app-kept-all.png")
    page.keyboard.press("Meta+z")
    page.wait_for_timeout(1200)
    expect("one undo takes Keep all back", page.locator(PREDICTION).count(), predicted)
    context.close()
    browser.close()

print("\nall passed" if not failed else f"\n{len(failed)} failed")
sys.exit(1 if failed else 0)
