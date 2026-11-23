"""Every action moves, and nothing jumps: the web motion pass (#81).

Each check watches the page frame by frame while it acts, then asserts how things moved:
a right-click menu fades in and out, the Task card opens and closes without the rows below
jumping the wrong way, the last Task folds away into the empty state, This Evening folds when its
last Task leaves, a trashed Area folds out of the sidebar, and the date picker slides between months.
With reduced motion the same actions cross-fade or change at once, and nothing slides.
It saves a screenshot in the middle of each one.

Needs the throwaway backend from local-backend.sh and the web app running:

    SCRATCH=/tmp/lifeos-local-backend sh scripts/local-backend.sh
    (cd $SCRATCH && CONVEX_AGENT_MODE=anonymous npx convex dev --typecheck disable) &
    WAKU_PUBLIC_CONVEX_URL=http://127.0.0.1:3210 npx waku dev --port 4061 &
    SCRATCH=/tmp/lifeos-local-backend uv run --with playwright python scripts/check-motion.py <output folder>

It reseeds the backend first. BASE, CONVEX_URL, WIDTH (1440 or 390), THEME (light or dark),
MOTION (no-preference or reduce) and ENGINE (chromium or webkit) change the run.
It exits non-zero on a failure.
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
MOTION = os.environ.get("MOTION", "no-preference")
WIDTH = int(os.environ.get("WIDTH", "1440"))
ENGINE = os.environ.get("ENGINE", "chromium")
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
NAMESPACE = re.sub(r"[^a-zA-Z0-9]", "", CONVEX_URL)
ZONE = subprocess.check_output(["node", "-e", "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)"], text=True).strip()
ENV = {**os.environ, "CONVEX_AGENT_MODE": "anonymous"}
SUFFIX = f"-{ENGINE}-{WIDTH}-{THEME}" + ("-reduced" if MOTION == "reduce" else "")
REDUCED = MOTION == "reduce"
failed = []

FILM = """([selectors, ms]) => {
  window.__film = [];
  const opacityOf = (element) => {
    let value = 1;
    for (let node = element; node && node !== document.documentElement; node = node.parentElement) value *= Number(getComputedStyle(node).opacity);
    return value;
  };
  const started = performance.now();
  const frame = () => {
    const at = performance.now() - started;
    window.__film.push(selectors.map((selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { top: box.top, height: box.height, opacity: opacityOf(element), transform: getComputedStyle(element).transform };
    }));
    if (at < ms) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}"""


def convex(*args):
    return subprocess.check_output(["npx", "convex", *args], cwd=SCRATCH, text=True, env=ENV, stderr=subprocess.DEVNULL)


def expect(step, got, wanted):
    if got == wanted:
        print(f"ok    {step}")
    else:
        print(f"FAIL  {step}: wanted {wanted!r}, got {got!r}")
        failed.append(step)


def shot(page, name):
    page.screenshot(path=str(OUT / f"motion-{name}{SUFFIX}.png"))


def film(page, selectors, ms=900):
    page.evaluate(FILM, [selectors, ms])


def frames(page, ms=900):
    page.wait_for_timeout(ms + 150)
    return page.evaluate("window.__film")


def track(frames_, index):
    return [frame[index] for frame in frames_ if frame[index] is not None]


def between(values, low, high):
    return [value for value in values if low < value < high]


def go(page, path):
    page.goto(f"{BASE}{path}")
    page.locator("#main [data-task-key], #main [role=status], #main h1").first.wait_for()
    page.wait_for_timeout(700)


def row(page, title):
    return page.locator("#main [data-task-key]").filter(has=page.get_by_text(title, exact=True)).first


def sidebar(page):
    if WIDTH < 768:
        page.get_by_role("button", name="Open the sidebar").click()
        page.wait_for_timeout(500)
    return page.locator("aside")


def check_menu(page):
    go(page, "/today")
    film(page, ["[role=menu]"], 500)
    row(page, "Book a physio appointment").click(button="right")
    page.wait_for_timeout(60)
    shot(page, "menu-opening")
    shown = track(frames(page, 500), 0)
    fading_in = between([frame["opacity"] for frame in shown], 0.05, 0.95)
    if REDUCED:
        expect("with reduced motion a right-click menu appears at once", fading_in, [])
    else:
        expect("a right-click menu fades in", len(fading_in) > 0, True)
    film(page, ["[role=menu]"], 500)
    page.get_by_role("menuitem", name=re.compile("^Open")).first.click()
    leaving = between([frame["opacity"] for frame in track(frames(page, 500), 0)], 0.05, 0.95)
    if REDUCED:
        expect("with reduced motion a picked menu closes at once", leaving, [])
    else:
        expect("a menu fades out once an item is picked", len(leaving) > 0, True)
    page.keyboard.press("Escape")
    page.keyboard.press("Escape")
    page.wait_for_timeout(600)


def check_card(page):
    go(page, "/today")
    below = "#main [data-task-key]:nth-of-type(2)"
    film(page, [below], 900)
    row(page, "Draft the thesis outline").locator("[data-arrow-item]").dblclick()
    page.wait_for_timeout(120)
    shot(page, "card-opening")
    tops = [frame["top"] for frame in track(frames(page, 900), 0)]
    steps = [round(after - before) for before, after in zip(tops, tops[1:])]
    expect("opening the card never pulls the rows below upwards", [step for step in steps if step < -1], [])
    if REDUCED:
        expect("with reduced motion the card opens at once", len([step for step in steps if step > 1]), 1)
    else:
        expect("the rows below glide down as the card opens", len([step for step in steps if step > 1]) > 3, True)
    film(page, [below], 900)
    page.mouse.click(WIDTH - 20, 880)
    page.wait_for_timeout(120)
    shot(page, "card-closing")
    tops = [frame["top"] for frame in track(frames(page, 900), 0)]
    steps = [round(after - before) for before, after in zip(tops, tops[1:])]
    expect("closing the card never pushes the rows below downwards", [step for step in steps if step > 1], [])
    if not REDUCED:
        expect("the rows below glide back up as the card closes", len([step for step in steps if step < -1]) > 3, True)
    page.wait_for_timeout(400)


def check_empty(page):
    go(page, "/inbox")
    boxes = page.locator("#main [data-task-key]").get_by_role("checkbox")
    while boxes.count() > 1:
        boxes.first.click()
        page.wait_for_timeout(1900)
    film(page, ["#main [data-task-key]", "#main div.text-center"], 2400)
    boxes.first.click()
    page.wait_for_timeout(1250)
    shot(page, "inbox-emptying")
    seen = frames(page, 1100)
    heights = [frame["height"] for frame in track(seen, 0)]
    empty = [frame["opacity"] for frame in track(seen, 1)]
    full = max(heights, default=0)
    if REDUCED:
        expect("with reduced motion the last Task does not fold", between(heights, 2, full - 2), [])
    expect("the empty state fades in rather than popping", len(between(empty, 0.05, 0.95)) > 0, True)
    expect("the Inbox ends on its empty state", page.get_by_text("The Inbox is empty").count(), 1)


def check_section(page):
    go(page, "/today")
    row(page, "Cook dinner for Sam").get_by_role("checkbox").click()
    page.wait_for_timeout(1900)
    film(page, ["#main div:has(> section)"], 2200)
    row(page, "Read two papers on retrieval").get_by_role("checkbox").click()
    page.wait_for_timeout(1250)
    shot(page, "evening-folding")
    seen = track(frames(page, 1000), 0)
    expect("This Evening fades away with its last Task", len(between([frame["opacity"] for frame in seen], 0.05, 0.95)) > 0, True)
    heights = [frame["height"] for frame in seen]
    full = max(heights, default=0)
    if REDUCED:
        expect("with reduced motion This Evening does not fold", between(heights, 2, full - 2), [])
    else:
        expect("This Evening folds as it leaves", len(between(heights, 2, full - 2)) > 0, True)


def check_sidebar(page):
    go(page, "/today")
    side = sidebar(page)
    side.get_by_text("Korvant", exact=True).click(button="right")
    page.wait_for_timeout(400)
    page.evaluate(
        "() => { window.__walk = []; const link = [...document.querySelectorAll('aside a')].find((a) => a.textContent.startsWith('Personal'));"
        " const started = performance.now(); const frame = () => { window.__walk.push(link.getBoundingClientRect().top);"
        " if (performance.now() - started < 900) requestAnimationFrame(frame); }; requestAnimationFrame(frame); }"
    )
    page.get_by_role("menuitem", name=re.compile("Move Area to Trash")).click()
    page.wait_for_timeout(150)
    shot(page, "area-folding")
    page.wait_for_timeout(900)
    walk = page.evaluate("window.__walk")
    steps = [round(after - before) for before, after in zip(walk, walk[1:])]
    if REDUCED:
        expect("with reduced motion the sidebar closes the gap at once", len([step for step in steps if step < -1]), 1)
    else:
        travel = walk[0] - walk[-1] if walk else 0
        expect("the Areas below glide up, with no jump", [step for step in steps if step < -travel / 2], [])
        expect("the Areas below glide up over several frames", len([step for step in steps if step < -1]) > 3, True)
    if WIDTH < 768:
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)


def check_month(page):
    go(page, "/today")
    row(page, "Book a physio appointment").locator("[data-arrow-item]").dblclick()
    page.wait_for_timeout(700)
    page.locator("[data-open-card]").get_by_role("button", name=re.compile("^When")).click()
    page.wait_for_timeout(400)
    film(page, ["[data-month-days]:not([inert])"], 500)
    page.get_by_role("button", name="Later month").click()
    page.wait_for_timeout(50)
    shot(page, "month-sliding")
    seen = track(frames(page, 500), 0)
    moving = [frame for frame in seen if frame["transform"] not in ("none", "matrix(1, 0, 0, 1, 0, 0)")]
    if REDUCED:
        expect("with reduced motion the month changes without sliding", moving, [])
    else:
        expect("the next month slides in", len(moving) > 0, True)
    expect("the month grid fades in", len(between([frame["opacity"] for frame in seen], 0.05, 0.95)) > 0, True)
    page.keyboard.press("Escape")
    page.keyboard.press("Escape")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    seed = json.dumps({"today": date.today().isoformat(), "timeZone": ZONE})
    with sync_playwright() as playwright:
        browser = getattr(playwright, ENGINE).launch(headless=True)
        for check in [check_menu, check_card, check_month, check_empty, check_section, check_sidebar]:
            convex("run", "scratch:seed", seed)
            session = json.loads(convex("run", "scratch:signIn"))
            context = browser.new_context(viewport={"width": WIDTH, "height": 900}, color_scheme=THEME, reduced_motion=MOTION, device_scale_factor=2)
            page = context.new_page()
            page.on("pageerror", lambda error: failed.append(f"page error: {error}") or print(f"FAIL  page error: {error}"))
            page.goto(f"{BASE}/design")
            page.evaluate(
                "([namespace, s]) => { localStorage.setItem(`__convexAuthJWT_${namespace}`, s.accessToken);"
                " localStorage.setItem(`__convexAuthRefreshToken_${namespace}`, s.refreshToken); }",
                [NAMESPACE, session],
            )
            check(page)
            context.close()
        browser.close()
    print(f"{len(failed)} failed" if failed else "all ok")
    sys.exit(1 if failed else 0)


main()
