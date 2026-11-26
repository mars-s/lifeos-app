"""Check /design/ai and screenshot every section in light and dark, at desktop and iPhone width.

Set BASE to the running web app. Needs Playwright with Chromium.

    BASE=http://localhost:3990 uv run --with playwright python scripts/check-ai-design.py <output folder>

ONLY=notes,run limits the screenshots to those sections. SCALE=2 saves the desktop shots at double size.
RECORD=1 also records the Cmd+J moment to ai-cmd-j.mp4 in the output folder. That needs ffmpeg.
"""

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get("BASE", "http://localhost:3990")
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
ONLY = [name for name in os.environ.get("ONLY", "").split(",") if name]
SECTIONS = ["notes", "tasks", "agent", "run", "memory", "iphone"]
SIZES = {"desktop": (1440, 900, int(os.environ.get("SCALE", "1"))), "phone": (390, 844, 2)}
RUN_ASK = "Make room for the thesis outline"


def open_board(browser, width, height, scale, theme, **extra):
    context = browser.new_context(viewport={"width": width, "height": height}, color_scheme=theme, device_scale_factor=scale, **extra)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    page.goto(f"{BASE}/design/ai")
    page.wait_for_load_state("networkidle")
    expect(page.get_by_role("heading", name="In Notes", exact=True)).to_be_visible()
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
        target.screenshot(path=str(OUT / f"ai-{section}{suffix}.png"))


def shoot_moments(page, suffix):
    if wanted("notes"):
        note = specimen(page, "On the line you are on")
        settle(page, note)
        note.get_by_role("button", name="Ask").click()
        expect(note.get_by_role("dialog", name="LifeOS AI")).to_be_visible()
        page.wait_for_timeout(350)
        note.screenshot(path=str(OUT / f"ai-notes-ask{suffix}.png"))
        note.get_by_role("option", name="Tidy").click()
        expect(note.get_by_role("button", name="Replace")).to_be_visible(timeout=10000)
        page.wait_for_timeout(350)
        note.screenshot(path=str(OUT / f"ai-notes-draft{suffix}.png"))
        page.keyboard.press("Escape")
        expect(note.get_by_role("dialog", name="LifeOS AI")).to_have_count(0)
    if wanted("tasks"):
        task = specimen(page, "On a Task")
        settle(page, task)
        task.get_by_role("button", name="Ask").click()
        task.get_by_role("option", name="Find a time").click()
        expect(task.get_by_role("button", name="Plan it")).to_be_visible(timeout=10000)
        page.wait_for_timeout(350)
        task.screenshot(path=str(OUT / f"ai-tasks-time{suffix}.png"))
        page.keyboard.press("Escape")
    if wanted("run"):
        run = specimen(page, "A run, start to finish")
        settle(page, run)
        run.get_by_role("button", name=RUN_ASK).click()
        expect(run.get_by_text("Needs you: pick one").first).to_be_visible(timeout=15000)
        page.wait_for_timeout(500)
        run.screenshot(path=str(OUT / f"ai-run-decision{suffix}.png"))
        run.get_by_role("button", name="Move the reading to Friday").click()
        expect(run.get_by_text("Done. 3 changes").first).to_be_visible(timeout=15000)
        page.wait_for_timeout(500)
        run.screenshot(path=str(OUT / f"ai-run-done{suffix}.png"))


def undo_toast(page):
    page.locator("[data-toaster]").get_by_role("button", name="Undo").first.click()


