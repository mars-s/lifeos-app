"""Verify issue #57 on a seeded anonymous Convex backend and a local web app.

Set SCRATCH to the directory created by local-backend.sh. BASE and CONVEX_URL
must match the local web server and its Convex deployment. Run with Playwright:

    SCRATCH=/tmp/lifeos-local-backend python scripts/check-recurrence-tidyups.py /tmp/screens

BROWSER_EXECUTABLE can select a local Chromium-based browser.
"""

import json
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from playwright.sync_api import expect, sync_playwright

expect.set_options(timeout=15_000)

BASE = os.environ.get("BASE", "http://localhost:3990")
CONVEX_URL = os.environ.get("CONVEX_URL", "http://127.0.0.1:3210")
SCRATCH = Path(os.environ["SCRATCH"])
OUT = Path(sys.argv[1])
PARCEL = "Pick up the parcel from the post office"
GARY = "Send Gary the weekly sync notes"
TEMPLATES = ["Weekly review", "Invoice a client"]
TIME_ZONE = "Australia/Melbourne"


def convex(function, args=None):
    return subprocess.check_output(
        ["npx", "convex", "run", function, json.dumps(args or {}), "--url", CONVEX_URL],
        cwd=SCRATCH,
        env={**os.environ, "CONVEX_AGENT_MODE": "anonymous"},
        text=True,
    )


def undo(page):
    page.keyboard.press("ControlOrMeta+z")


def check_templates(page, shot):
    page.goto(f"{BASE}/settings/features/templates", wait_until="domcontentloaded")
    rows = page.locator("[data-template-id] [data-arrow-item] > span:first-child")
    expect(rows).to_have_text(TEMPLATES)
    invoice = page.get_by_role("button", name="Actions for Invoice a client")
    invoice.press("Enter")
    up = page.get_by_role("menuitem", name="Move Up")
    expect(up).to_be_focused()
    expect(page.get_by_role("menuitem", name="Move Down")).to_be_disabled()
    shot("template-menu")
    page.keyboard.press("Enter")
    expect(rows).to_have_text(TEMPLATES[::-1])
    expect(invoice).to_be_focused()
    invoice.press("Enter")
    down = page.get_by_role("menuitem", name="Move Down")
    expect(down).to_be_focused()
    page.keyboard.press("Enter")
    expect(rows).to_have_text(TEMPLATES)
    undo(page)
    expect(rows).to_have_text(TEMPLATES[::-1])

    handle = page.get_by_role("button", name="Drag Weekly review")
    handle.scroll_into_view_if_needed()
    start = handle.bounding_box()
    end = page.get_by_role("button", name="Drag Invoice a client").bounding_box()
    x, y = start["x"] + start["width"] / 2, start["y"] + start["height"] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x, end["y"] + end["height"] / 2, steps=12)
    page.mouse.up()
    expect(rows).to_have_text(TEMPLATES)
    undo(page)
    expect(rows).to_have_text(TEMPLATES[::-1])
    page.reload()
    expect(rows).to_have_text(TEMPLATES[::-1])


def check_command_bar(page, shot):
    page.goto(f"{BASE}/today", wait_until="domcontentloaded")
    task = page.locator("[data-task-key]").filter(has_text=PARCEL)
    search = page.locator("[cmdk-input]")
    editor = page.get_by_role("dialog", name="Repeat")

    def repeat():
        task.locator("[data-arrow-item]").click()
        page.keyboard.press("ControlOrMeta+k")
        search.fill("repeat")
        page.locator("[cmdk-item]").get_by_text(re.compile(r"^Repeat(?:…|:)")).click()

    repeat()
    search.fill("custom")
    search.press("Enter")
    expect(editor.get_by_role("radio", name="On a schedule")).to_be_focused()
    shot("custom-repeat")
    page.keyboard.press("Escape")
    expect(search).to_be_focused()
    search.press("Enter")
    editor.get_by_role("radio", name="Day", exact=True).click()
    editor.get_by_role("button", name="More: How often").click()
    editor.get_by_role("button", name="Repeat", exact=True).click()
    expect(task).to_contain_text(re.compile(r"repeats every 2 days", re.I))

    repeat()
    search.fill("after i finish")
    search.press("Enter")
    expect(editor.get_by_role("radio", name="After I finish it")).to_be_focused()
    shot("after-completion")
    editor.get_by_role("button", name="Back").click()
    expect(search).to_be_focused()
    search.press("Enter")
    editor.get_by_role("radio", name="Week", exact=True).click()
    editor.get_by_role("button", name="Repeat", exact=True).click()
    expect(task).to_contain_text(re.compile(r"week after", re.I))
    undo(page)
    expect(task).to_contain_text(re.compile(r"repeats every 2 days", re.I))


