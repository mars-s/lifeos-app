"""Check /design/canvas and screenshot every section in light and dark, at desktop and iPhone width.

Set BASE to the running web app. Needs Playwright with Chromium.

    BASE=http://localhost:3990 uv run --with playwright python scripts/check-canvas-design.py <output folder>

ONLY=notes,build limits the screenshots to those sections. SCALE=2 saves the desktop shots at double size.
"""

import os
import sys
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get("BASE", "http://localhost:3990")
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
ONLY = [name for name in os.environ.get("ONLY", "").split(",") if name]
SECTIONS = ["notes", "build", "run", "blocks"]
SIZES = {"desktop": (1440, 900, int(os.environ.get("SCALE", "1"))), "phone": (390, 844, 2)}


def open_board(browser, width, height, scale, theme):
    context = browser.new_context(viewport={"width": width, "height": height}, color_scheme=theme, device_scale_factor=scale)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    page.goto(f"{BASE}/design/canvas")
    page.wait_for_load_state("networkidle")
    expect(page.get_by_role("heading", name="A canvas of notes", exact=True)).to_be_visible()
    page.add_style_tag(content="header.sticky { position: static !important; } [data-toaster] { visibility: hidden !important; }")
    return context, page, errors


def specimen(page, name):
    return page.locator("article").filter(has=page.get_by_role("heading", name=name, exact=True))


def wanted(section):
    return not ONLY or section in ONLY


def settle(page, target):
    target.scroll_into_view_if_needed()
    page.wait_for_timeout(350)


def shoot_sections(page, suffix):
    overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
    assert overflow <= 0, f"the page scrolls sideways by {overflow}px"
    for section in SECTIONS:
        if not wanted(section):
            continue
        target = page.locator(f"#{section}")
        settle(page, target)
        if section == "blocks":
            expect(target.get_by_text("-ss 9.2")).to_be_visible()
        target.screenshot(path=str(OUT / f"canvas-{section}{suffix}.png"))


def shoot_build(page, suffix):
    build = specimen(page, "The launch film, as Steps")
    settle(page, build)
    build.get_by_role("button", name="Build it").click()
    expect(build.get_by_text("Adding Write the scenes")).to_be_visible(timeout=10000)
    page.wait_for_timeout(250)
    build.screenshot(path=str(OUT / f"canvas-build-live{suffix}.png"))
    expect(build.get_by_text("Nothing has run yet")).to_be_visible(timeout=10000)
    page.wait_for_timeout(400)
    build.screenshot(path=str(OUT / f"canvas-build-ask{suffix}.png"))
    build.get_by_role("button", name="Run 7").click()
    expect(build.get_by_text("Running on this Mac: Write the film")).to_be_visible()
    page.wait_for_timeout(400)
    build.screenshot(path=str(OUT / f"canvas-build-run{suffix}.png"))


def edge_path(scope, edge):
    return scope.locator(f"[data-edge='{edge}'] path").first.get_attribute("d")


def interact(page):
    page.add_style_tag(content="[data-toaster] { visibility: visible !important; }")
    notes = specimen(page, "Thesis map")
    settle(page, notes)
    before = edge_path(notes, "a")
    card = notes.locator("[data-card='retrieval']")
    box = card.bounding_box()
    page.mouse.move(box["x"] + 200, box["y"] + 120)
    page.mouse.down()
    page.mouse.move(box["x"] + 230, box["y"] + 170, steps=6)
    page.mouse.up()
    page.wait_for_timeout(300)
    moved = card.bounding_box()
    assert abs(moved["x"] - box["x"] - 30) < 2 and abs(moved["y"] - box["y"] - 50) < 2, "the card did not follow the pointer"
    assert edge_path(notes, "a") != before, "the link did not follow the card"
    notes.get_by_role("checkbox", name="Complete Rerun the hybrid on the small index").click()
    expect(notes.get_by_role("checkbox", name="Complete Rerun the hybrid on the small index")).to_be_checked()
    notes.get_by_role("button", name="Zoom in").click()
    expect(notes.get_by_role("button", name="Zoom 125%. Fit the canvas")).to_be_visible()
    notes.get_by_role("button", name="Zoom 125%. Fit the canvas").click()
    expect(notes.get_by_role("button", name="Zoom 100%. Fit the canvas")).to_be_visible()
    print("ok notes: drag a card and its link follows, tick a Task, zoom and fit")

    build = specimen(page, "The launch film, as Steps")
    settle(page, build)
    build.get_by_role("button", name="Build it").click()
    expect(build.get_by_text("Nothing has run yet")).to_be_visible(timeout=10000)
    expect(build.locator("section[data-ink=pencil]")).to_have_count(7)
    build.get_by_role("checkbox", name="Run Render the preview").click()
    expect(build.get_by_role("button", name="Run 6")).to_be_visible()
    build.get_by_role("button", name="Run 6").click()
    expect(build.locator("section[data-ink=pencil]")).to_have_count(0)
    expect(build.get_by_text("Left out")).to_be_visible()
    build.get_by_role("button", name="Stop").click()
    expect(build.get_by_text("Stopped. Every command was ended")).to_be_visible()
    build.get_by_role("button", name="Undo all").click()
    expect(build.get_by_role("button", name="Build it")).to_be_visible()
    expect(build.locator("section[data-ink]")).to_have_count(0)
    print("ok build: Steps arrive in pencil, it asks first, leave one out, run, stop, undo all")

    run = specimen(page, "Rendering the frames")
    settle(page, run)
    expect(run.locator("[data-state=running]")).to_have_count(1)
    run.get_by_role("button", name="Stop").click()
    expect(run.get_by_text("Stopped. Nothing is running")).to_be_visible()
    expect(run.locator("[data-state=running]")).to_have_count(0)
    run.get_by_role("button", name="Carry on").click()
    expect(run.locator("[data-state=running]")).to_have_count(1)
    print("ok run: stop and carry on")

    block = specimen(page, "Pick the poster")
    settle(page, block)
    expect(block.get_by_text("-ss 9.2")).to_be_visible()
    frame = block.frame_locator("iframe[title='Pick the poster frame']")
    frame.get_by_role("button", name="Use the frame at 22 seconds").click()
    expect(block.get_by_text("-ss 22.0")).to_be_visible()
    sealed = block.locator("iframe").evaluate("node => { try { return node.contentDocument === null; } catch { return true; } }")
    assert sealed, "the page can reach inside the custom block"
    print("ok blocks: a pick inside the sealed frame leaves by the socket, and the page cannot reach in")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        for size, (width, height, scale) in SIZES.items():
            for theme in ("light", "dark"):
                context, page, errors = open_board(browser, width, height, scale, theme)
                suffix = f"{'' if size == 'desktop' else '-phone'}{'' if theme == 'light' else '-dark'}"
                shoot_sections(page, suffix)
                if size == "desktop" and wanted("build"):
                    shoot_build(page, suffix)
                assert not errors, "\n".join(errors)
                context.close()
                print(f"ok {size} {theme}")
        if not ONLY:
            context, page, errors = open_board(browser, 1440, 900, 1, "light")
            interact(page)
            assert not errors, "\n".join(errors)
            context.close()


if __name__ == "__main__":
    main()
