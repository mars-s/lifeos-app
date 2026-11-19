"""N makes a draft Task where the pointer is, and Escape leaves nothing behind.

Needs the throwaway backend from local-backend.sh and the web app running:

    SCRATCH=/tmp/lifeos-local-backend sh scripts/local-backend.sh
    (cd $SCRATCH && CONVEX_AGENT_MODE=anonymous npx convex dev --typecheck disable) &
    WAKU_PUBLIC_CONVEX_URL=http://127.0.0.1:3210 npx waku dev --port 4061 &
    SCRATCH=/tmp/lifeos-local-backend uv run --with playwright python scripts/check-new-task.py <output folder>

It reseeds the backend first. BASE, CONVEX_URL and THEME (light or dark) change the run. It exits non-zero on a failure.
"""

import json
import os
import re
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:4061")
CONVEX_URL = os.environ.get("CONVEX_URL", "http://127.0.0.1:3210")
SCRATCH = os.environ.get("SCRATCH", "/tmp/lifeos-local-backend")
THEME = os.environ.get("THEME", "light")
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
NAMESPACE = re.sub(r"[^a-zA-Z0-9]", "", CONVEX_URL)
TODAY = date.today().isoformat()
TOMORROW = (date.today() + timedelta(days=1)).isoformat()
AFTER = (date.today() + timedelta(days=2)).isoformat()
ZONE = subprocess.check_output(["node", "-e", "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)"], text=True).strip()
HOUR_PX = 56
SUFFIX = "" if THEME == "light" else "-dark"
ENV = {**os.environ, "CONVEX_AGENT_MODE": "anonymous"}
failed = []


def convex(*args):
    return subprocess.check_output(["npx", "convex", *args], cwd=SCRATCH, text=True, env=ENV, stderr=subprocess.DEVNULL)


def rows(table):
    out = convex("data", table, "--limit", "5000", "--format", "jsonArray")
    return json.loads(out) if out.strip().startswith("[") else []


def tasks_titled(title):
    return [task for task in rows("tasks") if task["title"] == title]


def expect(step, got, wanted):
    if got == wanted:
        print(f"ok    {step}")
    else:
        print(f"FAIL  {step}: wanted {wanted!r}, got {got!r}")
        failed.append(step)


def hover(page, selector, y_fraction=0.6):
    page.locator(selector).first.scroll_into_view_if_needed()
    box = page.locator(selector).first.bounding_box()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] * y_fraction)


def type_title(page, title):
    field = page.get_by_role("textbox", name="Title", exact=True)
    field.wait_for(timeout=3000)
    page.wait_for_timeout(500)
    shown = field.evaluate(
        "(el) => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + 8, r.top + r.height / 2); return el === document.activeElement && el.contains(hit); }"
    )
    expect(f"{title}: the draft's title field is focused and on screen", shown, True)
    if not shown:
        print("info  ", field.evaluate("(el) => { const r = el.getBoundingClientRect(); const ul = el.closest('ul').getBoundingClientRect(); const hit = document.elementFromPoint(r.left + 8, r.top + r.height / 2); return [Math.round(r.top), Math.round(r.height), Math.round(ul.top), Math.round(ul.bottom), innerHeight, hit && hit.outerHTML.slice(0, 120), el === document.activeElement]; }"))
    page.keyboard.type(title)
    page.keyboard.press("Enter")
    page.wait_for_timeout(900)


def created(page, step, title, where, when):
    found = tasks_titled(title)
    expect(f"{step}: saves exactly one Task", len(found), 1)
    if found:
        expect(f"{step}: When is {when}", found[0]["when"], when)
    expect(f"{step}: the row shows in {where}", page.locator(where).get_by_text(title, exact=True).count() >= 1, True)
    return found[0] if found else None


def escape_leaves_nothing(page, step, target):
    before_tasks = len(rows("tasks"))
    before_activity = len(rows("activity"))
    hover(page, target)
    page.keyboard.press("n")
    page.get_by_role("textbox", name="Title", exact=True).wait_for(timeout=3000)
    page.keyboard.press("Escape")
    page.wait_for_timeout(900)
    expect(f"{step}: N then Escape creates no Task", len(rows("tasks")), before_tasks)
    expect(f"{step}: N then Escape records no Activity", len(rows("activity")), before_activity)
    expect(f"{step}: N then Escape shows no toast", page.get_by_text("Task created").count(), 0)
    expect(f"{step}: N then Escape leaves no row", page.get_by_role("textbox", name="Title", exact=True).count(), 0)


