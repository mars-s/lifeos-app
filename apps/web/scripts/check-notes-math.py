"""Notes maths: KaTeX in the live preview, in light and dark.

Same setup as check-notes.py (throwaway backend, a local relay, the web app). Then:

    SCRATCH=/tmp/lifeos-local-backend uv run --with playwright python scripts/check-notes-math.py <output folder>

It types inline and block maths into a new note and checks that KaTeX loads
only once the note has maths, that maths renders while the caret is elsewhere
and shows its source when the caret is inside it, that money is not maths,
that a bad expression shows its source with KaTeX's message on hover, that
long block maths scrolls inside its line and not the page, and that maths
takes the note's text colour in light and dark. It prints ok or FAIL per step,
saves screenshots, and exits non-zero on a failure.
"""

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:4082")
CONVEX_URL = os.environ.get("CONVEX_URL", "http://127.0.0.1:3510")
SCRATCH = os.environ.get("SCRATCH", "/tmp/lifeos-local-backend")
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
NAMESPACE = re.sub(r"[^a-zA-Z0-9]", "", CONVEX_URL)
EDITOR = ".note-editor .cm-content"
LONG = " + ".join(f"a_{{{n}}} x^{{{n}}}" for n in range(1, 41))
BODY = [
    "Energy is $E = mc^2$ and lunch was $5 and $10, see \\$HOME.",
    "$$",
    "\\int_0^1 x^2 \\, dx = \\frac{1}{3}",
    "$$",
    "Broken $\\frac{1}{$ here, and inline display $$\\sqrt{2}$$ too.",
    "$$",
    f"f(x) = {LONG}",
    "$$",
    "The end.",
]
failed = []


def convex(function, args="{}"):
    return subprocess.check_output(["npx", "convex", "run", function, args], cwd=SCRATCH, text=True, env={**os.environ, "CONVEX_AGENT_MODE": "anonymous"})


