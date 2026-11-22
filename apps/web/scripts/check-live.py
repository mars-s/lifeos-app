"""Checks the deployed web app at 1440 and 390 px, light and dark.

The app shell loads with no console or page errors, the Convex websocket opens and the server answers on it, and a
click on Sign in with GitHub lands on github.com. Behind Cloudflare Access, pass the
value of a CF_Authorization cookie in CF_AUTHORIZATION.

    uv run --with playwright python scripts/check-live.py <output folder>

BASE changes the site (default https://lifeos.zephyrus.qzz.io).
"""

import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "https://lifeos.zephyrus.qzz.io")
OUT = sys.argv[1] if len(sys.argv) > 1 else "."
ACCESS_COOKIE = os.environ.get("CF_AUTHORIZATION")

failures = []


def check(width, theme, browser):
    context = browser.new_context(viewport={"width": width, "height": 900}, color_scheme=theme)
    if ACCESS_COOKIE:
        host = BASE.split("//", 1)[1].split("/", 1)[0]
        context.add_cookies([{"name": "CF_Authorization", "value": ACCESS_COOKIE, "domain": host, "path": "/"}])
    page = context.new_page()
    label = f"{width}px {theme}"
    errors = []
    frames = []
    page.on("console", lambda m: errors.append(f"console {m.type}: {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(f"page error: {e}"))
    page.on("requestfailed", lambda r: errors.append(f"request failed: {r.url} {r.failure}"))
    page.on("websocket", lambda ws: ws.on("framereceived", lambda f: frames.append(ws.url)))

    page.goto(f"{BASE}/today", wait_until="networkidle")
    button = page.get_by_role("button", name="Sign in with GitHub")
    button.wait_for(timeout=15000)
    page.wait_for_timeout(1500)
    page.screenshot(path=f"{OUT}/live-{width}-{theme}.png")
    overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
    if overflow > 0:
        errors.append(f"page scrolls sideways by {overflow}px")

    button.click()
    try:
        page.wait_for_url("https://github.com/**", timeout=15000)
    except Exception:
        errors.append(f"sign-in did not reach GitHub, stayed on {page.url}")
    if not any(".convex.cloud" in url for url in frames):
        errors.append("no frames from the Convex websocket")
    page.screenshot(path=f"{OUT}/live-{width}-{theme}-signin.png")

    for error in errors:
        failures.append(f"{label}: {error}")
    print(f"{label}: {'ok' if not errors else f'{len(errors)} problem(s)'}, landed on {page.url.split('?')[0]}")
    context.close()


with sync_playwright() as p:
    browser = p.chromium.launch()
    for width in (1440, 390):
        for theme in ("light", "dark"):
            check(width, theme, browser)
    browser.close()

for failure in failures:
    print(failure)
sys.exit(1 if failures else 0)
