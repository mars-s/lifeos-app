"""Planner and Notes as two modes of one window (#82).

Drives the mode switch at the top of the sidebar, Cmd+1 and Cmd+2 from anywhere (also while typing in a
note), the place each mode remembers, and the five things that cross between the modes:

1. a note opens beside the Planner (Cmd+K then Cmd+Enter) without a mode change,
2. a Task chip in a note ticks, undoes and opens the real Task card on the note's page,
3. Cmd+K finds a note and a Task, and Enter switches mode only when it must,
4. Cmd+J opens LifeOS AI on whatever is in front: the note, or the Task card over it,
5. the Planner's day header opens that day's note, and the daily note links back to the Planner.

It runs at desktop width in light and dark, and checks the switch inside the drawer at iPhone width,
saving screenshots of each mode. Needs the throwaway backend from local-backend.sh and the web app:

    SCRATCH=/tmp/lifeos-local-backend sh scripts/local-backend.sh
    (cd $SCRATCH && CONVEX_AGENT_MODE=anonymous npx convex dev --typecheck disable) &
    WAKU_PUBLIC_CONVEX_URL=http://127.0.0.1:3210 npx waku dev --port 4061 &
    SCRATCH=/tmp/lifeos-local-backend uv run --with playwright python scripts/check-modes.py <output folder>

BASE and CONVEX_URL change the run. Notes stay on the device without a relay, which is enough here. Each
browser context signs in afresh. Exits non-zero on a failure.
"""

import json
import os
import re
import subprocess
import sys
import time
from datetime import date
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:4061")
CONVEX_URL = os.environ.get("CONVEX_URL", "http://127.0.0.1:3210")
SCRATCH = os.environ.get("SCRATCH", "/tmp/lifeos-local-backend")
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
NAMESPACE = re.sub(r"[^a-zA-Z0-9]", "", CONVEX_URL)
ZONE = subprocess.check_output(["node", "-e", "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)"], text=True).strip()
ENV = {**os.environ, "CONVEX_AGENT_MODE": "anonymous"}
TODAY = date.today().isoformat()
TASK = "Reply to Harry about the October invoice"
EDITOR = ".note-editor .cm-content"
failed = []


def convex(*args):
    return subprocess.check_output(["npx", "convex", *args], cwd=SCRATCH, env=ENV, text=True)


def expect(step, got, wanted=True):
    ok = wanted(got) if callable(wanted) else got == wanted
    print(("ok   " if ok else "FAIL ") + step + ("" if ok else f": got {got!r}"))
    if not ok:
        failed.append(step)


def seed():
    convex("run", "scratch:seed", json.dumps({"today": TODAY, "timeZone": ZONE}))
    convex("run", "scratch:storeSecret", json.dumps({"last4": "test"}))
    rows = [json.loads(line) for line in convex("data", "tasks", "--limit", "500", "--format", "jsonLines").splitlines() if line.startswith("{")]
    return next(row["_id"] for row in rows if row.get("title") == TASK and row.get("status", {}).get("kind") == "open")


def signed_in(browser, theme, width, height):
    session = json.loads(convex("run", "scratch:signIn"))
    context = browser.new_context(viewport={"width": width, "height": height}, color_scheme=theme, device_scale_factor=2)
    page = context.new_page()
    page.on("pageerror", lambda error: expect(f"no page error ({error})", False))
    page.goto(f"{BASE}/design")
    page.evaluate(
        "([namespace, s]) => { localStorage.setItem(`__convexAuthJWT_${namespace}`, s.accessToken);"
        " localStorage.setItem(`__convexAuthRefreshToken_${namespace}`, s.refreshToken); }",
        [NAMESPACE, session],
    )
    return context, page


def mode(page):
    return page.locator("nav[data-sidebar-mode]").get_attribute("data-sidebar-mode")


def path(page):
    return re.sub(r"^https?://[^/]+", "", page.url)


def settle(page, ms=500):
    page.wait_for_timeout(ms)


def shoot(page, name):
    page.screenshot(path=str(OUT / f"{name}.png"))


def write_note(page, title, task_id):
    page.locator("nav[data-sidebar-mode=notes]").get_by_role("button", name="New note").click()
    page.wait_for_url(re.compile(r"/notes\?id="))
    editor = page.locator(EDITOR)
    editor.wait_for()
    editor.click()
    page.keyboard.type(f"{title}\n")
    page.keyboard.insert_text(f"Before the meeting: [[task:{task_id}|{TASK}]] then the rest.\n")
    page.keyboard.press("ArrowUp")
    settle(page, 900)
    return path(page)


