"""The day meter's hover breakdown sits above every Task row below it.

Needs the throwaway backend from local-backend.sh and the web app running:

    SCRATCH=/tmp/lifeos-local-backend sh scripts/local-backend.sh
    (cd $SCRATCH && CONVEX_AGENT_MODE=anonymous npx convex dev --typecheck disable) &
    WAKU_PUBLIC_CONVEX_URL=http://127.0.0.1:3210 npx waku dev --port 3101 &
    SCRATCH=/tmp/lifeos-local-backend uv run --with playwright python scripts/check-day-breakdown-layer.py <output folder>

For each width (1440, 390), theme (light, dark) and engine (chromium, webkit) it hovers today's meter, then
holds the mouse down on it, since a press scales the meter button. Each time it lets the card take hits for
a moment and asks the browser what is on top at every checkbox and chip under the card: hit testing follows
paint order, so a row control showing through the card fails. BASE, CONVEX_URL and ENGINES change the run.
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

BASE = os.environ.get("BASE", "http://localhost:3101")
CONVEX_URL = os.environ.get("CONVEX_URL", "http://127.0.0.1:3210")
SCRATCH = os.environ.get("SCRATCH", "/tmp/lifeos-local-backend")
ENGINES = os.environ.get("ENGINES", "chromium,webkit").split(",")
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
NAMESPACE = re.sub(r"[^a-zA-Z0-9]", "", CONVEX_URL)
TODAY = date.today().isoformat()
failed = []

COVERED = """() => {
  const card = document.querySelector('[data-day-breakdown][data-shown]');
  if (!card || getComputedStyle(card).opacity !== '1') return { shown: false, under: 0, through: [] };
  const box = card.getBoundingClientRect();
  card.style.pointerEvents = 'auto';
  const controls = [...document.querySelectorAll('[data-task-key] button, [data-task-key] [role=checkbox]')].filter((control) => {
    const r = control.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    return r.width > 0 && x > box.left && x < box.right && y > box.top && y < box.bottom;
  });
  const through = controls.filter((control) => {
    const r = control.getBoundingClientRect();
    return !card.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  }).map((control) => control.getAttribute('aria-label') || control.textContent.trim());
  card.style.pointerEvents = '';
  return { shown: true, under: controls.length, through };
}"""


def expect(step, got, wanted):
    if got == wanted:
        print(f"ok    {step}")
    else:
        print(f"FAIL  {step}: wanted {wanted!r}, got {got!r}")
        failed.append(step)


def sign_in():
    return json.loads(subprocess.check_output(["npx", "convex", "run", "scratch:signIn"], cwd=SCRATCH, text=True))


def run(playwright, engine, width, theme):
    name = f"{engine}-{width}-{theme}"
    browser = getattr(playwright, engine).launch(headless=True)
    context = browser.new_context(viewport={"width": width, "height": 844 if width < 600 else 900}, color_scheme=theme, device_scale_factor=2)
    page = context.new_page()
    page.on("pageerror", lambda error: failed.append(f"page error: {error}") or print(f"FAIL  page error: {error}"))
    page.goto(f"{BASE}/design")
    page.evaluate(
        "([namespace, s]) => { localStorage.setItem(`__convexAuthJWT_${namespace}`, s.accessToken);"
        " localStorage.setItem(`__convexAuthRefreshToken_${namespace}`, s.refreshToken); }",
        [NAMESPACE, sign_in()],
    )
    page.goto(f"{BASE}/planner")
    column = page.locator(f"[data-plan-day='{TODAY}']")
    column.locator("[data-task-key]").first.wait_for()
    page.wait_for_timeout(900)
    trigger = column.locator("button[aria-haspopup=dialog]").first
    trigger.hover()
    page.wait_for_timeout(700)

    def shot(label):
        box = page.evaluate(
            "() => { const r = document.querySelector('[data-day-breakdown][data-shown]').getBoundingClientRect();"
            " return { x: Math.max(0, r.left - 40), y: Math.max(0, r.top - 130), width: r.width + 80, height: r.height + 170 }; }"
        )
        page.screenshot(path=str(OUT / f"{name}-{label}.png"), clip=box)

    hovered = page.evaluate(COVERED)
    expect(f"{name}: the breakdown shows on hover", hovered["shown"], True)
    expect(f"{name}: the breakdown covers some Task row controls", hovered["under"] > 0, True)
    expect(f"{name}: no row control shows through on hover", hovered["through"], [])
    shot("hover")

    page.mouse.down()
    page.wait_for_timeout(300)
    pressed = page.evaluate(COVERED)
    expect(f"{name}: no row control shows through while the meter is pressed", pressed["through"], [])
    shot("pressed")
    page.mouse.up()
    page.wait_for_timeout(400)
    expect(f"{name}: a click opens the goal popover", page.locator("[role=dialog]").count(), 1)
    expect(f"{name}: the breakdown hides while the popover is open", page.locator("[data-day-breakdown][data-shown]").count(), 0)
    page.keyboard.press("Escape")
    browser.close()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        for engine in ENGINES:
            for width in (1440, 390):
                for theme in ("light", "dark"):
                    run(playwright, engine, width, theme)
    sys.exit(1 if failed else 0)


main()
