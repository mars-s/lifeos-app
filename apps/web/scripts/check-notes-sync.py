"""Full copy on every device: catch-up on launch and on reconnect.

Same setup as check-notes.py (throwaway backend on 3510, local relay on 8790,
web app on 4082). Then:

    SCRATCH=/tmp/lifeos-local-backend uv run --with playwright python scripts/check-notes-sync.py

It prints ok or FAIL per step and exits non-zero on a failure.
"""

import json
import os
import re
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:4082")
CONVEX_URL = os.environ.get("CONVEX_URL", "http://127.0.0.1:3510")
SCRATCH = os.environ.get("SCRATCH", "/tmp/lifeos-local-backend")
NAMESPACE = re.sub(r"[^a-zA-Z0-9]", "", CONVEX_URL)
EDITOR = ".note-editor .cm-content"
failed = []


def convex(function, args="{}"):
    return subprocess.check_output(["npx", "convex", "run", function, args], cwd=SCRATCH, text=True, env={**os.environ, "CONVEX_AGENT_MODE": "anonymous"})


def expect(step, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'}  {step}{f'  ({detail})' if detail and not ok else ''}")
    if not ok:
        failed.append(step)


def signed_in(browser):
    context = browser.new_context(viewport={"width": 1440, "height": 900})
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
    return page.evaluate("() => { const el = document.querySelector('.note-editor .cm-content'); return el && el.cmTile ? el.cmTile.view.state.doc.toString() : ''; }")


def wait_for(page, check, timeout=10000):
    waited = 0
    while waited < timeout:
        if check():
            return True
        page.wait_for_timeout(250)
        waited += 250
    return check()


def stored_docs(page):
    return page.evaluate("async () => (await indexedDB.databases()).map((d) => d.name)")


def main():
    title = f"Catch-up check {int(time.time())}"
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        a_context, a = signed_in(browser)
        a.goto(f"{BASE}/notes")
        a.get_by_role("button", name="New note").first.click()
        a.wait_for_selector(EDITOR)
        a.wait_for_timeout(400)
        a.keyboard.type(f"{title}\nWritten on the Mac only. ", delay=8)
        doc_id = a.evaluate("new URLSearchParams(location.search).get('id')")
        a.wait_for_timeout(4000)
        a_context.close()

        b_context, b = signed_in(browser)
        b.goto(f"{BASE}/notes")
        expect(
            "on launch a device that never opened the note saves a copy of it",
            wait_for(b, lambda: f"lifeos-note-{doc_id}" in stored_docs(b), 15000),
            str(stored_docs(b)),
        )
        b_context.set_offline(True)
        b.evaluate("window.dispatchEvent(new Event('offline'))")
        b.locator("section[aria-label=Notes]").get_by_text(title).first.click()
        b.wait_for_selector(EDITOR)
        expect("offline, the note opens from that copy", wait_for(b, lambda: "Written on the Mac only." in text_of(b)), text_of(b))
        b.locator(EDITOR).click()
        b.keyboard.press("Meta+ArrowDown")
        b.keyboard.type("Added offline on the web. ", delay=8)
        b.wait_for_timeout(600)
        b.get_by_role("button", name="Notes").first.click() if b.get_by_role("button", name="Notes").count() else None
        b.locator("section[aria-label=Notes]").get_by_text("Today").first.click()
        b.wait_for_timeout(3000)
        b_context.set_offline(False)
        b.evaluate("window.dispatchEvent(new Event('online'))")
        b.wait_for_timeout(4000)

        c_context, c = signed_in(browser)
        c.goto(f"{BASE}/notes?id={doc_id}")
        c.wait_for_selector(EDITOR)
        expect(
            "back online, the device pushes the offline edit without opening the note again",
            wait_for(c, lambda: "Added offline on the web." in text_of(c)),
            text_of(c),
        )
        c_context.close()
        b_context.close()
        browser.close()
    print("all ok" if not failed else f"{len(failed)} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
