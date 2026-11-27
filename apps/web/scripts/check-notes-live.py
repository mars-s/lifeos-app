"""Notes feel live: two windows on one note through a local Notes Relay.

Same setup as check-notes.py (throwaway backend on 3510, local relay on 8790,
web app on 4082). Then:

    SCRATCH=/tmp/lifeos-local-backend uv run --with playwright python scripts/check-notes-live.py [output folder]

It types in one window and times how long each word takes to show in the
other (median and worst), then checks the other window's cursor appears with
its name, moves, and goes away when that window closes. With an output folder
it saves the peer cursor in light and dark. It prints ok or FAIL per step and
exits non-zero on a failure.
"""

import json
import os
import re
import statistics
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:4082")
CONVEX_URL = os.environ.get("CONVEX_URL", "http://127.0.0.1:3510")
SCRATCH = os.environ.get("SCRATCH", "/tmp/lifeos-local-backend")
TARGET_MS = float(os.environ.get("TARGET_MS", "150"))
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else None
NAMESPACE = re.sub(r"[^a-zA-Z0-9]", "", CONVEX_URL)
EDITOR = ".note-editor .cm-content"
PEER = ".note-editor .cm-peer"
failed = []

WATCH = """() => {
  window.__seen = {};
  const el = document.querySelector('.note-editor .cm-content');
  const check = () => {
    const text = el.cmTile.view.state.doc.toString();
    for (const word of text.match(/w\\d+q/g) ?? []) window.__seen[word] ??= performance.timeOrigin + performance.now();
  };
  new MutationObserver(check).observe(el, { childList: true, subtree: true, characterData: true });
}"""

STAMP = """() => {
  window.__typed = 0;
  document.addEventListener('keydown', (event) => { if (event.key === 'q') window.__typed = performance.timeOrigin + performance.now(); }, true);
}"""


def convex(function, args="{}"):
    return subprocess.check_output(["npx", "convex", "run", function, args], cwd=SCRATCH, text=True, env={**os.environ, "CONVEX_AGENT_MODE": "anonymous"})


def expect(step, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'}  {step}{f'  ({detail})' if detail and not ok else ''}")
    if not ok:
        failed.append(step)


def signed_in(browser, scheme="light"):
    context = browser.new_context(viewport={"width": 1440, "height": 900}, color_scheme=scheme, device_scale_factor=2)
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
        page.wait_for_timeout(50)
        waited += 50
    return check()


def editor_clip(page):
    box = page.locator(EDITOR).bounding_box()
    return {"x": box["x"], "y": box["y"], "width": box["width"], "height": 180}


def peer_box(page):
    return page.evaluate(f"() => {{ const el = document.querySelector('{PEER}'); if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)]; }}")


def main():
    title = f"Live check {int(time.time())}"
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        a_context, a = signed_in(browser)
        a.goto(f"{BASE}/notes")
        a.get_by_role("button", name="New note").first.click()
        a.wait_for_selector(EDITOR)
        a.wait_for_timeout(400)
        a.keyboard.type(f"{title}\nTyped in the first window. ", delay=8)
        doc_id = a.evaluate("new URLSearchParams(location.search).get('id')")

        b_context, b = signed_in(browser)
        b.goto(f"{BASE}/notes?id={doc_id}")
        b.wait_for_selector(EDITOR)
        expect("the second window opens the note", wait_for(b, lambda: "Typed in the first window." in text_of(b)), text_of(b))
        b.evaluate(WATCH)
        a.evaluate(STAMP)
        a.wait_for_timeout(1500)

        delays = []
        for index in range(20):
            word = f"w{index}q"
            a.keyboard.type(f"{word} ", delay=40)
            typed = a.evaluate("() => window.__typed")
            arrived = wait_for(b, lambda: b.evaluate(f"() => window.__seen['{word}'] ?? null") is not None, 3000)
            seen = b.evaluate(f"() => window.__seen['{word}'] ?? null")
            if arrived and seen:
                delays.append(seen - typed + 0.0)
            a.wait_for_timeout(120)
        if delays:
            median = statistics.median(delays)
            print(f"      delay before a word shows in the other window: median {median:.0f} ms, worst {max(delays):.0f} ms over {len(delays)} words")
            expect(f"text shows in the other window within {TARGET_MS:.0f} ms", median < TARGET_MS, f"median {median:.0f} ms")
        else:
            expect("text shows in the other window", False, "no word arrived")

        expect("the other window's cursor shows", wait_for(b, lambda: peer_box(b) is not None, 3000))
        expect(
            "the cursor carries its device name",
            b.evaluate(f"() => document.querySelector('{PEER} .cm-peer-name')?.textContent ?? ''") in ("Web", "Mac"),
        )
        before = peer_box(b)
        a.keyboard.press("Meta+ArrowUp")
        expect("the cursor moves with the other window", wait_for(b, lambda: peer_box(b) not in (None, before), 3000), f"{before} then {peer_box(b)}")
        a.keyboard.press("Shift+ArrowDown")
        expect("a selection shows as a soft tint", wait_for(b, lambda: b.locator(".note-editor .cm-peer-selection").count() > 0, 3000))
        b.wait_for_timeout(2500)
        expect(
            "the name tag fades after a moment without movement",
            b.evaluate(f"() => document.querySelector('{PEER}')?.dataset.active ?? ''") == "false",
        )
        a.keyboard.press("Shift+ArrowRight")
        if OUT:
            OUT.mkdir(parents=True, exist_ok=True)
            CLIP = editor_clip(b)
            b.wait_for_timeout(150)
            b.screenshot(path=str(OUT / "peer-light.png"), clip=CLIP)
            b.emulate_media(color_scheme="dark")
            b.wait_for_timeout(300)
            b.screenshot(path=str(OUT / "peer-dark.png"), clip=CLIP)
            b.emulate_media(color_scheme="light")

        a_context.close()
        expect("the cursor goes away when the other window closes", wait_for(b, lambda: peer_box(b) is None, 3000))
        b_context.close()
        browser.close()
    print("all ok" if not failed else f"{len(failed)} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
