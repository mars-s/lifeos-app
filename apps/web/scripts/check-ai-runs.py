"""LifeOS AI runs you can see, end to end, in light and dark: Do it from Cmd+J starts a run, the strip and sheet show it,
a plain change ends in a receipt with Undo all, a risky one asks first, the Logbook's Runs filter lists runs to open or
undo, and telling a run something carries it on.

Needs the throwaway backend from local-backend.sh with a scripted model in place of convex/ai/models.ts (no real model is
called), OPENAI_API_KEY set to any value on that backend, and the web app running:

    SCRATCH=<scratch> CONVEX_URL=<its VITE_CONVEX_URL> BASE=http://localhost:4071 uv run --with playwright python scripts/check-ai-runs.py <output folder>

It exits non-zero on a failure.
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:4071")
CONVEX_URL = os.environ.get("CONVEX_URL", "http://127.0.0.1:3210")
SCRATCH = os.environ.get("SCRATCH", "/tmp/lifeos-local-backend")
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
NAMESPACE = re.sub(r"[^a-zA-Z0-9]", "", CONVEX_URL)
TITLE = "Pick up the parcel from the post office"
failed = []


def convex(function, args="{}"):
    return subprocess.check_output(["npx", "convex", "run", function, args], cwd=SCRATCH, text=True)


def expect(step, got, wanted):
    if got == wanted:
        print(f"ok    {step}")
    else:
        print(f"FAIL  {step}: wanted {wanted!r}, got {got!r}")
        failed.append(step)


def open_card(page):
    page.goto(f"{BASE}/today")
    page.wait_for_selector("#main [data-task-key]")
    page.wait_for_timeout(500)
    page.locator("#main [data-task-key]", has_text=TITLE).first.locator("[data-arrow-item]").first.click()
    page.keyboard.press("Enter")
    page.locator("[data-open-card]").first.get_by_role("button", name="Ask AI").wait_for()


def do_it(page, words):
    page.keyboard.press("ControlOrMeta+j")
    page.keyboard.type(words)
    page.keyboard.press("ArrowDown")
    page.keyboard.press("Enter")


def run(browser, theme):
    convex("scratch:seed")
    convex("scratch:switchAi", json.dumps({"on": True}))
    session = json.loads(convex("scratch:signIn"))
    context = browser.new_context(viewport={"width": 1280, "height": 900}, color_scheme=theme, device_scale_factor=2)
    page = context.new_page()
    page.on("pageerror", lambda error: failed.append(f"page error: {error}") or print(f"FAIL  page error: {error}"))
    page.goto(f"{BASE}/design")
    page.evaluate(
        "([namespace, s]) => { localStorage.setItem(`__convexAuthJWT_${namespace}`, s.accessToken);"
        " localStorage.setItem(`__convexAuthRefreshToken_${namespace}`, s.refreshToken); }",
        [NAMESPACE, session],
    )
    open_card(page)
    do_it(page, "add stamps")
    page.wait_for_selector("[data-run-status=done]", timeout=20000)
    sheet = page.get_by_role("dialog", name="Run")
    receipt = sheet.get_by_role("region", name="Receipt")
    receipt.wait_for(timeout=5000)
    expect(f"a plain run acts and hands over a receipt ({theme})", receipt.get_by_text("Buy stamps").count() >= 1, True)
    expect("the strip says what changed", page.locator("[data-run-status=done]").get_by_role("status").inner_text(), "Done. 1 change")
    page.screenshot(path=str(OUT / f"app-ai-run-done-{theme}.png"))
    receipt.get_by_role("button", name="Undo all").click()
    page.get_by_text("All undone").wait_for(timeout=5000)
    print("ok    Undo all takes the whole run back")
    page.get_by_role("button", name="Dismiss").click()
    page.wait_for_timeout(400)
    expect("dismissing clears the strip", page.locator("[data-run-status]").count(), 0)
    open_card(page)

    do_it(page, "bin this")
    page.wait_for_selector("[data-run-status=needsYou]", timeout=20000)
    gate = page.get_by_role("region", name="Asking first")
    gate.wait_for(timeout=5000)
    expect("a risky change asks first and nothing has changed", gate.get_by_text("Nothing has changed yet").count(), 1)
    page.screenshot(path=str(OUT / f"app-ai-run-asking-{theme}.png"))
    gate.get_by_role("button", name="Do it").click()
    page.wait_for_selector("[data-run-status=done]", timeout=20000)
    print("ok    saying yes carries the run on to done")

    sheet.get_by_role("textbox", name="Tell it something").fill("Thanks, that is all")
    sheet.get_by_role("textbox", name="Tell it something").press("Enter")
    page.wait_for_selector("[data-run-status=done]", timeout=20000)
    print("ok    telling the run something carries it on")

    page.goto(f"{BASE}/logbook")
    page.get_by_role("radio", name="Runs").or_(page.get_by_role("tab", name="Runs")).or_(page.get_by_role("button", name="Runs")).first.click()
    runs = page.get_by_role("list", name="Runs")
    runs.wait_for(timeout=5000)
    expect("the Logbook lists the runs", runs.get_by_role("listitem").count() >= 2, True)
    page.screenshot(path=str(OUT / f"app-ai-runs-logbook-{theme}.png"))
    runs.get_by_role("button", name="Undo run").first.click()
    page.wait_for_timeout(800)
    expect("a run can be undone from the Logbook", runs.get_by_text("undone").count() >= 1, True)
    context.close()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for theme in ("light", "dark"):
            run(browser, theme)
        browser.close()
    sys.exit(1 if failed else 0)


main()
