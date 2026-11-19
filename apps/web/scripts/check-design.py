"""Check /design hydration in WebKit against a local Waku build.

Set BASE to the running web app. Requires Playwright with WebKit installed.

    BASE=http://localhost:3990 python scripts/check-design.py <output folder>
"""

import os
import sys
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get("BASE", "http://localhost:3990")
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.webkit.launch()
        for width, height in ((1440, 900), (390, 844)):
            for theme, other in (("light", "Dark"), ("dark", "Light")):
                page = browser.new_page(viewport={"width": width, "height": height}, color_scheme=theme)
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(f"{BASE}/design")
                page.wait_for_load_state("networkidle")
                timeline = page.get_by_role("heading", name="Activity timeline", exact=True)
                expect(timeline).to_be_visible()
                page.get_by_role("radio", name=other, exact=True).click()
                expect(page.locator("html")).to_have_class(other.lower())
                page.get_by_role("radio", name=theme.title(), exact=True).click()
                expect(page.locator("html")).to_have_class(theme)
                timeline.scroll_into_view_if_needed()
                page.screenshot(path=str(OUT / f"design-{width}-{theme}.png"))
                assert not errors, "\n".join(errors)
                page.close()
                print(f"Passed in WebKit at {width}px in {theme} mode")


if __name__ == "__main__":
    main()
