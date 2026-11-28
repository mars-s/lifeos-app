"""Check /design/widgets and screenshot every section in light and dark, plus the tinted, clear and dimmed states.

Set BASE to the running web app. Needs Playwright with Chromium.

    BASE=http://localhost:3990 uv run --with playwright python scripts/check-widgets-design.py <output folder>

ONLY=iphone,mac limits the screenshots to those sections. SCALE=2 saves the desktop shots at double size.

The bento sheets for sharing (widgets-bento-light.png, -dark, widgets-bento-square-light.png, -dark) are saved at
their full size and 2x. ONLY=bento remakes just those:

    BASE=http://localhost:3990 ONLY=bento uv run --with playwright python scripts/check-widgets-design.py ../../docs/design
"""

import os
import sys
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get("BASE", "http://localhost:3990")
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
ONLY = [name for name in os.environ.get("ONLY", "").split(",") if name]
SECTIONS = ["anatomy", "iphone", "modes", "lock", "mac", "states"]
SIZES = {"desktop": (1440, 900, int(os.environ.get("SCALE", "1"))), "phone": (390, 844, 2)}
PHONE_SECTIONS = ["iphone", "lock"]
BENTO = {"wide": (1920, 1080, "widgets-bento"), "square": (1440, 1440, "widgets-bento-square")}
ALONE = """(sheet) => {
  document.body.replaceChildren(sheet);
  document.body.style.margin = 0;
  window.scrollTo(0, 0);
}"""


def wanted(section):
    return not ONLY or section in ONLY


def open_board(browser, width, height, scale, theme):
    context = browser.new_context(viewport={"width": width, "height": height}, color_scheme=theme, device_scale_factor=scale)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    page.goto(f"{BASE}/design/widgets")
    page.wait_for_load_state("networkidle")
    expect(page.get_by_role("heading", name="Anatomy", exact=True)).to_be_visible()
    page.add_style_tag(content="header.sticky { position: static !important; }")
    return context, page, errors


def settle(page, target):
    target.scroll_into_view_if_needed()
    page.wait_for_function("Array.from(document.images).every((image) => image.loading === 'lazy' ? true : image.complete)")
    page.evaluate("Promise.all(Array.from(document.images).map((image) => { image.loading = 'eager'; return image.decode().catch(() => null); }))")
    page.wait_for_timeout(400)


def shoot(page, size, theme):
    overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
    assert overflow <= 0, f"the page scrolls sideways by {overflow}px"
    suffix = f"{'' if size == 'desktop' else '-phone'}{'' if theme == 'light' else '-dark'}"
    for section in SECTIONS if size == "desktop" else PHONE_SECTIONS:
        if not wanted(section):
            continue
        target = page.locator(f"#{section}")
        settle(page, target)
        target.screenshot(path=str(OUT / f"widgets-{section}{suffix}.png"))
    if size != "desktop":
        return
    if wanted("iphone"):
        home = page.locator("#iphone")
        for mode in ("Tinted", "Clear"):
            home.get_by_role("radio", name=mode, exact=True).click()
            expect(home.get_by_role("group", name=f"iPhone Home Screen, {mode.lower()}")).to_be_visible()
            settle(page, home)
            home.get_by_role("group", name=f"iPhone Home Screen, {mode.lower()}").screenshot(path=str(OUT / f"widgets-home-{mode.lower()}.png")) if theme == "dark" else None
        home.get_by_role("radio", name="Colour", exact=True).click()
        settle(page, home)
        home.get_by_role("group", name=f"iPhone Home Screen, {theme}").screenshot(path=str(OUT / f"widgets-home{suffix}.png"))
    if wanted("lock") and theme == "dark":
        lock = page.locator("#lock").get_by_role("group", name="iPhone Lock Screen")
        settle(page, lock)
        lock.screenshot(path=str(OUT / "widgets-lock-screen.png"))
    if wanted("mac"):
        mac = page.locator("#mac")
        settle(page, mac)
        mac.get_by_role("group", name="Mac desktop with widgets").screenshot(path=str(OUT / f"widgets-desktop{suffix}.png"))
        mac.get_by_role("radio", name="App in front", exact=True).click()
        dimmed = mac.get_by_role("group", name="Mac desktop with LifeOS in front, widgets dimmed")
        expect(dimmed).to_be_visible()
        page.wait_for_timeout(400)
        dimmed.screenshot(path=str(OUT / f"widgets-desktop-front{suffix}.png"))
        mac.get_by_role("radio", name="Desktop", exact=True).click()


def bento(browser, theme):
    for shape, (width, height, name) in BENTO.items():
        context, page, errors = open_board(browser, width, height, 2, theme)
        sheet = page.locator(f"[data-bento={shape}]")
        settle(page, sheet)
        sheet.evaluate(ALONE)
        box = sheet.bounding_box()
        assert (box["x"], box["y"], box["width"], box["height"]) == (0, 0, width, height), f"the {shape} bento sits at {box}"
        clipped = sheet.evaluate("(sheet) => Array.from(sheet.querySelectorAll('[role=group]')).filter((tile) => tile.scrollWidth > tile.clientWidth + 1 || tile.scrollHeight > tile.clientHeight + 1).map((tile) => tile.getAttribute('aria-label'))")
        assert not clipped, f"clipped in the {shape} bento: {clipped}"
        page.screenshot(path=str(OUT / f"{name}-{theme}.png"))
        assert not errors, "\n".join(errors)
        context.close()
        print(f"ok bento {shape} {theme}")


def interact(page):
    home = page.locator("#iphone").get_by_role("group", name="iPhone Home Screen, light")
    today = home.get_by_role("group", name="Today: 6 Tasks left")
    today.get_by_role("button", name="Complete Methods draft").click()
    expect(home.get_by_role("group", name="Today: 5 Tasks left")).to_be_visible()
    expect(page.locator("#mac").get_by_role("button", name="Reopen Methods draft").first).to_be_visible()
    home.get_by_role("button", name="Reopen Methods draft").click()
    expect(home.get_by_role("group", name="Today: 6 Tasks left")).to_be_visible()
    print("ok ticking a Task in one widget updates every widget")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        if wanted("bento"):
            for theme in ("light", "dark"):
                bento(browser, theme)
        if ONLY == ["bento"]:
            return
        for size, (width, height, scale) in SIZES.items():
            for theme in ("light", "dark"):
                context, page, errors = open_board(browser, width, height, scale, theme)
                shoot(page, size, theme)
                if size == "desktop" and theme == "light" and not ONLY:
                    interact(page)
                assert not errors, "\n".join(errors)
                context.close()
                print(f"ok {size} {theme}")


if __name__ == "__main__":
    main()
