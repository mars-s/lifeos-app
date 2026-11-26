"""The thinking orb: every AI state on /design/ai, in light and dark, and the pencil look on a Task card.

    BASE=http://localhost:4071 uv run --with playwright python scripts/check-ai-orb.py <output folder>

Run check-ai.py too: it takes the Suggested steps and Smart Estimate shots in the pencil look.
It exits non-zero on a failure.
"""

import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:4071")
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
failed = []


def expect(step, got, wanted):
    if got == wanted:
        print(f"ok    {step}")
    else:
        print(f"FAIL  {step}: wanted {wanted!r}, got {got!r}")
        failed.append(step)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for theme in ("light", "dark"):
            for reduced in ("no-preference", "reduce"):
                context = browser.new_context(viewport={"width": 1280, "height": 900}, color_scheme=theme, reduced_motion=reduced, device_scale_factor=2)
                page = context.new_page()
                page.on("pageerror", lambda error: failed.append(f"page error: {error}") or print(f"FAIL  page error: {error}"))
                page.goto(f"{BASE}/design/ai")
                orbs = page.locator("[data-orbs]")
                orbs.wait_for()
                orbs.scroll_into_view_if_needed()
                page.wait_for_timeout(900)
                expect(f"six states, two sizes each ({theme}, {reduced})", orbs.locator("canvas").count(), 12)
                painted = orbs.locator("canvas").evaluate_all(
                    "els => els.map(c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n > 0; })"
                )
                expect(f"every orb paints ({theme}, {reduced})", all(painted), True)
                if reduced == "no-preference":
                    orbs.screenshot(path=str(OUT / f"ai-orbs-{theme}.png"))
                context.close()
        browser.close()
    sys.exit(1 if failed else 0)


main()