def desktop(browser, theme, task_id):
    context, page = signed_in(browser, theme, 1440, 900)
    tag = f"[{theme}]"
    title = f"Modes check {theme} {int(time.time())}"
    page.goto(f"{BASE}/today")
    page.wait_for_selector("#main li[data-task-key]")
    settle(page, 900)

    nav = page.locator("nav[data-sidebar-mode]")
    expect(f"{tag} the window opens in Planner mode", mode(page), "planner")
    rows = [nav.get_by_role("link", name=re.compile(f"^{name}")).count() > 0 for name in ("Inbox", "Today", "Planner", "Anytime", "Someday", "Logbook")]
    expect(f"{tag} Planner mode lists Inbox, Today, Planner, Anytime, Someday and Logbook", all(rows))
    expect(f"{tag} the Notes row is gone from the sidebar", nav.get_by_role("link", name=re.compile("^Notes")).count(), 0)
    shoot(page, f"modes-planner-{theme}")

    page.locator("[data-mode-switch]").get_by_role("button", name="Notes").click()
    page.wait_for_url(re.compile(r"/notes"))
    settle(page)
    expect(f"{tag} the switch turns the sidebar into Notes", mode(page), "notes")
    expect(f"{tag} Notes mode has search and Today's note", (nav.get_by_role("searchbox", name="Search notes").count(), nav.get_by_role("button", name=re.compile("^Today")).count()), (1, 1))

    note = write_note(page, title, task_id)
    shoot(page, f"modes-notes-{theme}")

    page.locator(EDITOR).click()
    page.keyboard.press("Meta+1")
    settle(page)
    expect(f"{tag} Cmd+1 while typing in a note goes back to the Planner's place", (mode(page), path(page)), ("planner", "/today"))
    thumb = page.locator("[data-mode-switch] > span").first.evaluate("(node) => getComputedStyle(node).transitionDuration")
    expect(f"{tag} the keys do not animate the switch", thumb, "0s")
    nav.get_by_role("link", name=re.compile("^Anytime")).click()
    page.wait_for_url(re.compile("/anytime"))
    settle(page)
    page.keyboard.press("Meta+2")
    settle(page)
    expect(f"{tag} Cmd+2 returns to the same note", (mode(page), path(page)), ("notes", note))
    page.keyboard.press("Meta+1")
    settle(page)
    expect(f"{tag} Cmd+1 returns to Anytime", (mode(page), path(page)), ("planner", "/anytime"))
    page.locator("[data-mode-switch]").get_by_role("button", name="Notes").click()
    settle(page)
    page.locator("[data-mode-switch]").get_by_role("button", name="Planner").click()
    settle(page)
    expect(f"{tag} a click on the switch remembers places too", path(page), "/anytime")

    page.goto(f"{BASE}/today")
    page.wait_for_selector("#main li[data-task-key]")
    settle(page, 900)
    page.keyboard.press("Meta+k")
    page.keyboard.type(title)
    settle(page, 400)
    page.keyboard.press("Meta+Enter")
    beside = page.locator("aside[aria-label='Note beside the Planner']")
    beside.wait_for()
    settle(page, 700)
    expect(f"{tag} 1. a note opens beside the Planner without a mode change", (mode(page), path(page)), ("planner", "/today"))
    shoot(page, f"modes-beside-{theme}")
    beside.get_by_role("button", name="Close the note").click()
    settle(page)

    page.keyboard.press("Meta+k")
    page.keyboard.type(title)
    settle(page, 400)
    page.keyboard.press("Enter")
    settle(page, 900)
    expect(f"{tag} 3. Cmd+K finds the note and Enter switches to Notes", (mode(page), path(page)), ("notes", note))

    chip = page.locator(".cm-chip-task").first
    chip.wait_for()
    chip.locator(".cm-chip-box").click()
    page.wait_for_selector(".cm-chip-task .cm-chip-box.is-done", timeout=4000)
    expect(f"{tag} 2. the Task chip ticks in place", (page.locator(".cm-chip-task .cm-chip-box.is-done").count(), path(page)), (1, note))
    page.locator("[data-toaster]").get_by_role("button", name="Undo").first.click()
    page.wait_for_selector(".cm-chip-task .cm-chip-box:not(.is-done)", timeout=4000)
    expect(f"{tag} 2. undo reopens it in place", (page.locator(".cm-chip-task .cm-chip-box.is-done").count(), path(page)), (0, note))
    page.locator(".cm-chip-task .cm-chip-label").first.click()
    card = page.locator("[data-task-beside] li[data-open-card]")
    card.wait_for()
    settle(page, 900)
    expect(f"{tag} 2. the chip opens the real Task card on the note's page", (mode(page), path(page), card.count()), ("notes", note, 1))
    shoot(page, f"modes-task-in-note-{theme}")

    page.keyboard.press("Meta+j")
    settle(page, 500)
    expect(f"{tag} 4. Cmd+J with the Task card in front asks about the Task", card.locator("[role=dialog][aria-label='LifeOS AI']").count(), 1)
    page.keyboard.press("Escape")
    settle(page, 300)
    page.keyboard.press("Escape")
    settle(page, 500)
    expect(f"{tag} 2. Escape closes the card and stays on the note", (page.locator("[data-task-beside]").count(), path(page)), (0, note))

    page.locator(EDITOR).click()
    page.keyboard.press("Meta+j")
    note_ai = page.locator("[role=dialog][aria-label='LifeOS AI on this note']")
    note_ai.wait_for()
    expect(f"{tag} 4. Cmd+J with the note in front asks about the note", note_ai.count(), 1)
    shoot(page, f"modes-note-ai-{theme}")
    page.keyboard.press("Escape")
    settle(page, 300)

    page.keyboard.press("Meta+k")
    page.keyboard.type(TASK)
    settle(page, 400)
    page.keyboard.press("Enter")
    settle(page, 900)
    expect(f"{tag} 3. Cmd+K finds the Task and Enter switches to the Planner", mode(page), "planner")

    page.goto(f"{BASE}/planner")
    page.wait_for_selector(f"[data-day-note='{TODAY}']")
    settle(page, 900)
    page.locator(f"[data-day-note='{TODAY}']").first.click()
    beside.wait_for()
    settle(page, 900)
    expect(f"{tag} 5. the Planner's day header opens that day's note beside it", (beside.locator(f"[aria-label='Journal for {TODAY}']").count(), mode(page)), (1, "planner"))
    shoot(page, f"modes-day-note-{theme}")
    beside.get_by_role("button", name="Open in Notes").click()
    page.wait_for_url(re.compile(f"day-{TODAY}"))
    settle(page, 900)
    expect(f"{tag} 5. the day's note opens in Notes mode", mode(page), "notes")
    page.locator("#main").get_by_role("button", name="Planner", exact=True).click()
    page.wait_for_url(re.compile("/planner"))
    settle(page)
    expect(f"{tag} 5. the daily note links back to the Planner", (mode(page), path(page)), ("planner", "/planner"))

    page.goto(f"{BASE}/settings")
    settle(page, 900)
    expect(f"{tag} Settings keeps the mode you came from", mode(page), "planner")
    context.close()


