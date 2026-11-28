"""The open Task card is balanced at every width (#85).

Seeds the Task from Avi's screenshot (long notes with a raw link, a Work Block that has passed, a Trip,
one best-guess Estimate), opens it in the narrow Planner column, the wide Today list and at iPhone width,
in light and dark, and checks the layout: the glyphs of the fact rows sit in one column under the checkbox,
their text starts on the title's edge, the left and right insets match, nothing overflows the card, the
tool row spans the card when it is narrow and sits on the When line when it is wide, a passed Work Block
reads as passed, and the only brand blue left is the Today star. It also opens a second, fuller Task
(Checklist, Labels, Deadline) so its screenshot can be looked at.

Needs the throwaway backend from local-backend.sh and the web app running:

    SCRATCH=/tmp/lifeos-local-backend sh scripts/local-backend.sh
    (cd $SCRATCH && CONVEX_AGENT_MODE=anonymous npx convex dev --typecheck disable) &
    WAKU_PUBLIC_CONVEX_URL=http://127.0.0.1:3210 npx waku dev --port 4061 &
    SCRATCH=/tmp/lifeos-local-backend uv run --with playwright python scripts/check-card.py <output folder>

BASE and CONVEX_URL change the run, and SHOTS_ONLY=1 takes the screenshots without the checks. Each browser context signs in afresh. Exits non-zero on a failure.
"""

import json
import os
import re
import subprocess
import sys
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
SHOTS_ONLY = os.environ.get("SHOTS_ONLY") == "1"
TITLE = "Get moleskine notebooks from officeworks"
NOTES = (
    "Moleskine Cahier Ruled Notebook Large Black 3 Pack\n$20.00 at Officeworks\n"
    "https://www.officeworks.com.au/shop/officeworks/p/moleskine-cahier-ruled-notebook-large-black-3-pack-msqp316\n\n"
    "These are the thin cardboard Cahier journals sold as a 3-pack."
)
OTHER = os.environ.get("OTHER", "Reply to Harry about the October invoice")
SURFACES = [("planner", "/planner", 1440), ("list", "/today", 1440), ("phone", "/today", 390)]
failed = []

MEASURE = """(card) => {
  const box = (node) => node?.getBoundingClientRect();
  const outer = box(card.querySelector('.group\\\\/row'));
  const title = box(card.querySelector('textarea[name=title]'));
  const check = box(card.querySelector('[role=checkbox], button[aria-label^="Complete"]'));
  const rails = [...card.querySelectorAll('[data-fact-glyph]')].map((node) => Math.round(box(node).left + box(node).width / 2 - outer.left));
  const texts = [...card.querySelectorAll('[data-fact-text]')].map((node) => Math.round(box(node).left - outer.left));
  const tools = box(card.querySelector('[data-card-tools]'));
  const when = box(card.querySelector('[data-card-when] button'));
  const spill = [...card.querySelectorAll('*')].filter((node) => {
    const rect = box(node);
    return rect.width > 0 && (rect.right > outer.right + 0.5 || rect.left < outer.left - 0.5) && !node.closest('.maplibregl-map, svg');
  }).map((node) => node.tagName + '.' + (node.getAttribute('class') ?? '').slice(0, 50));
  const blue = [...card.querySelectorAll('*')].filter((node) => {
    const style = getComputedStyle(node);
    const brand = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim();
    const probe = Object.assign(document.createElement('i'), { style: `color: ${brand}` });
    document.body.append(probe);
    const tone = getComputedStyle(probe).color;
    probe.remove();
    return node.getClientRects().length > 0 && style.opacity !== '0' && [style.color, style.backgroundColor, style.borderTopColor, style.fill].includes(tone)
      && (node.childElementCount === 0 || style.backgroundColor === tone);
  }).map((node) => node.closest('[data-card-when]') ? 'when' : (node.tagName + '.' + (node.getAttribute('class') ?? '').slice(0, 40)));
  return {
    width: Math.round(outer.width),
    check: Math.round(check.left + check.width / 2 - outer.left),
    title: Math.round(title.left - outer.left),
    rails, texts, spill, blue: [...new Set(blue)],
    toolsLeft: Math.round(tools.left - outer.left), toolsRight: Math.round(outer.right - tools.right),
    toolsBelowWhen: tools.top >= when.bottom - 1,
    passed: card.querySelector('[data-passed]')?.textContent ?? null,
    linkLines: Math.round((box(card.querySelector('p[aria-label=Notes] a'))?.height ?? 0) / 20),
    linkHttp: (card.querySelector('p[aria-label=Notes] a')?.textContent ?? 'http').startsWith('http'),
  };
}"""


def convex(*args):
    return subprocess.check_output(["npx", "convex", *args], cwd=SCRATCH, env=ENV, text=True)


