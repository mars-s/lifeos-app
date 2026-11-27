"""Notes, end to end: two windows editing one note through the Notes Relay.

Needs the throwaway backend, a local relay pointed at it, and the web app:

    SCRATCH=/tmp/lifeos-local-backend CONVEX_PORTS="--local-cloud-port 3510 --local-site-port 3511" sh scripts/local-backend.sh
    (cd $SCRATCH && CONVEX_AGENT_MODE=anonymous npx convex dev --typecheck disable --local-cloud-port 3510 --local-site-port 3511) &
    (cd $SCRATCH && npx convex run platform/workers:register '{"name":"relay","capabilities":["notes"],"tokenHash":"'$(printf %s local-relay-token | shasum -a 256 | cut -d' ' -f1)'"}')
    (cd ../relay && npx wrangler dev --port 8790 --var CONVEX_CLOUD_URL:http://127.0.0.1:3510 --var CORE_WORKER_TOKEN:local-relay-token --var QUIET_MS:1500) &
    WAKU_PUBLIC_CONVEX_URL=http://127.0.0.1:3510 WAKU_PUBLIC_NOTES_RELAY_URL=http://127.0.0.1:8790 npx waku dev --port 4082 &
    SCRATCH=/tmp/lifeos-local-backend uv run --with playwright python scripts/check-notes.py <output folder>

BASE and CONVEX_URL change the run. It prints ok or FAIL per step, saves
screenshots in light and dark at desktop and iPhone width, and exits non-zero
on a failure.
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:4082")
CONVEX_URL = os.environ.get("CONVEX_URL", "http://127.0.0.1:3510")
SCRATCH = os.environ.get("SCRATCH", "/tmp/lifeos-local-backend")
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
NAMESPACE = re.sub(r"[^a-zA-Z0-9]", "", CONVEX_URL)
EDITOR = ".note-editor .cm-content"
failed = []


def convex(function, args="{}"):
    return subprocess.check_output(["npx", "convex", "run", function, args], cwd=SCRATCH, text=True, env={**os.environ, "CONVEX_AGENT_MODE": "anonymous"})


def expect(step, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'}  {step}{f'  ({detail})' if detail and not ok else ''}")
    if not ok:
        failed.append(step)


def signed_in(browser, theme="light", width=1440, height=900):
    context = browser.new_context(viewport={"width": width, "height": height}, color_scheme=theme)
    page = context.new_page()
    page.on("pageerror", lambda error: expect(f"no page error ({error})", False))
    session = json.loads(convex("scratch:signIn"))
    page.goto(f"{BASE}/design")
    page.evaluate(
        "([namespace, s]) => { localStorage.setItem(`__convexAuthJWT_${namespace}`, s.accessToken);"
        " localStorage.setItem(`__convexAuthRefreshToken_${namespace}`, s.refreshToken); }",
        [NAMESPACE, session],
    )
    return context, page


def text_of(page):
    return page.evaluate(
        "() => { const el = document.querySelector('.note-editor .cm-content'); const view = el && el.cmTile && el.cmTile.view;"
        " return view ? view.state.doc.toString() : ''; }"
    )


def wait_for(page, check, timeout=8000):
    waited = 0
    while waited < timeout:
        if check():
            return True
        page.wait_for_timeout(200)
        waited += 200
    return check()


def type_at_end(page, value):
    page.locator(EDITOR).click()
    page.keyboard.press("Meta+ArrowDown")
    page.keyboard.type(value, delay=8)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        a_context, a = signed_in(browser)
        a.goto(f"{BASE}/notes")
        a.get_by_role("button", name="New note").first.click()
        a.wait_for_selector(EDITOR)
        a.wait_for_timeout(400)
        a.keyboard.type("Relay check\nTyped on the Mac. ", delay=8)
        doc_id = a.evaluate("new URLSearchParams(location.search).get('id')")
        expect("a new note gets its own id in the address", bool(doc_id), str(doc_id))
        expect("the sync dot says Synced", wait_for(a, lambda: a.get_by_role("status").filter(has_text="Synced").count() > 0 or "Synced" in a.content()))

        b_context, b = signed_in(browser)
        b.goto(f"{BASE}/notes?id={doc_id}")
        b.wait_for_selector(EDITOR)
        expect("a second window gets the note from the relay", wait_for(b, lambda: "Typed on the Mac." in text_of(b)), text_of(b))
        type_at_end(b, "Typed on the iPhone. ")
        expect("both windows converge", wait_for(a, lambda: text_of(a) == text_of(b) and "iPhone" in text_of(a)), f"{text_of(a)!r} vs {text_of(b)!r}")
        b.screenshot(path=str(OUT / "notes-two-windows.png"))

        a_context.set_offline(True)
        a.wait_for_timeout(600)
        type_at_end(a, "Written offline. ")
        type_at_end(b, "Written online. ")
        a.wait_for_timeout(600)
        expect("the offline window keeps its edit and waits", "Written online." not in text_of(a) and "Written offline." in text_of(a))
        expect("offline says how many edits are kept here", wait_for(a, lambda: "kept here" in a.content() or "Offline" in a.content()))
        a.screenshot(path=str(OUT / "notes-offline.png"))
        a_context.set_offline(False)
        a.evaluate("window.dispatchEvent(new Event('online'))")
        expect(
            "back online, both windows converge with every edit",
            wait_for(a, lambda: text_of(a) == text_of(b) and "Written offline." in text_of(b) and "Written online." in text_of(a), 12000),
            f"{text_of(a)!r} vs {text_of(b)!r}",
        )

        a_context.close()
        b_context.close()
        c_context, c = signed_in(browser)
        c.goto(f"{BASE}/notes?id={doc_id}")
        c.wait_for_selector(EDITOR)
        expect("a fresh window with no saved copy loads the whole note from the relay", wait_for(c, lambda: "Written offline." in text_of(c) and "Written online." in text_of(c)), text_of(c))

        c.wait_for_timeout(2500)
        listed = wait_for(c, lambda: c.locator("section[aria-label=Notes]").get_by_text("Relay check").count() > 0, 8000)
        expect("the relay's projection reaches Core and the list", listed)

        type_at_end(c, "\n- [ ] Book the ferry")
        c.keyboard.press("Meta+Enter")
        expect("Cmd+Enter makes the to-do a Task chip", wait_for(c, lambda: c.locator(".cm-chip-task").count() > 0), text_of(c))
        expect("the chip line holds a Task link", "[[task:" in text_of(c), text_of(c))
        c.get_by_role("button", name="Undo").first.click()
        expect("one undo turns the Task back into a to-do", wait_for(c, lambda: "- [ ] Book the ferry" in text_of(c)), text_of(c))

        type_at_end(c, "\nSee [[Relay")
        expect("[[ opens the link list", wait_for(c, lambda: c.locator(".cm-tooltip-autocomplete").count() > 0))
        c.screenshot(path=str(OUT / "notes-link-list.png"))
        c.keyboard.press("Escape")

        c.goto(f"{BASE}/planner")
        c.wait_for_timeout(1500)
        c.keyboard.press("Meta+k")
        c.wait_for_selector("[cmdk-root]")
        c.keyboard.type("Relay check", delay=10)
        note_row = c.locator("[cmdk-group]", has_text="Notes").locator("[cmdk-item]", has_text="Relay check").first
        expect("the command bar finds the note", wait_for(c, lambda: note_row.count() > 0))
        note_row.hover()
        c.wait_for_timeout(150)
        c.screenshot(path=str(OUT / "notes-command-bar.png"))
        c.keyboard.press("Meta+Enter")
        beside = c.locator("aside[aria-label='Note beside the Planner']")
        expect("Cmd+Enter opens the note beside the Planner", wait_for(c, lambda: beside.count() > 0 and "Typed on the Mac." in text_of(c)))
        c.wait_for_timeout(500)
        c.screenshot(path=str(OUT / "notes-beside-planner.png"))
        c.keyboard.press("Escape")
        expect("Escape closes it", wait_for(c, lambda: beside.count() == 0))

        for theme in ("light", "dark"):
            for width, height, name in ((1440, 900, "desktop"), (390, 844, "phone")):
                ctx, page = signed_in(browser, theme, width, height)
                page.goto(f"{BASE}/notes?id={doc_id}")
                page.wait_for_selector(EDITOR)
                page.wait_for_timeout(1200)
                scrolls = page.evaluate("document.documentElement.scrollWidth > window.innerWidth")
                expect(f"no sideways scroll ({theme}, {name})", not scrolls)
                page.screenshot(path=str(OUT / f"notes-{name}-{theme}.png"))
                if name == "phone":
                    page.get_by_role("button", name="Notes").first.click()
                    page.wait_for_timeout(500)
                    page.screenshot(path=str(OUT / f"notes-list-{name}-{theme}.png"))
                else:
                    page.goto(f"{BASE}/notes?id=day-{page.evaluate('new Date().toLocaleDateString(`en-CA`)')}")
                    page.wait_for_selector(EDITOR)
                    page.wait_for_timeout(800)
                    page.screenshot(path=str(OUT / f"notes-daily-{theme}.png"))
                    page.get_by_role("button", name="Add a notebook page").first.click()
                    page.wait_for_timeout(300)
                    page.keyboard.type("Reading group moves to Fridays", delay=5)
                    page.keyboard.press("Enter")
                    page.wait_for_timeout(200)
                    page.keyboard.type("t Email the small-index numbers", delay=5)
                    page.screenshot(path=str(OUT / f"notes-notebook-{theme}.png"))
                    page.keyboard.press("Meta+Enter")
                    added = wait_for(page, lambda: "Notebook, page" in text_of(page) and "[[task:" in text_of(page))
                    expect(f"Add page writes the page and its Task into the day ({theme})", added, text_of(page))
                    page.keyboard.press("Escape")
                ctx.close()
        browser.close()
    print("all ok" if not failed else f"{len(failed)} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
