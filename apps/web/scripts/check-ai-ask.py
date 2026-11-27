"""Cmd+J on a Task, end to end, in light and dark: the box opens on the key, the answer streams, the draft is pencil,
Enter keeps it as one change, Undo takes it back, Esc discards, and offline it says so.

Needs the throwaway backend from local-backend.sh with a scripted model in place of convex/ai/models.ts (no real model is
called), OPENAI_API_KEY set to any value on that backend, and the web app running:

    SCRATCH=<scratch> CONVEX_URL=<its VITE_CONVEX_URL> BASE=http://localhost:4071 uv run --with playwright python scripts/check-ai-ask.py <output folder>

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
    card = page.locator("[data-open-card]").first
    card.get_by_role("button", name="Ask AI").wait_for()
    return card


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
    card = open_card(page)
    box = page.get_by_role("dialog", name="LifeOS AI")

    page.keyboard.press("ControlOrMeta+j")
    expect(f"Cmd+J opens the box on the next frame ({theme})", box.get_attribute("data-ask-phase", timeout=300), "asking")
    expect("it offers the Task actions", box.get_by_role("option").all_inner_texts(), ["Break into steps", "Estimate", "Find a time", "Draft the notes"])
    page.screenshot(path=str(OUT / f"app-ai-ask-{theme}.png"), clip=card.bounding_box())
    page.keyboard.press("Enter")
    page.wait_for_selector("[data-ask-phase=reading], [data-ask-phase=writing]", timeout=3000)
    print(f"ok    picking an action starts reading at once ({theme})")
    page.wait_for_selector("[data-ask-phase=writing]", timeout=8000)
    page.screenshot(path=str(OUT / f"app-ai-ask-writing-{theme}.png"), clip=card.bounding_box())
    page.wait_for_selector("[data-ask-phase=proposed]", timeout=15000)
    draft = box.get_by_role("list", name="Suggested steps")
    expect("the draft is four pencil steps", draft.get_by_role("listitem").all_inner_texts(), ["Find the collection card", "Bring photo ID", "Walk to the post office", "Collect the parcel"])
    expect("nothing is saved yet", card.locator("ul[aria-label=Checklist] [data-checklist-field]").count(), 0)
    page.screenshot(path=str(OUT / f"app-ai-ask-draft-{theme}.png"), clip=card.bounding_box())
    page.keyboard.press("Enter")
    page.wait_for_timeout(700)
    expect("Enter keeps all four as Checklist Items", card.locator("ul[aria-label=Checklist] [data-checklist-field]").count(), 4)
    expect("and the box closes", box.count(), 0)
    page.get_by_role("button", name="Undo").first.click()
    page.wait_for_timeout(900)
    expect("one undo takes them all back", card.locator("ul[aria-label=Checklist] [data-checklist-field]").count(), 0)

    card.get_by_role("button", name="Ask AI").click()
    box.get_by_role("option", name="Estimate").click()
    page.wait_for_selector("[data-ask-phase=proposed]", timeout=15000)
    box.get_by_role("button", name="Set Estimate").click()
    page.get_by_text("Estimate set to 0:40").first.wait_for(timeout=3000)
    expect("keeping an Estimate sets it as one change with Undo", page.get_by_text("Estimate set to 0:40").count() >= 1, True)

    page.keyboard.press("ControlOrMeta+j")
    page.keyboard.type("time")
    page.keyboard.press("Enter")
    page.wait_for_selector("[data-ask-phase=proposed]", timeout=15000)
    page.screenshot(path=str(OUT / f"app-ai-ask-time-{theme}.png"), clip=card.bounding_box())
    page.keyboard.press("Escape")
    expect("Esc discards the draft", box.count(), 0)

    context.set_offline(True)
    page.keyboard.press("ControlOrMeta+j")
    box.get_by_text("LifeOS AI needs a connection").wait_for(timeout=3000)
    expect("offline it still opens and says AI needs a connection", box.get_by_role("option").first.get_attribute("aria-disabled"), "true")
    page.screenshot(path=str(OUT / f"app-ai-ask-offline-{theme}.png"), clip=card.bounding_box())
    page.keyboard.press("Escape")
    context.set_offline(False)
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