def check_upcoming(page, shot):
    page.goto(f"{BASE}/upcoming", wait_until="domcontentloaded")
    task = page.locator("[data-task-key]").filter(has_text=GARY)
    task.get_by_text(GARY, exact=True).click(button="right")
    page.get_by_role("menuitem", name="Move to Trash").click()
    expect(task).to_have_count(0)

    page.goto(f"{BASE}/trash", wait_until="domcontentloaded")
    deleted = page.locator("[data-menu-trash]").filter(has_text=GARY)
    deleted.get_by_text(GARY, exact=True).click(button="right")
    page.get_by_role("menuitem", name="Delete Forever…").click()
    page.get_by_role("button", name="Delete Task", exact=True).click()
    expect(deleted).to_have_count(0)
    expect(page.locator("[data-toaster] li").get_by_text(re.compile(r"Send Gary.*deleted"))).to_be_visible()

    page.goto(f"{BASE}/upcoming", wait_until="domcontentloaded")
    occurrence = page.get_by_role("button", name=re.compile(f"Repeats next: {GARY}"))
    occurrence.click()
    stop = page.get_by_role("menuitem", name="Stop Repeating")
    expect(stop).to_be_enabled()
    shot("stop-repeat")
    stop.click()
    expect(occurrence).to_have_count(0)
    undo(page)
    expect(occurrence).to_be_visible()
    page.reload()
    expect(occurrence).to_be_visible()
    expect(task).to_have_count(0)


def main():
    for url in (BASE, CONVEX_URL):
        if urlsplit(url).hostname not in {"localhost", "127.0.0.1", "::1"}:
            sys.exit("This check needs a disposable local backend and a local web server.")
    OUT.mkdir(parents=True, exist_ok=True)
    namespace = re.sub(r"[^a-zA-Z0-9]", "", CONVEX_URL)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, executable_path=os.environ.get("BROWSER_EXECUTABLE"))
        for width, height in ((1440, 900), (390, 844)):
            for theme in ("light", "dark"):
                today = datetime.now(ZoneInfo(TIME_ZONE)).date().isoformat()
                convex("scratch:seed", {"today": today, "timeZone": TIME_ZONE})
                session = json.loads(convex("scratch:signIn"))
                context = browser.new_context(
                    viewport={"width": width, "height": height},
                    color_scheme=theme,
                    reduced_motion="reduce",
                    timezone_id=TIME_ZONE,
                    storage_state={
                        "cookies": [],
                        "origins": [{
                            "origin": BASE,
                            "localStorage": [
                                {"name": f"__convexAuthJWT_{namespace}", "value": session["accessToken"]},
                                {"name": f"__convexAuthRefreshToken_{namespace}", "value": session["refreshToken"]},
                            ],
                        }],
                    },
                )
                page = context.new_page()
                page.set_default_timeout(12_000)
                page.set_default_navigation_timeout(90_000)
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))

                def shot(name):
                    page.screenshot(path=str(OUT / f"{name}-{width}-{theme}.png"))

                try:
                    check_templates(page, shot)
                    check_command_bar(page, shot)
                    check_upcoming(page, shot)
                    assert not errors, errors
                except Exception:
                    shot("failure")
                    raise
                print(f"Passed at {width}px in {theme} mode", flush=True)
                context.close()
        browser.close()


if __name__ == "__main__":
    main()
