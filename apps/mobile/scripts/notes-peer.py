"""A web window as a peer for the iPhone Notes check.

    SESSION=<session.json> uv run --with playwright python scripts/notes-peer.py read <noteId>
    SESSION=<session.json> uv run --with playwright python scripts/notes-peer.py append <noteId> "words"

read prints the note's text as the web app shows it. append types the words at
the end, waits for the relay to take them, and prints the text again.
"""

import json
import os
import re
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:4082")
CONVEX_URL = os.environ.get("CONVEX_URL", "http://127.0.0.1:3510")
NAMESPACE = re.sub(r"[^a-zA-Z0-9]", "", CONVEX_URL)
SESSION = json.load(open(os.environ["SESSION"]))
READ = "() => { const el = document.querySelector('.note-editor .cm-content'); const view = el && el.cmTile && el.cmTile.view; return view ? view.state.doc.toString() : ''; }"

mode, note = sys.argv[1], sys.argv[2]
words = sys.argv[3] if len(sys.argv) > 3 else ""

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_context(viewport={"width": 1100, "height": 800}).new_page()
    page.goto(f"{BASE}/design")
    page.evaluate(
        "([namespace, s]) => { localStorage.setItem(`__convexAuthJWT_${namespace}`, s.accessToken); localStorage.setItem(`__convexAuthRefreshToken_${namespace}`, s.refreshToken); }",
        [NAMESPACE, SESSION],
    )
    page.goto(f"{BASE}/notes?id={note}")
    try:
        page.wait_for_selector(".note-editor .cm-content", timeout=20000)
    except Exception:
        page.screenshot(path=os.environ.get("FAIL_SHOT", "peer-fail.png"))
        raise
    page.wait_for_timeout(2500)
    if mode == "append":
        page.click(".note-editor .cm-content")
        page.keyboard.press("Control+End")
        page.keyboard.press("Meta+ArrowDown")
        page.keyboard.type(words)
        page.wait_for_timeout(2500)
    print(page.evaluate(READ))
    browser.close()
