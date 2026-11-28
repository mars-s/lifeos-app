"""Check /design/timeline and screenshot the States, iPhone, Energy and Motion sections, each phone and both Planner windows in light and dark.

Set BASE to the running web app. Needs Playwright with Chromium.

    BASE=http://localhost:3990 uv run --with playwright python scripts/check-timeline-design.py <output folder>

ONLY=iphone,week limits the screenshots to those parts (states, iphone, energy, motion, desktop, week).
"""

import os
import sys
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get("BASE", "http://localhost:3990")
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
ONLY = [name for name in os.environ.get("ONLY", "").split(",") if name]
SECTIONS = ["states", "iphone", "energy", "motion"]
SIZES = {"desktop": (1440, 900, 2), "phone": (390, 844, 2)}
PHONES = {"yesterday": "iPhone day view, yesterday", "today": "iPhone day view, today", "tomorrow": "iPhone day view, tomorrow", "week": "iPhone week view"}
WINDOWS = {"desktop": "Mac Planner, day timeline", "week": "Mac Planner, week timeline"}
WINDOW_SHOTS = {"desktop": "timeline-desktop", "week": "timeline-week-desktop"}


def wanted(section):
    return not ONLY or section in ONLY


def open_board(browser, width, height, scale, theme):
    context = browser.new_context(viewport={"width": width, "height": height}, color_scheme=theme, device_scale_factor=scale)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    page.goto(f"{BASE}/design/timeline")
    page.wait_for_load_state("networkidle")
    expect(page.get_by_role("heading", name="States", exact=True)).to_be_visible()
    page.add_style_tag(content="header.sticky { position: static !important; }")
    return context, page, errors


def settle(page, target):
    target.scroll_into_view_if_needed()
    page.wait_for_timeout(500)


def shoot(page, size, theme):
    overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
    assert overflow <= 0, f"the page scrolls sideways by {overflow}px"
    dark = "" if theme == "light" else "-dark"
    if size == "phone":
        if wanted("iphone"):
            target = page.get_by_role("group", name=PHONES["today"])
            settle(page, target)
            target.screenshot(path=str(OUT / f"timeline-day-iphone-390{dark}.png"))
        return
    for section in SECTIONS:
        if not wanted(section):
            continue
        target = page.locator(f"#{section}")
        settle(page, target)
        target.screenshot(path=str(OUT / f"timeline-{section}{dark}.png"))
    if wanted("iphone"):
        for name, label in PHONES.items():
            target = page.get_by_role("group", name=label)
            settle(page, target)
            target.screenshot(path=str(OUT / f"timeline-{name if name == 'week' else 'day'}-iphone{'' if name == 'week' else '-' + name}{dark}.png"))
    for name, label in WINDOWS.items():
        if not wanted(name):
            continue
        target = page.locator(f"#{name}").get_by_role("group", name=label)
        settle(page, target)
        target.screenshot(path=str(OUT / f"{WINDOW_SHOTS[name]}{dark}.png"))


def interact(page):
    tomorrow = page.get_by_role("group", name=PHONES["tomorrow"])
    expect(tomorrow.get_by_text("4 predicted")).to_be_visible()
    tomorrow.get_by_role("button", name="Keep Bill Harry for Paperless, 1:15 – 1:35 pm, predicted").click()
    expect(tomorrow.get_by_text("3 predicted")).to_be_visible()
    expect(tomorrow.get_by_role("group", name="Bill Harry for Paperless, 1:15 – 1:35 pm")).to_have_attribute("data-look", "kept")
    tomorrow.get_by_role("button", name="Keep all").click()
    expect(tomorrow.get_by_text("Every block is kept")).to_be_visible()
    print("ok a tap keeps one prediction and Keep all keeps the rest")

    window = page.locator("#desktop").get_by_role("group", name=WINDOWS["desktop"])
    window.get_by_role("button", name="Complete Review the onboarding copy").click()
    today = page.get_by_role("group", name=PHONES["today"])
    expect(today.get_by_role("button", name="Reopen Review the onboarding copy")).to_be_visible()
    window.get_by_role("button", name="Reopen Review the onboarding copy").click()
    print("ok ticking a block in the Planner ticks it on the iPhone")

    window.get_by_role("radio", name="Week", exact=True).click()
    expect(page.locator("#desktop").get_by_role("group", name=WINDOWS["week"])).to_be_visible()
    page.locator("#desktop").get_by_role("radio", name="Day", exact=True).click()
    print("ok the Day and Week switch swaps the pane")

    motion = page.locator("#motion")
    block = motion.get_by_role("button", name="Keep Read two papers on retrieval, 2:30 – 3:30 pm, predicted")
    block.scroll_into_view_if_needed()
    box = block.bounding_box()
    page.mouse.move(box["x"] + 80, box["y"] + 20)
    page.mouse.down()
    page.mouse.move(box["x"] + 80, box["y"] + 52, steps=6)
    page.mouse.up()
    expect(motion.get_by_role("group", name="Read two papers on retrieval, 3:00 – 4:00 pm")).to_have_attribute("data-look", "kept")
    print("ok dragging a prediction moves it by 30 minutes and keeps it")

    slider = motion.get_by_role("slider")
    slider.focus()
    page.keyboard.press("End")
    expect(motion.get_by_role("group", name="Review the onboarding copy, 1:15 – 2:00 pm, not done")).to_have_attribute("data-look", "missed")
    expect(motion.get_by_role("button", name="Keep Email the reading group, 2:10 – 2:25 pm, predicted")).to_have_count(0)
    print("ok moving now past a block turns it graphite and drops a prediction it reached")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
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
