"""LifeOS AI memory, end to end, in light and dark: a Cmd+J answer remembers with Undo, and Settings, AI lists the memory
to rewrite, pin, forget (with Undo) or forget everything, with the index beside it.

Needs the throwaway backend from local-backend.sh with a scripted model in place of convex/ai/models.ts (no real model is
called), OPENAI_API_KEY set to any value on that backend, and the web app running:

    SCRATCH=<scratch> CONVEX_URL=<its VITE_CONVEX_URL> BASE=http://localhost:4071 uv run --with playwright python scripts/check-ai-memory.py <output folder>

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
MEMORY = "Prefers deep work before 11"
failed = []


def convex(function, args="{}"):
    return subprocess.check_output(["npx", "convex", "run", function, args], cwd=SCRATCH, text=True)


def expect(step, got, wanted):
    if got == wanted:
        print(f"ok    {step}")
    else:
        print(f"FAIL  {step}: wanted {wanted!r}, got {got!r}")
        failed.append(step)


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
    page.goto(f"{BASE}/today")
    page.wait_for_selector("#main [data-task-key]")
    page.wait_for_timeout(500)
    page.locator("#main [data-task-key]", has_text=TITLE).first.locator("[data-arrow-item]").first.click()
    page.keyboard.press("Enter")
    page.locator("[data-open-card]").first.get_by_role("button", name="Ask AI").wait_for()
    page.keyboard.press("ControlOrMeta+j")
    page.keyboard.type("I do deep work before 11")
    page.keyboard.press("Enter")
    page.wait_for_selector("[data-ask-phase=proposed]", timeout=15000)
    box = page.get_by_role("dialog", name="LifeOS AI")
    expect(f"the answer shows what it remembered ({theme})", box.get_by_text(MEMORY).count(), 1)
    page.screenshot(path=str(OUT / f"app-ai-remembered-{theme}.png"), clip=box.bounding_box())
    page.keyboard.press("Escape")

    page.goto(f"{BASE}/settings/features/ai")
    memories = page.get_by_role("list", name="Memories")
    memories.wait_for()
    expect("Settings lists the memory", memories.get_by_role("listitem").count(), 1)
    memories.get_by_role("button", name=re.compile("^Pin")).click()
    page.wait_for_timeout(400)
    expect("pinning answers at once", memories.get_by_role("button", name="Unpin").count(), 1)
    memories.get_by_role("button", name=MEMORY).click()
    field = page.get_by_role("textbox", name="Rewrite this memory")
    field.fill("Prefers deep work before 10")
    field.press("Enter")
    page.wait_for_timeout(500)
    expect("a memory can be rewritten in place", memories.get_by_role("button", name="Prefers deep work before 10").count(), 1)
    section = page.locator("section", has=page.get_by_role("heading", name="Memory", exact=True))
    section.scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    section.screenshot(path=str(OUT / f"app-ai-memory-{theme}.png"))
    memories.get_by_role("button", name="Forget").click()
    page.wait_for_timeout(500)
    expect("Forget removes it", memories.count(), 0)
    page.get_by_role("button", name="Undo").first.click()
    page.wait_for_timeout(900)
    expect("and Undo puts the words back", page.get_by_role("list", name="Memories").get_by_role("listitem").count(), 1)
    page.get_by_role("button", name="Forget everything").click()
    page.get_by_role("button", name="Forget everything").last.click()
    page.wait_for_timeout(700)
    expect("Forget everything empties the list", page.get_by_text("Nothing yet.").count(), 1)
    expect("the index lists Tasks, Projects, Areas and Memories", page.get_by_role("list", name="Index").get_by_role("listitem").count(), 4)
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