def phone(browser, theme):
    context, page = signed_in(browser, theme, 390, 844)
    tag = f"[phone {theme}]"
    page.goto(f"{BASE}/today")
    page.wait_for_selector("#main li[data-task-key]")
    settle(page, 900)
    page.get_by_role("button", name="Open the sidebar").click()
    settle(page, 500)
    switch = page.locator("[data-mode-switch]")
    expect(f"{tag} the drawer carries the switch", switch.is_visible())
    shoot(page, f"modes-phone-planner-{theme}")
    switch.get_by_role("button", name="Notes").click()
    page.wait_for_url(re.compile("/notes"))
    settle(page, 700)
    expect(f"{tag} Notes mode lists the notes in the page", page.locator("#main section[aria-label=Notes]").is_visible())
    shoot(page, f"modes-phone-notes-{theme}")
    page.get_by_role("button", name="Open the sidebar").click()
    settle(page, 500)
    expect(f"{tag} the drawer shows the notes column", mode(page), "notes")
    shoot(page, f"modes-phone-drawer-notes-{theme}")
    switch.get_by_role("button", name="Planner").click()
    page.wait_for_url(re.compile("/today"))
    settle(page)
    expect(f"{tag} Planner returns to Today", mode(page), "planner")
    context.close()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    task_id = seed()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        for theme in ("light", "dark"):
            desktop(browser, theme, task_id)
            phone(browser, theme)
        browser.close()
    print("FAILED: " + ", ".join(failed) if failed else "All mode checks passed.")
    sys.exit(1 if failed else 0)


main()