def expect(step, got, wanted):
    ok = wanted(got) if callable(wanted) else got == wanted
    print(("ok   " if ok else "FAIL ") + step + ("" if ok else f": got {got!r}"))
    if not ok:
        failed.append(step)


def seed():
    convex("run", "scratch:seed", json.dumps({"today": date.today().isoformat(), "timeZone": ZONE}))
    convex("run", "scratch:storeSecret", json.dumps({"last4": "test"}))
    convex("run", "scratch:seedPlaces", json.dumps({"title": TITLE}))
    convex("run", "scratch:suggestEstimate", json.dumps({"title": TITLE, "guesses": [{"minutes": 40, "probability": 0.72}], "reason": "A short drive and one shop."}))
    convex("run", "scratch:fillCard", json.dumps({"title": TITLE, "notes": NOTES, "plannedDaysAgo": 4}))


def open_card(page, title):
    row = page.locator("#main li[data-task-key]", has_text=re.compile(re.escape(title))).first
    row.scroll_into_view_if_needed()
    row.locator("[data-arrow-item]").first.click()
    page.keyboard.press("Enter")
    card = page.locator("#main li[data-open-card]")
    card.wait_for()
    page.wait_for_timeout(1600)
    return card


def shoot(page, card, name):
    card.scroll_into_view_if_needed()
    page.wait_for_timeout(200)
    box = card.bounding_box()
    view = page.viewport_size
    pad = 20
    clip = {
        "x": max(0, box["x"] - pad),
        "y": max(0, box["y"] - pad),
        "width": min(view["width"] - max(0, box["x"] - pad), box["width"] + 2 * pad),
        "height": min(view["height"] - max(0, box["y"] - pad), box["height"] + 2 * pad),
    }
    page.screenshot(path=str(OUT / f"{name}.png"), clip=clip)


def check(page, surface, theme):
    name = f"card-{surface}-{theme}"
    card = open_card(page, TITLE)
    shoot(page, card, name)
    if SHOTS_ONLY:
        return page.keyboard.press("Escape")
    measured = card.evaluate(MEASURE)
    print(f"     {name}: {json.dumps(measured)}")
    narrow = measured["width"] < 448
    expect(f"{name}: fact glyphs sit under the checkbox", measured["rails"], lambda rails: len(rails) >= 3 and all(abs(x - measured["check"]) <= 1 for x in rails))
    expect(f"{name}: fact text starts on the title's edge", measured["texts"], lambda texts: len(texts) >= 3 and all(abs(x - measured["title"]) <= 1 for x in texts))
    expect(f"{name}: nothing spills out of the card", measured["spill"], [])
    expect(f"{name}: the only brand blue is the Today star", measured["blue"], lambda blue: set(blue) <= {"when"})
    expect(f"{name}: the passed Work Block says so", measured["passed"], lambda text: text is not None and text.startswith("Was "))
    expect(f"{name}: the link is one line without its scheme", (measured["linkLines"], measured["linkHttp"]), (1, False))
    if narrow:
        expect(f"{name}: the tool row spans the card evenly", abs(measured["toolsLeft"] - measured["toolsRight"]) <= 1 and measured["toolsBelowWhen"], True)
    else:
        expect(f"{name}: the tools sit on the When line, at the right edge", (measured["toolsBelowWhen"], measured["toolsRight"] <= 14), (False, True))
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    other = page.locator("#main li[data-task-key]", has_text=re.compile(OTHER)).first
    other.locator("[data-arrow-item]").first.click()
    page.keyboard.press("Enter")
    full = page.locator("#main li[data-open-card]")
    full.wait_for()
    page.wait_for_timeout(700)
    shoot(page, full, f"card-other-{surface}-{theme}")
    page.keyboard.press("Tab")
    expect(f"{name}: Tab stays inside the card", full.evaluate("(card) => card.contains(document.activeElement)"), True)
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    expect(f"{name}: Escape closes the card", page.locator("#main li[data-open-card]").count(), 0)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    seed()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        for surface, path, width in SURFACES:
            for theme in ("light", "dark"):
                session = json.loads(convex("run", "scratch:signIn"))
                context = browser.new_context(viewport={"width": width, "height": 1400 if width > 400 else 1500}, color_scheme=theme, device_scale_factor=2)
                page = context.new_page()
                page.goto(f"{BASE}/design")
                page.evaluate(
                    "([namespace, s]) => { localStorage.setItem(`__convexAuthJWT_${namespace}`, s.accessToken);"
                    " localStorage.setItem(`__convexAuthRefreshToken_${namespace}`, s.refreshToken); }",
                    [NAMESPACE, session],
                )
                page.goto(f"{BASE}{path}")
                page.wait_for_selector("#main li[data-task-key]")
                page.wait_for_timeout(900)
                check(page, surface, theme)
                context.close()
        browser.close()
    print("FAILED: " + ", ".join(failed) if failed else "All card checks passed.")
    sys.exit(1 if failed else 0)


main()