def go(page, path, ready):
    page.goto(f"{BASE}{path}")
    page.locator(ready).first.wait_for()
    page.wait_for_timeout(600)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    convex("run", "scratch:seed", json.dumps({"today": TODAY, "timeZone": ZONE}))
    session = json.loads(convex("run", "scratch:signIn"))
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1600, "height": 900}, color_scheme=THEME, device_scale_factor=2)
        page = context.new_page()
        page.on("pageerror", lambda error: failed.append(f"page error: {error}") or print(f"FAIL  page error: {error}"))
        page.goto(f"{BASE}/design")
        page.evaluate(
            "([namespace, s]) => { localStorage.setItem(`__convexAuthJWT_${namespace}`, s.accessToken);"
            " localStorage.setItem(`__convexAuthRefreshToken_${namespace}`, s.refreshToken); }",
            [NAMESPACE, session],
        )

        go(page, "/planner", f"[data-plan-day='{TODAY}'] [data-task-key]")
        escape_leaves_nothing(page, "Brain Dump", "[data-plan-list=inbox]")
        escape_leaves_nothing(page, "Planner day", f"[data-plan-day='{TOMORROW}']")

        hover(page, "[data-plan-list=inbox]")
        page.keyboard.press("n")
        page.wait_for_timeout(300)
        page.screenshot(path=str(OUT / f"app-new-task-draft{SUFFIX}.png"))
        type_title(page, "Dump this thought")
        created(page, "N over the Brain Dump", "Dump this thought", "section[aria-label='Brain Dump']", {"kind": "inbox"})

        for day, title in [(TODAY, "Today column task"), (TOMORROW, "Tomorrow column task"), (AFTER, "Day after column task")]:
            hover(page, f"[data-plan-day='{day}'] [data-plan-list]")
            page.keyboard.press("n")
            type_title(page, title)
            created(page, f"N over the {day} column", title, f"[data-plan-day='{day}']", {"kind": "scheduled", "date": day, "evening": False})
        page.screenshot(path=str(OUT / f"app-new-task-planner{SUFFIX}.png"))

        page.get_by_role("button", name="Undo").first.click()
        page.wait_for_timeout(1200)
        expect("Undo removes the last new Task", page.locator(f"[data-plan-day='{AFTER}']").get_by_text("Day after column task", exact=True).count(), 0)

        page.mouse.move(5, 5)
        row = page.locator(f"[data-plan-day='{TOMORROW}'] [data-arrow-item]").first
        row.focus()
        page.keyboard.press("n")
        type_title(page, "Keyboard only task")
        created(page, "N with a focused row and no hover", "Keyboard only task", f"[data-plan-day='{TOMORROW}']", {"kind": "scheduled", "date": TOMORROW, "evening": False})

        add = page.get_by_role("textbox", name=re.compile(f"^Add a Task to .*")).nth(1)
        add.click()
        page.keyboard.press("Escape")
        before = len(rows("tasks"))
        page.wait_for_timeout(300)
        expect("Escape in an empty Add task row creates nothing", len(rows("tasks")), before)
        add.click()
        page.keyboard.type("Added from the row")
        page.keyboard.press("Enter")
        page.wait_for_timeout(900)
        expect("Add task row saves once", len(tasks_titled("Added from the row")), 1)
        page.keyboard.press("Escape")

        page.locator("[data-plan-scroll=timebox]").evaluate(f"(node) => node.scrollTo({{ top: {8 * HOUR_PX} }})")
        page.wait_for_timeout(300)
        column = page.locator(f"[data-cal-day='{TODAY}']")
        box = column.bounding_box()
        x = box["x"] + box["width"] * 0.5
        top = page.locator("[data-plan-scroll=timebox]").bounding_box()["y"] + 40

        def surface_at(minute):
            y = box["y"] + minute / 60 * HOUR_PX
            hit = page.evaluate("([x, y]) => { const hit = document.elementFromPoint(x, y); return hit ? hit.matches('[data-cal-day]') : false; }", [x, y])
            return y, hit

        busy = next(minute for minute in range(8 * 60, 20 * 60, 15) if surface_at(minute)[1] is False and surface_at(minute)[0] > top)
        page.mouse.move(x, surface_at(busy)[0] + 4)
        page.keyboard.press("n")
        type_title(page, "Busy slot task")
        task = created(page, "N over a busy Timebox time", "Busy slot task", f"[data-plan-day='{TODAY}']", {"kind": "scheduled", "date": TODAY, "evening": False})
        if task:
            expect("N over a busy time makes no Work Block", [block for block in rows("workBlocks") if block["taskId"] == task["_id"]], [])

        free = next(minute for minute in range(10 * 60, 20 * 60, 15) if all(surface_at(minute + step)[1] for step in (0, 15)) and surface_at(minute)[0] > top)
        page.mouse.move(x, surface_at(free)[0] + 4)
        page.keyboard.press("n")
        page.wait_for_timeout(300)
        expect("N over a free time shows the Work Block it will make", page.locator("[data-spread-preview]").filter(has_text="New Task").count(), 1)
        page.screenshot(path=str(OUT / f"app-new-task-timebox{SUFFIX}.png"))
        type_title(page, "Timebox slot task")
        task = created(page, "N over a free Timebox time", "Timebox slot task", f"[data-plan-day='{TODAY}']", {"kind": "scheduled", "date": TODAY, "evening": False})
        if task:
            blocks = [block for block in rows("workBlocks") if block["taskId"] == task["_id"]]
            expect("N over a free Timebox time makes a Work Block", len(blocks), 1)
            if blocks:
                start = page.evaluate("(start) => { const d = new Date(start); return d.getHours() * 60 + d.getMinutes(); }", blocks[0]["start"])
                expect("the Work Block starts at the time under the pointer", start, free)
            expect("saving it records one Activity entry", len([row for row in rows("activity") if row.get("action") == "task.create"]) >= 1, True)
            page.get_by_role("button", name="Undo").first.click()
            page.wait_for_timeout(1200)
            expect("one Undo removes the Task", len(tasks_titled("Timebox slot task")), 0)
            expect("one Undo removes its Work Block", [block for block in rows("workBlocks") if block["taskId"] == task["_id"]], [])

        go(page, "/today", "#main [data-task-key]")
        escape_leaves_nothing(page, "Today", "#main ul")
        hover(page, "#main ul")
        page.keyboard.press("n")
        type_title(page, "Today screen task")
        created(page, "N on Today", "Today screen task", "#main", {"kind": "scheduled", "date": TODAY, "evening": False})

        area = next(row for row in rows("areas") if row["title"] == "Paperless")
        go(page, f"/area?id={area['_id']}", "#main [data-task-key]")
        hover(page, "#main ul")
        page.keyboard.press("n")
        type_title(page, "Area task")
        found = created(page, "N in an Area", "Area task", "#main", {"kind": "anytime"})
        if found:
            expect("N in an Area files it in that Area", found["parent"], {"kind": "area", "areaId": area["_id"]})

        project = next(row for row in rows("projects") if row["title"] == "Honours thesis")
        go(page, f"/project?id={project['_id']}", "#main [data-task-key]")
        hover(page, "#main ul")
        page.keyboard.press("n")
        type_title(page, "Project task")
        found = created(page, "N in a Project", "Project task", "#main", {"kind": "anytime"})
        if found:
            expect("N in a Project files it in that Project", found["parent"].get("projectId"), project["_id"])

        heading_title = page.locator("#main section[data-new-task] h2").first.inner_text()
        section = "#main section[data-new-task] >> nth=0"
        hover(page, "#main section[data-new-task] h2", 0.5)
        page.keyboard.press("n")
        type_title(page, "Heading task")
        found = created(page, f"N over the {heading_title} Heading", "Heading task", section, {"kind": "anytime"})
        heading = next((row for row in rows("headings") if row["title"] == heading_title), None)
        if found and heading:
            expect("N over a Heading files it under that Heading", found["parent"].get("headingId"), heading["_id"])
        escape_leaves_nothing(page, "Project", "#main ul")

        page.keyboard.press("q")
        page.get_by_role("dialog").wait_for()
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)
        expect("Q then Escape creates nothing", len(tasks_titled("New Task")), 0)
        expect("no stray New Task anywhere", len(tasks_titled("New Task")), 0)

        browser.close()
    if failed:
        print(f"\n{len(failed)} failed")
        sys.exit(1)
    print("\nall passed")


main()
