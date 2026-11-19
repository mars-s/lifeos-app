"""Smoke test: every screen of the web app, light and dark, at 1440 and 390 px.

Visits each screen, presses the main shortcuts and opens the bars and sheets. It fails on a console error, a React warning,
a page error, a failed request, a page that scrolls sideways, or an element that pokes out past the right edge.

Needs the throwaway backend from local-backend.sh and the web app running:

    SCRATCH=/tmp/lifeos-local-backend sh scripts/local-backend.sh
    (cd $SCRATCH && CONVEX_AGENT_MODE=anonymous npx convex dev --typecheck disable) &
    WAKU_PUBLIC_CONVEX_URL=http://127.0.0.1:3210 npx waku dev --port 4061 &
    SCRATCH=/tmp/lifeos-local-backend uv run --with playwright python scripts/smoke.py <output folder>

BASE, CONVEX_URL and SCRATCH change the run. THEMES and WIDTHS (comma separated) narrow it. It reseeds the backend first.
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:4061")
CONVEX_URL = os.environ.get("CONVEX_URL", "http://127.0.0.1:3210")
SCRATCH = os.environ.get("SCRATCH", "/tmp/lifeos-local-backend")
THEMES = os.environ.get("THEMES", "light,dark").split(",")
WIDTHS = [int(width) for width in os.environ.get("WIDTHS", "1440,390").split(",")]
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
NAMESPACE = re.sub(r"[^a-zA-Z0-9]", "", CONVEX_URL)
TODAY = subprocess.check_output(["date", "+%F"], text=True).strip()
ZONE = subprocess.check_output(["node", "-e", "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)"], text=True).strip()
LISTS = ["inbox", "today", "upcoming", "anytime", "someday", "logbook", "trash"]
FEATURES = ["ai", "places", "templates", "smartBlocks"]
IGNORED = [
    re.compile(r"Download the React DevTools"),
    re.compile(r"\[vite\]"),
    re.compile(r"\[HMR\]"),
]
problems = []

OVERFLOW_JS = """
() => {
  const width = document.documentElement.clientWidth;
  const out = [];
  if (document.documentElement.scrollWidth > width + 1) out.push(`page scrolls sideways: ${document.documentElement.scrollWidth} > ${width}`);
  for (const node of document.querySelectorAll('body *')) {
    const style = getComputedStyle(node);
    if (style.visibility === 'hidden' || style.display === 'none' || style.position === 'fixed') continue;
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0 || rect.right <= width + 1) continue;
    let clipped = false;
    for (let up = node.parentElement; up && up !== document.body; up = up.parentElement) {
      const s = getComputedStyle(up);
      if (/(hidden|auto|scroll|clip)/.test(s.overflowX) && up.getBoundingClientRect().right <= width + 1) { clipped = true; break; }
      if (s.visibility === 'hidden' || s.position === 'fixed') { clipped = true; break; }
    }
    if (clipped || node.closest('[aria-hidden=true], [inert]')) continue;
    const label = node.tagName.toLowerCase() + (node.id ? '#' + node.id : '') + (node.className && typeof node.className === 'string' ? '.' + node.className.split(' ').slice(0, 3).join('.') : '');
    out.push(`pokes out ${Math.round(rect.right - width)}px: ${label} "${(node.textContent || '').trim().slice(0, 40)}"`);
    if (out.length > 5) break;
  }
  for (const node of document.querySelectorAll('h1, h2, h3, [role=heading], button, [role=radio], [role=tab]')) {
    if (node.closest('[aria-hidden=true], [inert], .sr-only') || node.scrollWidth <= node.clientWidth + 3 || node.clientWidth <= 2) continue;
    const style = getComputedStyle(node);
    if (!/(hidden|clip)/.test(style.overflowX)) continue;
    const blocky = [...node.querySelectorAll('*')].some((child) => /inline-block|inline-flex|flex|grid|block/.test(getComputedStyle(child).display) && !child.classList.contains('sr-only'));
    if (style.textOverflow === 'ellipsis' && !blocky) continue;
    out.push(`text cut by ${node.scrollWidth - node.clientWidth}px with no ellipsis: ${node.tagName.toLowerCase()} "${(node.innerText || '').trim().slice(0, 40)}"`);
  }
  return out;
}
"""


def convex(function, args="{}"):
    return subprocess.check_output(["npx", "convex", "run", function, args], cwd=SCRATCH, text=True)


def report(where, message):
    line = f"{where}: {message}"
    if line not in problems:
        problems.append(line)
        print(f"FAIL  {line}")


def settle(page, ms=700):
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(ms)


def check_layout(page, where):
    for issue in page.evaluate(OVERFLOW_JS):
        report(where, issue)


def shoot(page, name):
    page.screenshot(path=str(OUT / f"{name}.png"))


def visit(page, path, name):
    page.goto(f"{BASE}{path}")
    page.locator("#main").wait_for()
    settle(page)
    check_layout(page, name)
    shoot(page, name)


def run(playwright, theme, width):
    tag = f"{theme}-{width}"
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": width, "height": 900 if width > 600 else 844}, color_scheme=theme, device_scale_factor=2)
    page = context.new_page()
    where = {"name": tag}

    def on_console(message):
        if message.type not in ("error", "warning"):
            return
        text = message.text
        if any(pattern.search(text) for pattern in IGNORED):
            return
        report(where["name"], f"console {message.type}: {text[:300]}")

    page.on("console", on_console)
    page.on("pageerror", lambda error: report(where["name"], f"page error: {error}"))
    page.on("requestfailed", lambda request: report(where["name"], f"request failed: {request.url[:120]} {request.failure}") if "ERR_ABORTED" not in str(request.failure) else None)
    page.on("response", lambda response: report(where["name"], f"HTTP {response.status}: {response.url[:120]}") if response.status >= 400 else None)

    session = json.loads(convex("scratch:signIn"))
    page.goto(f"{BASE}/design")
    page.evaluate(
        "([namespace, s]) => { localStorage.setItem(`__convexAuthJWT_${namespace}`, s.accessToken);"
        " localStorage.setItem(`__convexAuthRefreshToken_${namespace}`, s.refreshToken); }",
        [NAMESPACE, session],
    )

    for list_kind in LISTS:
        where["name"] = f"{tag} /{list_kind}"
        visit(page, f"/{list_kind}", f"{tag}-{list_kind}")

    where["name"] = f"{tag} sidebar"
    areas = page.evaluate("() => [...new Set([...document.querySelectorAll('a[href^=\"/area?\"], a[href^=\"/project?\"]')].map((a) => a.getAttribute('href')))]")
    if width <= 600 and not areas:
        page.get_by_role("button", name=re.compile("sidebar|menu", re.I)).first.click()
        page.wait_for_timeout(400)
        check_layout(page, f"{tag} drawer")
        shoot(page, f"{tag}-drawer")
        areas = page.evaluate("() => [...new Set([...document.querySelectorAll('a[href^=\"/area?\"], a[href^=\"/project?\"]')].map((a) => a.getAttribute('href')))]")
        page.keyboard.press("Escape")
    if not areas:
        report(where["name"], "no Area or Project links in the sidebar")
    for index, href in enumerate(areas[:4]):
        kind = href.split("?")[0].strip("/")
        where["name"] = f"{tag} {href}"
        visit(page, href, f"{tag}-{kind}-{index}")

    where["name"] = f"{tag} /planner"
    visit(page, "/planner", f"{tag}-planner")
    for pane in ["Days", "Timebox"]:
        radio = page.get_by_role("radio", name=pane)
        if radio.count():
            radio.first.click()
            settle(page, 400)
            check_layout(page, f"{tag} planner {pane}")
            shoot(page, f"{tag}-planner-{pane.lower()}")
    for mode in ["Day", "Week", "3 days"]:
        radio = page.get_by_role("radio", name=mode, exact=True)
        if radio.count():
            radio.first.click()
            settle(page, 400)
            check_layout(page, f"{tag} planner timebox {mode}")
            shoot(page, f"{tag}-planner-timebox-{mode.replace(' ', '')}")
            page.locator("section[aria-label=Timebox] button[aria-label^='Next ']").first.click()
            settle(page, 400)
            check_layout(page, f"{tag} planner timebox {mode}, next")
            page.locator("section[aria-label=Timebox] header").get_by_role("button", name="Today", exact=True).click()
            settle(page, 300)

    where["name"] = f"{tag} /settings"
    visit(page, "/settings", f"{tag}-settings")
    for feature in FEATURES:
        where["name"] = f"{tag} /settings/features/{feature}"
        visit(page, f"/settings/features/{feature}", f"{tag}-feature-{feature}")

    where["name"] = f"{tag} keys"
    visit(page, "/today", f"{tag}-today-keys")
    page.locator("#main").focus()
    for key, path in [("1", "/inbox"), ("2", "/today"), ("3", "/upcoming"), ("7", "/trash"), ("8", "/planner"), ("2", "/today")]:
        page.keyboard.press(key)
        page.wait_for_timeout(400)
        got = page.evaluate("() => location.pathname")
        if got != path:
            report(where["name"], f"key {key} went to {got}, wanted {path}")

    page.keyboard.press("ControlOrMeta+k")
    bar = page.locator("[cmdk-root]")
    try:
        bar.wait_for(timeout=2000)
        check_layout(page, f"{tag} command bar")
        shoot(page, f"{tag}-command-bar")
        page.keyboard.type("anyt")
        page.keyboard.press("Enter")
        page.wait_for_timeout(500)
        if page.evaluate("() => location.pathname") != "/anytime":
            report(where["name"], "the command bar did not go to Anytime")
    except Exception as error:
        report(where["name"], f"Cmd+K did not open the command bar: {error}")
    page.keyboard.press("Escape")

    page.goto(f"{BASE}/inbox")
    settle(page)
    page.locator("#main").focus()
    page.keyboard.press("q")
    capture = page.locator("input[name=capture]")
    try:
        capture.wait_for(timeout=2000)
        check_layout(page, f"{tag} quick capture")
        shoot(page, f"{tag}-quick-capture")
        page.keyboard.type(f"Smoke capture {tag}")
        page.keyboard.press("Enter")
        page.get_by_text(f"Smoke capture {tag}").first.wait_for(timeout=3000)
        page.keyboard.press("ControlOrMeta+z")
        page.wait_for_timeout(800)
        if page.get_by_text(f"Smoke capture {tag}").count():
            report(where["name"], "undo did not take back the captured Task")
    except Exception as error:
        report(where["name"], f"Quick Capture: {error}")

    page.locator("#main").focus()
    page.keyboard.press("?")
    sheet = page.get_by_role("dialog", name="Keyboard shortcuts")
    try:
        sheet.wait_for(timeout=2000)
        check_layout(page, f"{tag} shortcut sheet")
        shoot(page, f"{tag}-shortcuts")
    except Exception:
        report(where["name"], "? did not open the shortcut sheet")
    page.keyboard.press("Escape")

    where["name"] = f"{tag} focus"
    page.goto(f"{BASE}/today")
    settle(page)
    rows = page.locator("#main [data-task-key] [data-arrow-item]")
    if rows.count():
        rows.first.click()
        page.keyboard.press("Enter")
        page.wait_for_timeout(500)
        check_layout(page, f"{tag} open card")
        shoot(page, f"{tag}-open-card")
        start = page.locator("[data-open-card] button[aria-label='Start a Focus Session']")
        if start.count():
            start.first.click()
            page.wait_for_timeout(800)
            check_layout(page, f"{tag} focus")
            shoot(page, f"{tag}-focus")
            finish = page.locator("[data-focus-pill] button[aria-label='Finish'], button[aria-label='Finish']")
            if finish.count():
                finish.first.click()
                page.wait_for_timeout(500)
            page.keyboard.press("ControlOrMeta+z")
        else:
            report(where["name"], "the open card has no Start a Focus Session button")
        page.keyboard.press("Escape")
    else:
        report(where["name"], "Today has no rows")
    browser.close()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        for theme in THEMES:
            for width in WIDTHS:
                convex("scratch:seed", json.dumps({"today": TODAY, "timeZone": ZONE}))
                run(playwright, theme, width)
    print(f"\n{len(problems)} problem(s). Screenshots in {OUT}")
    sys.exit(1 if problems else 0)


main()
