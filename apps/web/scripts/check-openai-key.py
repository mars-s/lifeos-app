"""The OpenAI key field in Settings, end to end.

Needs the throwaway backend from local-backend.sh and the web app running:

    SCRATCH=/tmp/lifeos-local-backend sh scripts/local-backend.sh
    (cd $SCRATCH && CONVEX_AGENT_MODE=anonymous npx convex dev) &
    WAKU_PUBLIC_CONVEX_URL=http://127.0.0.1:3210 npx waku dev --port 4048 &
    SCRATCH=/tmp/lifeos-local-backend uv run --with playwright python scripts/check-openai-key.py <output folder>

Saving a made-up key asks OpenAI for real, which refuses it. scratch:storeSecret stands in for a key OpenAI accepted.
BASE, CONVEX_URL and THEME (light or dark) change the run. It exits non-zero on a failure.
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:4048")
CONVEX_URL = os.environ.get("CONVEX_URL", "http://127.0.0.1:3210")
SCRATCH = os.environ.get("SCRATCH", "/tmp/lifeos-local-backend")
THEME = os.environ.get("THEME", "light")
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
NAMESPACE = re.sub(r"[^a-zA-Z0-9]", "", CONVEX_URL)
failed = []


def convex(function, args="{}"):
    return subprocess.check_output(["npx", "convex", "run", function, args], cwd=SCRATCH, text=True)


def expect(step, got, wanted):
    if got == wanted:
        print(f"ok    {step}")
    else:
        print(f"FAIL  {step}: wanted {wanted!r}, got {got!r}")
        failed.append(step)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    session = json.loads(convex("scratch:signIn"))
    convex("scratch:seed", json.dumps({}))
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1180, "height": 900}, color_scheme=THEME, device_scale_factor=2)
        page = context.new_page()
        page.on("pageerror", lambda error: failed.append(f"page error: {error}") or print(f"FAIL  page error: {error}"))
        page.goto(f"{BASE}/design")
        page.evaluate(
            "([namespace, s]) => { localStorage.setItem(`__convexAuthJWT_${namespace}`, s.accessToken);"
            " localStorage.setItem(`__convexAuthRefreshToken_${namespace}`, s.refreshToken); }",
            [NAMESPACE, session],
        )
        convex("scratch:switchAi", json.dumps({"on": True}))
        page.goto(f"{BASE}/settings/features/ai")
        field = page.get_by_label("OpenAI API key")
        field.wait_for()
        section = page.locator("section", has=page.get_by_role("heading", name="Keys")).first
        status = page.locator("#main header [role=status]")
        save = section.get_by_role("button", name="Save").first

        expect("the key field hides what is typed", field.get_attribute("type"), "password")
        expect("browsers do not autofill it", field.get_attribute("autocomplete"), "off")
        expect("the page says AI needs a key", status.inner_text().split("\n")[0], "Needs a key")
        section.screenshot(path=str(OUT / f"openai-key-empty-{THEME}.png"))
        save.click()
        expect("Save with nothing pasted asks for a key", section.get_by_role("alert").inner_text(), "Paste a key first.")

        field.fill("sk-not-a-real-key-1234")
        field.press("Enter")
        alert = section.get_by_role("alert")
        alert.wait_for(timeout=20_000)
        expect("OpenAI refuses a made-up key", alert.inner_text(), "OpenAI refused this key. Check it and paste it again.")
        expect("a refused key is not stored", section.get_by_text("Key saved").count(), 0)
        section.screenshot(path=str(OUT / f"openai-key-refused-{THEME}.png"))

        convex("scratch:storeSecret", json.dumps({"last4": "a9Qz"}))
        saved = section.get_by_text("Key saved, ends in a9Qz")
        saved.wait_for()
        expect("the saved key shows only its last four", saved.count(), 1)
        page.wait_for_timeout(400)
        expect("the status turns on once a key exists", status.inner_text().split("\n")[0], "On")
        expect("no field shows the key once saved", section.get_by_label("OpenAI API key").count(), 0)
        section.screenshot(path=str(OUT / f"openai-key-saved-{THEME}.png"))

        section.get_by_role("button", name="Replace").click()
        expect("Replace opens an empty field", section.get_by_label("OpenAI API key").input_value(), "")
        section.screenshot(path=str(OUT / f"openai-key-replace-{THEME}.png"))
        section.get_by_label("OpenAI API key").press("Escape")
        expect("Escape keeps the saved key", section.get_by_text("Key saved, ends in a9Qz").count(), 1)

        section.get_by_role("button", name="Remove").click()
        dialog = page.get_by_role("alertdialog")
        dialog.wait_for()
        page.screenshot(path=str(OUT / f"openai-key-remove-{THEME}.png"))
        dialog.get_by_role("button", name="Remove").click()
        section.get_by_label("OpenAI API key").wait_for()
        expect("removing brings the field back", section.get_by_text("Key saved").count(), 0)
        browser.close()
    sys.exit(1 if failed else 0)


main()