def interact(page):
    page.add_style_tag(content="[data-toaster] { visibility: visible !important; }")
    note = specimen(page, "On the line you are on")
    settle(page, note)
    note.get_by_text("she wants the small index run").click()
    page.keyboard.press("Meta+j")
    box = note.get_by_role("dialog", name="LifeOS AI")
    expect(box.get_by_role("combobox", name="Ask LifeOS AI")).to_be_focused()
    page.keyboard.press("Enter")
    expect(box.get_by_role("button", name="Add 3 Tasks")).to_be_visible(timeout=10000)
    expect(note.locator("[data-ink=pencil]").first).to_be_visible()
    page.keyboard.press("Enter")
    expect(page.get_by_text("3 Tasks added to Honours thesis").first).to_be_visible()
    expect(note.get_by_role("checkbox", name="Complete Email Dr Nguyen the new table")).to_be_visible()
    undo_toast(page)
    expect(note.get_by_role("checkbox", name="Complete Email Dr Nguyen the new table")).to_have_count(0)
    print("ok notes: Cmd+J, Enter to pick, Enter to keep, undo")

    page.keyboard.press("Meta+j")
    box.get_by_role("combobox", name="Ask LifeOS AI").fill("tidy")
    page.keyboard.press("Enter")
    expect(box).to_be_focused()
    expect(box).to_have_attribute("data-ask-phase", "writing")
    page.keyboard.press("Escape")
    expect(box.get_by_role("button", name="Replace")).to_be_visible()
    page.keyboard.press("Escape")
    expect(box).to_have_count(0)
    expect(note.locator("[data-ink=pencil]")).to_have_count(0)
    print("ok notes: type to filter, Esc stops the writing, Esc discards the draft")

    task = specimen(page, "On a Task")
    settle(page, task)
    task.get_by_role("button", name="Ask").click()
    task.get_by_role("option", name="Find a time").click()
    task.get_by_role("button", name="11:00 am").click()
    task.get_by_role("button", name="Plan it").click()
    expect(page.get_by_text("Planned for Thu 11:00 am").first).to_be_visible()
    undo_toast(page)
    print("ok tasks: find a time, pick another, plan it, undo")

    decision = specimen(page, "A decision")
    settle(page, decision)
    decision.get_by_role("button", name="Split the outline").click()
    expect(decision.get_by_text("You picked")).to_be_visible()
    gate = specimen(page, "Asking first")
    gate.get_by_role("checkbox", name="Trash Book ferry").click()
    gate.get_by_role("button", name="Trash 3").click()
    expect(gate.get_by_text("3 changes made")).to_be_visible()
    gate.get_by_role("button", name="Undo all").click()
    expect(gate.get_by_text("All undone")).to_be_visible()
    print("ok agent: a decision, a question before the Trash, a receipt, undo all")

    run = specimen(page, "A run, start to finish")
    settle(page, run)
    run.get_by_role("button", name=RUN_ASK).click()
    expect(run.get_by_text("Needs you: pick one").first).to_be_visible(timeout=15000)
    run.get_by_role("button", name="Hide. The run keeps going").click()
    run.get_by_role("button", name="Open", exact=True).click()
    run.get_by_role("button", name="Move the reading to Friday").click()
    expect(run.get_by_text("Done. 3 changes").first).to_be_visible(timeout=15000)
    run.get_by_role("button", name="Undo remembering this").click()
    expect(run.get_by_text("Not remembered")).to_be_visible()
    run.get_by_role("button", name="Undo all").first.click()
    expect(run.get_by_text("Done. Everything undone").first).to_be_visible()
    print("ok run: start, hide, open, decide, receipt, forget the new memory, undo all")

    memory = specimen(page, "What it remembers")
    settle(page, memory)
    memory.get_by_role("button", name="Forget: Nothing new gets planned after 6:00 pm.").click()
    expect(memory.get_by_text("8", exact=True)).to_be_visible()
    undo_toast(page)
    expect(memory.get_by_text("9", exact=True)).to_be_visible()
    memory.get_by_role("searchbox", name="Search memory").fill("zzz")
    expect(memory.get_by_text("Nothing in memory matches")).to_be_visible()
    memory.get_by_role("searchbox", name="Search memory").fill("")
    memory.get_by_role("switch", name="Memory").click()
    expect(memory.get_by_text("Off. Nothing new is remembered")).to_be_visible()
    memory.get_by_role("switch", name="Memory").click()
    print("ok memory: forget and undo, search, the switch")


def record(browser):
    ffmpeg = shutil.which("ffmpeg")
    assert ffmpeg, "RECORD=1 needs ffmpeg on the PATH"
    with tempfile.TemporaryDirectory() as folder:
        context, page, errors = open_board(browser, 1180, 820, 2, "light", record_video_dir=folder, record_video_size={"width": 1180, "height": 820})
        note = specimen(page, "On the line you are on")
        note.scroll_into_view_if_needed()
        page.evaluate("window.scrollBy(0, -24)")
        page.wait_for_timeout(900)
        note.get_by_text("she wants the small index run").click()
        page.wait_for_timeout(700)
        page.keyboard.press("Meta+j")
        page.wait_for_timeout(1100)
        for _ in range(3):
            page.keyboard.press("ArrowDown")
            page.wait_for_timeout(260)
        page.keyboard.press("Enter")
        expect(note.get_by_role("button", name="Replace")).to_be_visible(timeout=10000)
        page.wait_for_timeout(1300)
        page.keyboard.press("Enter")
        page.wait_for_timeout(1500)
        page.keyboard.press("Meta+j")
        page.wait_for_timeout(800)
        page.keyboard.press("Enter")
        expect(note.get_by_role("button", name="Add 3 Tasks")).to_be_visible(timeout=10000)
        page.wait_for_timeout(1000)
        page.keyboard.press("Enter")
        page.wait_for_timeout(1600)
        video = page.video.path()
        context.close()
        assert not errors, "\n".join(errors)
        subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", str(video), "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-crf", "26", "-movflags", "+faststart", str(OUT / "ai-cmd-j.mp4")], check=True)
    print("ok recorded ai-cmd-j.mp4")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        for size, (width, height, scale) in SIZES.items():
            for theme in ("light", "dark"):
                context, page, errors = open_board(browser, width, height, scale, theme)
                suffix = f"{'' if size == 'desktop' else '-phone'}{'' if theme == 'light' else '-dark'}"
                shoot_sections(page, suffix)
                if size == "desktop":
                    shoot_moments(page, suffix)
                assert not errors, "\n".join(errors)
                context.close()
                print(f"ok {size} {theme}")
        if not ONLY:
            context, page, errors = open_board(browser, 1440, 900, 1, "light")
            interact(page)
            assert not errors, "\n".join(errors)
            context.close()
        if os.environ.get("RECORD"):
            record(browser)


if __name__ == "__main__":
    main()
