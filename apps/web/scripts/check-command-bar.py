"""The command bar, quick capture and the shortcut sheet, end to end.

Needs the throwaway backend from local-backend.sh and the web app running:

    SCRATCH=/tmp/lifeos-local-backend sh scripts/local-backend.sh
    (cd $SCRATCH && CONVEX_AGENT_MODE=anonymous npx convex dev) &
    WAKU_PUBLIC_CONVEX_URL=http://127.0.0.1:3210 npx waku dev --port 4026 &
    pip install playwright && playwright install chromium
    SCRATCH=/tmp/lifeos-local-backend python scripts/check-command-bar.py <output folder>

BASE, CONVEX_URL, THEME (light or dark) and MOTION (reduce) change the run.
It prints ok or FAIL per step, saves screenshots and exits non-zero on a failure.
The last step reseeds the backend to force a failed save.
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:4026")
CONVEX_URL = os.environ.get("CONVEX_URL", "http://127.0.0.1:3210")
SCRATCH = os.environ.get("SCRATCH", "/tmp/lifeos-local-backend")
THEME = os.environ.get("THEME", "light")
MOTION = os.environ.get("MOTION", "no-preference")
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
NAMESPACE = re.sub(r"[^a-zA-Z0-9]", "", CONVEX_URL)
BAR = "[cmdk-root]"
failed = []


def convex(function, args="{}"):
    return subprocess.check_output(["npx", "convex", "run", function, args], cwd=SCRATCH, text=True)


def expect(step, got, wanted):
    if got == wanted:
        print(f"ok    {step}")
    else:
        print(f"FAIL  {step}: wanted {wanted!r}, got {got!r}")
        failed.append(step)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    session = json.loads(convex("scratch:signIn"))
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 900}, color_scheme=THEME, reduced_motion=MOTION)
        page = context.new_page()
        page.on("pageerror", lambda error: failed.append(f"page error: {error}") or print(f"FAIL  page error: {error}"))
        page.goto(f"{BASE}/design")
        page.evaluate(
            "([namespace, s]) => { localStorage.setItem(`__convexAuthJWT_${namespace}`, s.accessToken);"
            " localStorage.setItem(`__convexAuthRefreshToken_${namespace}`, s.refreshToken); }",
            [NAMESPACE, session],
        )
        page.goto(f"{BASE}/today")
        page.wait_for_selector("#main [data-task-key]")
        page.wait_for_timeout(800)

        def shot(name):
            page.screenshot(path=str(OUT / f"{name}-{THEME}.png"))

        def sidebar_count(label):
            counts = page.locator("nav a", has_text=label).first.locator(".sr-only").all_inner_texts()
            return int(counts[-1]) if counts and counts[-1].isdigit() else 0

        def path():
            return page.evaluate("location.pathname")

        def groups():
            return page.locator(f"{BAR} [cmdk-group-heading]").all_inner_texts()

        def selected():
            return page.locator(f"{BAR} [cmdk-item][data-selected=true]").inner_text().split("\n")[0]

        def open_bar():
            page.keyboard.press("ControlOrMeta+k")
            page.wait_for_selector(BAR)

        open_bar()
        expect("Cmd+K opens the command bar with the search field focused", page.evaluate("document.activeElement?.name"), "command")
        expect("an empty bar lists where to go and what to create", groups()[:2], ["Go to", "Create"])
        shot("bar-empty")

        page.keyboard.type("paper")
        page.wait_for_timeout(120)
        found = groups()
        expect("search finds Tasks, Projects and Areas", [name in found for name in ["Tasks", "Projects", "Areas"]], [True, True, True])
        shot("bar-search")
        page.keyboard.press("Escape")
        expect("Escape closes the bar", page.locator(BAR).count(), 0)

        open_bar()
        page.keyboard.type("anyt")
        page.keyboard.press("Enter")
        page.wait_for_timeout(400)
        expect("Enter on a list goes there", path(), "/anytime")
        open_bar()
        page.keyboard.type("upcoming")
        page.keyboard.press("Enter")
        page.wait_for_timeout(400)
        expect("the Upcoming tab can be reached", path(), "/upcoming")
        open_bar()
        expect("recent places show when the bar is empty", groups()[0], "Recent")
        page.keyboard.type("planner")
        page.keyboard.press("Enter")
        page.wait_for_timeout(400)
        expect("the Planner tab can be reached", path(), "/planner")

        open_bar()
        page.keyboard.type("physio")
        page.wait_for_timeout(120)
        expect("a Task is found by its title", selected(), "Book a physio appointment")
        page.keyboard.press("Tab")
        page.wait_for_timeout(120)
        expect("Tab turns the found Task into the target", groups()[0], "This Task")
        expect("Complete is first for the target", selected(), "Complete")
        page.keyboard.press("Backspace")
        page.keyboard.type("physio")
        page.wait_for_timeout(120)
        page.keyboard.press("Enter")
        page.wait_for_timeout(600)
        expect("Enter on a Task opens it in its list", [path(), page.locator("[data-open-card]").count()], ["/today", 1])
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)

        rows = page.locator("#main [data-task-key]")
        before = sidebar_count("Today")
        rows.nth(3).click()
        rows.nth(4).click(modifiers=["Shift"])
        open_bar()
        expect("with Tasks selected the bar says how many", page.locator(f"{BAR} button[aria-label^='Actions apply']").inner_text().replace("\n", " "), "2 Tasks")
        expect("Complete is first and highlighted", selected(), "Complete 2 Tasks")
        shot("bar-selected")
        page.keyboard.press("Enter")
        page.wait_for_timeout(2600)
        expect("Cmd+K then Enter completes the selection", sidebar_count("Today"), before - 2)
        page.keyboard.press("ControlOrMeta+z")
        page.wait_for_timeout(900)
        expect("Cmd+Z brings them back", sidebar_count("Today"), before)

        rows.nth(3).click()
        open_bar()
        page.keyboard.type("when")
        page.keyboard.press("Enter")
        page.wait_for_timeout(120)
        expect("When opens its own page", groups(), ["When"])
        shot("bar-when")
        page.keyboard.type("next week")
        page.wait_for_timeout(120)
        page.keyboard.press("Enter")
        page.wait_for_timeout(700)
        expect("a typed date moves the Task out of Today", sidebar_count("Today"), before - 1)
        page.keyboard.press("ControlOrMeta+z")
        page.wait_for_timeout(900)
        expect("and undo puts it back", sidebar_count("Today"), before)

        rows.nth(3).click()
        open_bar()
        page.keyboard.type("45m")
        page.wait_for_timeout(120)
        expect("a typed Estimate is offered straight away", selected(), "Estimate: 0:45")
        page.keyboard.press("Enter")
        page.wait_for_timeout(500)
        expect("and it lands on the row", "0:45" in rows.nth(3).inner_text(), True)
        page.keyboard.press("ControlOrMeta+z")
        page.keyboard.press("Escape")
        page.wait_for_timeout(600)

        inbox = sidebar_count("Inbox")
        page.keyboard.press("q")
        page.wait_for_selector("input[name=capture]")
        expect("Q opens quick capture", page.evaluate("document.activeElement?.name"), "capture")
        shot("capture-empty")
        page.keyboard.type("Buy oat milk")
        page.keyboard.press("Enter")
        expect("a plain capture counts in the Inbox in the same frame", sidebar_count("Inbox"), inbox + 1)
        expect("and the capture closes", page.locator("input[name=capture]").count(), 0)
        page.wait_for_timeout(700)
        page.keyboard.press("1")
        page.wait_for_timeout(500)
        expect("it is in the Inbox", page.locator("#main [data-task-key]", has_text="Buy oat milk").count(), 1)

        page.keyboard.press("q")
        page.wait_for_selector("input[name=capture]")
        page.keyboard.type("Write essay tomorrow 1h30 #deep !fri @uni")
        page.wait_for_timeout(250)
        chips = [re.sub(r"\s+", " ", text).strip() for text in page.locator("[role=dialog] button[aria-label*='Remove and keep']").all_inner_texts()]
        expect("shortcuts become chips as you type", len(chips), 5)
        expect("the chips read When, Deadline, Estimate, Label and Area", [chips[0], chips[2], chips[3], chips[4]], ["Tomorrow", "1:30", "Deep Work", "University"])
        shot("capture-chips")
        page.keyboard.press("Enter")
        page.wait_for_timeout(900)
        open_bar()
        page.keyboard.type("write essay")
        page.wait_for_timeout(150)
        row = page.locator(f"{BAR} [cmdk-item]", has_text="Write essay").first.inner_text().replace("\n", " ")
        expect("the capture kept only the title, in its Area, for tomorrow", row, "Write essay University · Tomorrow")
        page.keyboard.press("Enter")
        page.wait_for_timeout(700)
        card = page.locator("[data-open-card]").inner_text() + " ".join(
            page.locator("[data-open-card] input").evaluate_all("(inputs) => inputs.map((input) => input.value)")
        )
        expect("its Estimate, Label and Deadline were saved", [text in card for text in ["1:30", "Deep Work", "20 Nov"]], [True, True, True])
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)

        page.keyboard.press("q")
        page.wait_for_selector("input[name=capture]")
        page.keyboard.type("Read Friday Night Lights")
        page.wait_for_timeout(150)
        page.locator("[role=dialog] button[aria-label*='Remove and keep']").first.click()
        page.wait_for_timeout(150)
        expect("a chip can be dismissed so its words stay in the title", page.locator("[role=dialog] button[aria-label*='Remove and keep']").count(), 0)
        page.keyboard.press("Escape")

        page.keyboard.press("2")
        page.wait_for_timeout(400)
        page.keyboard.press("Shift+?")
        page.wait_for_selector("text=Keyboard shortcuts")
        expect("? opens the shortcut sheet", page.locator("[role=dialog] h3").all_inner_texts(), ["Capture", "Find and do", "Move around", "Selected Tasks"])
        expect("the sheet shows this platform's command key", page.locator("[role=dialog] kbd", has_text="⌘").count() > 0, page.evaluate("/Mac/.test(navigator.platform)"))
        shot("shortcut-sheet")
        page.keyboard.press("Escape")

        page.keyboard.press("1")
        page.wait_for_timeout(300)
        page.keyboard.press("t")
        page.wait_for_timeout(500)
        expect("T makes a Task in Today", [path(), page.locator("[data-open-card]").count()], ["/today", 1])
        page.keyboard.press("ControlOrMeta+k")
        page.wait_for_selector(BAR)
        expect("Cmd+K works while a card is open and targets its Task", groups()[0], "This Task")
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)
        page.keyboard.press("Escape")
        page.wait_for_timeout(600)
        expect("Escape on the new Task leaves nothing behind", [page.locator("[data-open-card]").count(), page.get_by_text("Task created").count()], [0, 0])

        page.keyboard.press("q")
        page.wait_for_selector("input[name=capture]")
        page.keyboard.type("Lost thought #deep")
        page.wait_for_timeout(200)
        context.set_offline(True)
        convex("scratch:seed", json.dumps({"today": page.evaluate("new Date().toLocaleDateString('en-CA')")}))
        page.keyboard.press("Enter")
        context.set_offline(False)
        page.wait_for_selector("input[name=capture]", timeout=15000)
        expect("a failed save reopens with the words kept", page.input_value("input[name=capture]"), "Lost thought #deep")
        expect("and says so", "did not save" in page.locator("#capture-status").inner_text(), True)
        shot("capture-failed")
        page.keyboard.type("s")
        expect("with the caret at the end, so typing adds to them", page.input_value("input[name=capture]"), "Lost thought #deeps")
        page.keyboard.press("Backspace")
        page.keyboard.type("p")
        page.keyboard.press("Backspace")
        page.keyboard.press("Enter")
        page.wait_for_timeout(900)
        page.keyboard.press("1")
        page.wait_for_timeout(500)
        expect("Enter retries and it saves", page.locator("#main [data-task-key]", has_text="Lost thought").count(), 1)

        browser.close()
    print("FAILED: " + ", ".join(failed) if failed else "All steps passed")
    sys.exit(1 if failed else 0)


main()