def expect(step, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'}  {step}{f'  ({detail})' if detail and not ok else ''}")
    if not ok:
        failed.append(step)


def signed_in(browser, theme="light", width=1440, height=900):
    context = browser.new_context(viewport={"width": width, "height": height}, color_scheme=theme, device_scale_factor=2)
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


def head_of(page):
    return page.evaluate("() => document.querySelector('.note-editor .cm-content').cmTile.view.state.selection.main.head")


def wait_for(page, check, timeout=8000):
    waited = 0
    while waited < timeout:
        if check():
            return True
        page.wait_for_timeout(100)
        waited += 100
    return check()


KATEX = re.compile(r"/katex[^/]*\.(m?js|css|ts)|KaTeX_")
fetched = []


def caret_to_end(page):
    page.evaluate(
        "() => { const view = document.querySelector('.note-editor .cm-content').cmTile.view;"
        " view.focus(); view.dispatch({ selection: { anchor: view.state.doc.length } }); }"
    )
    page.wait_for_timeout(150)


def fits(page):
    return page.evaluate(
        "() => document.querySelector('.note-editor .cm-content').getBoundingClientRect().width"
        " <= document.querySelector('.note-editor .cm-scroller').clientWidth + 1"
    )


def colours(page):
    return page.evaluate(
        "() => [getComputedStyle(document.querySelector('.note-editor .cm-editor')).color,"
        " getComputedStyle(document.querySelector('.note-editor .cm-math .katex')).color]"
    )


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    title = f"Maths check {int(time.time())}"
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context, page = signed_in(browser)
        page.on("request", lambda request: fetched.append(request.url) if KATEX.search(request.url) else None)
        page.goto(f"{BASE}/notes")
        page.get_by_role("button", name="New note").first.click()
        page.wait_for_selector(EDITOR)
        page.wait_for_timeout(400)
        page.keyboard.type(f"{title}\nNo maths yet, it costs $5.\n", delay=4)
        page.wait_for_timeout(600)
        expect("a note without maths loads no KaTeX", len(fetched) == 0 and page.locator(".katex").count() == 0, str(len(fetched)))
        doc_id = page.evaluate("new URLSearchParams(location.search).get('id')")

        page.keyboard.type("\n".join(BODY), delay=2)
        caret_to_end(page)
        rendered = page.locator(".cm-math .katex")
        expect("KaTeX loads once the note has maths", wait_for(page, lambda: len(fetched) > 0 and rendered.count() >= 4), str(len(fetched)))
        expect("inline, inline display and both blocks render off the caret", rendered.count() == 4 and page.locator(".cm-math-block").count() == 2, str(rendered.count()))
        expect("the bundled KaTeX fonts load", page.evaluate("async () => { await document.fonts.ready; return document.fonts.check('16px KaTeX_Main'); }"))
        expect("money and an escaped dollar stay text", page.locator(".cm-line", has_text="lunch was $5 and $10, see \\$HOME.").count() == 1)

        error = page.locator(".cm-math .katex-error")
        expect("a bad expression shows its source", error.count() == 1 and "\\frac{1}{" in error.first.inner_text(), str(error.count()))
        expect("its KaTeX message is on hover", "ParseError" in (error.first.get_attribute("title") or ""), error.first.get_attribute("title") or "")

        block = page.locator(".cm-math-block").nth(1)
        sideways = block.evaluate("(el) => [el.scrollWidth, el.clientWidth]")
        expect("long block maths scrolls inside its line", sideways[0] > sideways[1], str(sideways))
        expect("the page does not scroll sideways", not page.evaluate("document.documentElement.scrollWidth > window.innerWidth"))
        expect("the note column keeps its width", fits(page))
        page.locator(".cm-content").screenshot(path=str(OUT / "math-rendered-light.png"))

        page.locator(".cm-math:not(.cm-math-display) .katex-html").first.click()
        page.wait_for_timeout(150)
        text = text_of(page)
        inline_from = text.index("$E = mc^2$")
        expect("clicking inline maths puts the caret in its source", inline_from < head_of(page) < inline_from + len("$E = mc^2$"), str(head_of(page)))
        expect("the inline source shows on the caret", page.locator(".cm-math-source", has_text="E = mc^2").count() == 1)
        expect("the blocks still render", page.locator(".cm-math-block").count() == 2)
        page.locator(".cm-content").screenshot(path=str(OUT / "math-inline-source-light.png"))

        page.locator(".cm-math-block .katex-html").first.click()
        page.wait_for_timeout(150)
        block_from = text_of(page).index("$$\n\\int")
        expect("clicking block maths puts the caret in its source", block_from < head_of(page) < block_from + 40, str(head_of(page)))
        expect("the block source shows on the caret", page.locator(".cm-math-source", has_text="\\int_0^1").count() == 1)
        expect("its rendered preview sits under the source", page.locator(".cm-math-block.is-preview").count() == 1)
        expect("the inline maths renders again", page.locator(".cm-math:not(.cm-math-display) .katex").count() == 1)
        page.locator(".cm-content").screenshot(path=str(OUT / "math-block-source-light.png"))

        page.keyboard.press("ArrowDown")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("ArrowDown")
        page.wait_for_timeout(150)
        expect("arrowing out of the block renders it again", page.locator(".cm-math-block.is-preview").count() == 0 and page.locator(".cm-math-block").count() >= 1)

        light = colours(page)
        expect("maths takes the note's text colour in light", light[0] == light[1], str(light))
        context.close()

        for theme in ("dark", "light"):
            for width, height, name in ((1440, 900, "desktop"), (390, 844, "phone")):
                ctx, shot = signed_in(browser, theme, width, height)
                shot.goto(f"{BASE}/notes?id={doc_id}")
                shot.wait_for_selector(EDITOR)
                expect(f"the note syncs with its maths ({theme}, {name})", wait_for(shot, lambda: "The end." in text_of(shot), 10000))
                caret_to_end(shot)
                expect(f"maths renders on open ({theme}, {name})", wait_for(shot, lambda: shot.locator(".cm-math .katex").count() == 4))
                tones = colours(shot)
                expect(f"maths takes the note's text colour ({theme}, {name})", tones[0] == tones[1], str(tones))
                expect(f"no sideways page scroll ({theme}, {name})", not shot.evaluate("document.documentElement.scrollWidth > window.innerWidth"))
                expect(f"the note column keeps its width ({theme}, {name})", fits(shot))
                shot.wait_for_timeout(300)
                shot.screenshot(path=str(OUT / f"math-{name}-{theme}.png"))
                ctx.close()
        browser.close()
    print("all ok" if not failed else f"{len(failed)} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
