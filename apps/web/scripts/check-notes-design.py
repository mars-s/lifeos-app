"""Check /design/notes and screenshot every section in light and dark, at desktop and iPhone width.

Set BASE to the running web app. Needs Playwright with Chromium.

    BASE=http://localhost:3990 uv run --with playwright python scripts/check-notes-design.py <output folder>

ONLY=home,iphone limits the screenshots to those sections. SCALE=2 saves the desktop shots at double size.
"""

import os
import sys
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get("BASE", "http://localhost:3990")
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
ONLY = [name for name in os.environ.get("ONLY", "").split(",") if name]
SECTIONS = ["home", "writing", "links", "daily", "shell", "states", "iphone"]
SIZES = {"desktop": (1440, 900, int(os.environ.get("SCALE", "1"))), "phone": (390, 844, 2)}


def open_board(browser, width, height, scale, theme):
    context = browser.new_context(viewport={"width": width, "height": height}, color_scheme=theme, device_scale_factor=scale)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    page.goto(f"{BASE}/design/notes")
    page.wait_for_load_state("networkidle")
    expect(page.get_by_role("heading", name="Home and editor", exact=True)).to_be_visible()
    page.add_style_tag(content="header.sticky { position: static !important; }")
    return context, page, errors


def shoot(page, size, theme):
    overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
    assert overflow <= 0, f"the page scrolls sideways by {overflow}px"
    suffix = f"{'' if size == 'desktop' else '-phone'}{'' if theme == 'light' else '-dark'}"
    for section in SECTIONS:
        if ONLY and section not in ONLY:
            continue
        target = page.locator(f"#{section}")
        target.scroll_into_view_if_needed()
        page.wait_for_timeout(350)
        target.screenshot(path=str(OUT / f"notes-{section}{suffix}.png"))
    if size == "phone" and (not ONLY or "home" in ONLY):
        window = page.locator("#home")
        window.scroll_into_view_if_needed()
        window.get_by_role("button", name="Retrieval experiments", exact=True).first.click()
        expect(window.get_by_role("article", name="Retrieval experiments")).to_be_visible()
        page.wait_for_timeout(350)
        window.screenshot(path=str(OUT / f"notes-editor{suffix}.png"))
        window.get_by_role("button", name="Notes", exact=True).click()
        expect(window.get_by_role("searchbox", name="Search notes")).to_be_visible()


def interact(page):
    window = page.locator("#home")
    window.get_by_role("button", name="Thesis outline", exact=True).first.click()
    expect(window.get_by_role("article", name="Thesis outline")).to_be_visible()
    window.get_by_role("searchbox", name="Search notes").fill("japan")
    expect(window.get_by_text("2 notes")).to_be_visible()
    window.get_by_role("searchbox", name="Search notes").fill("zzz")
    expect(window.get_by_text("No notes match")).to_be_visible()
    window.get_by_role("searchbox", name="Search notes").fill("")
    window.get_by_role("button", name="Retrieval experiments", exact=True).first.click()
    line = window.get_by_role("article").get_by_role("listitem").filter(has_text="Rerun the hybrid on the small index")
    line.hover()
    line.get_by_role("button", name="Make Task").click()
    expect(page.get_by_text("Task added to Honours thesis").first).to_be_visible()
    expect(line.get_by_text("Honours thesis")).to_be_visible()
    page.get_by_role("button", name="Undo").first.click()
    expect(line.get_by_role("button", name="Make Task")).to_be_attached()
    print("ok the window: open a note, search, make a Task and undo it")

    link = page.get_by_role("combobox", name="Link to a note, Task or Project")
    link.fill("eval")
    link.press("Enter")
    expect(page.locator("#writing").get_by_role("button", name="Evaluation plan")).to_be_visible()
    print("ok linking as you type")

    capture = page.locator("#daily")
    capture.get_by_role("textbox", name="Line 3").fill("t Call the physio")
    expect(capture.get_by_role("textbox", name="Line 3, a Task")).to_have_value("Call the physio")
    capture.get_by_role("textbox", name="Line 3, a Task").press("Enter")
    expect(capture.get_by_role("textbox", name="Line 4")).to_be_focused()
    capture.get_by_role("button", name="Add page").click()
    expect(page.get_by_text("3 lines added to Thu 19 Nov").first).to_be_visible()
    expect(capture.get_by_role("textbox", name="Notebook page")).to_have_value("44")
    print("ok typing in a notebook page")

    states = page.locator("#states")
    states.get_by_role("button", name="Edit from iPhone").click()
    expect(states.get_by_text("Merging 2 edits from iPhone")).to_be_visible()
    expect(states.get_by_text("1,500")).to_be_visible()
    expect(states.get_by_text("Synced across 3 devices").first).to_be_visible()
    print("ok the merge moment")

    planner = page.locator("#shell")
    planner.get_by_role("button", name="Close note").click()
    expect(planner.get_by_role("complementary", name="Retrieval experiments, beside the Planner")).to_have_attribute("inert", "")
    planner.get_by_role("button", name="Retrieval experiments", exact=True).click()
    expect(planner.get_by_role("button", name="Close note")).to_be_visible()
    print("ok a note beside the Planner")


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
