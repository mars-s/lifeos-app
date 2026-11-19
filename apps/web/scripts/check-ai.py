"""The AI Feature, Break into steps, the Smart Estimate tooltip and the Templates switch, end to end.

Needs the throwaway backend from local-backend.sh and the web app running:

    SCRATCH=/tmp/lifeos-local-backend sh scripts/local-backend.sh
    (cd $SCRATCH && CONVEX_AGENT_MODE=anonymous npx convex dev --typecheck disable) &
    WAKU_PUBLIC_CONVEX_URL=<its VITE_CONVEX_URL> npx waku dev --port 4061 &
    SCRATCH=/tmp/lifeos-local-backend CONVEX_URL=<its VITE_CONVEX_URL> uv run --with playwright python scripts/check-ai.py <output folder>

No model is called: scratch:storeSecret stores placeholder keys and scratch:suggestSteps and
scratch:suggestEstimate store answers the way the backend would. THEME (light or dark) changes the run.
It exits non-zero on a failure.
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
THEME = os.environ.get("THEME", "light")
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
NAMESPACE = re.sub(r"[^a-zA-Z0-9]", "", CONVEX_URL)
TITLE = "Pick up the parcel from the post office"
STEPS = ["Find the collection card", "Bring photo ID", "Walk to the post office", "Collect the parcel"]
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
    convex("scratch:storeSecret", json.dumps({"last4": "sk42", "name": "openai"}))
    convex("scratch:storeSecret", json.dumps({"last4": "go17", "name": "opencodeGo"}))
    convex("scratch:switchAi", json.dumps({"on": True}))
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 860}, color_scheme=THEME, device_scale_factor=2)
        page = context.new_page()
        page.on("pageerror", lambda error: failed.append(f"page error: {error}") or print(f"FAIL  page error: {error}"))
        page.goto(f"{BASE}/design")
        page.evaluate(
            "([namespace, s]) => { localStorage.setItem(`__convexAuthJWT_${namespace}`, s.accessToken);"
            " localStorage.setItem(`__convexAuthRefreshToken_${namespace}`, s.refreshToken); }",
            [NAMESPACE, session],
        )

        page.goto(f"{BASE}/settings")
        features = page.locator("section", has=page.get_by_role("heading", name="Features"))
        features.get_by_role("link", name="AI").wait_for()
        expect("Settings lists AI, Places and Templates as Features", features.get_by_role("link").all_inner_texts(), ["AI", "Places", "Templates"])
        expect("the old Templates section is gone", page.get_by_role("heading", name="Templates", exact=True).count(), 0)

        features.get_by_role("link", name="AI").click()
        page.wait_for_url("**/settings/features/ai")
        keys = page.locator("section", has=page.get_by_role("heading", name="Keys"))
        keys.get_by_text("go17").wait_for()
        expect("both keys show only their last four", [keys.get_by_text("sk42").count(), keys.get_by_text("go17").count()], [1, 1])
        expect("the page says what OpenCode expects", keys.get_by_text("OpenCode built Go for coding agents").count(), 1)
        jobs = page.locator("section", has=page.get_by_role("heading", name="What AI does"))
        pickers = jobs.get_by_role("button", name=re.compile("^Model for"))
        pickers.first.wait_for()
        expect(
            "each job that is on shows the model that answers it, and Trip detection waits for Places",
            [b.get_attribute("aria-label") for b in pickers.all()],
            [
                "Model for Smart Estimates: GPT-6 Luna, Decisions API on OpenAI",
                "Model for Break into steps: DeepSeek V4.1 Flash on OpenCode Go",
            ],
        )
        expect("a cost line sits under each model", jobs.get_by_text("About US$0.09 per 1,000 Tasks.").count() >= 1, True)
        page.set_viewport_size({"width": 1280, "height": 1500})
        page.wait_for_timeout(300)
        page.screenshot(path=str(OUT / f"app-settings-ai-{THEME}.png"))
        page.set_viewport_size({"width": 1280, "height": 860})

        pickers.first.click()
        menu = page.get_by_role("menu")
        menu.wait_for()
        expect("the picker offers only models that can answer, grouped by provider", menu.get_by_role("group").count() >= 2, True)
        menu.get_by_role("menuitem", name="GLM-5.3 Flash").click()
        page.wait_for_timeout(300)
        expect("picking a model answers at once", pickers.first.get_attribute("aria-label"), "Model for Smart Estimates: GLM-5.3 Flash on OpenCode Go")
        page.get_by_text("Model changed").first.wait_for()
        page.get_by_role("button", name="Undo").first.click()
        page.wait_for_timeout(500)
        expect("and undoes", pickers.first.get_attribute("aria-label"), "Model for Smart Estimates: GPT-6 Luna, Decisions API on OpenAI")

        steps_switch = jobs.get_by_role("switch", name="Break into steps")
        steps_switch.click()
        page.wait_for_timeout(300)
        expect("a job can be switched off on its own", steps_switch.get_attribute("aria-checked"), "false")
        steps_switch.click()
        page.wait_for_timeout(300)

        page.goto(f"{BASE}/today")
        page.wait_for_selector("#main [data-task-key]")
        page.wait_for_timeout(600)
        row = page.locator("#main [data-task-key]", has_text=TITLE).first
        row.locator("[data-arrow-item]").first.click()
        page.keyboard.press("Enter")
        card = page.locator("[data-open-card]").first
        card.get_by_role("button", name="Break into steps").first.wait_for()

        convex("scratch:suggestSteps", json.dumps({"title": TITLE, "steps": STEPS}))
        preview = card.get_by_role("region", name="Suggested steps")
        preview.wait_for()
        page.wait_for_timeout(500)
        expect("the preview lists every suggested step", preview.locator("[data-checklist-field][name=checklist-item-title]").evaluate_all("els => els.map(e => e.value)"), STEPS)
        expect("it says which model answered", preview.get_by_text("DeepSeek V4.1 Flash").count(), 1)
        box = card.bounding_box()
        page.screenshot(path=str(OUT / f"app-ai-steps-{THEME}.png"), clip={**box, "y": box["y"] - 8, "height": box["height"] + 16})

        first = preview.locator("[data-checklist-field][name=checklist-item-title]").first
        first.fill("Find the yellow collection card")
        first.press("Tab")
        preview.get_by_role("button", name="Delete Bring photo ID").click()
        page.wait_for_timeout(300)
        preview.get_by_role("button", name="Add 3 steps").click()
        page.wait_for_timeout(600)
        checklist = card.locator("ul[aria-label=Checklist]").first
        expect(
            "accepting adds the edited steps to the Checklist",
            checklist.locator("[data-checklist-field]").evaluate_all("els => els.map(e => e.value)"),
            ["Find the yellow collection card", "Walk to the post office", "Collect the parcel"],
        )
        expect("and the preview closes", preview.count(), 0)
        page.get_by_role("button", name="Undo").first.click()
        page.wait_for_timeout(800)
        expect("one undo takes every step back out", card.locator("ul[aria-label=Checklist] [data-checklist-field]").count(), 0)

        convex(
            "scratch:suggestEstimate",
            json.dumps({"title": TITLE, "guesses": [{"minutes": 5100, "probability": 0.79}, {"minutes": 2550, "probability": 0.15}], "reason": "From the title and notes."}),
        )
        page.evaluate("window.scrollTo(0, 0)")
        best = card.get_by_role("button", name=re.compile("the best guess"))
        best.wait_for()
        best.scroll_into_view_if_needed()
        best.hover()
        tooltip = page.get_by_role("tooltip").filter(has_text="Working Hours")
        tooltip.wait_for(state="visible")
        page.wait_for_timeout(200)
        inside = tooltip.evaluate(
            "el => { const r = el.getBoundingClientRect(); return el.parentElement === document.body && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth; }"
        )
        expect("the Smart Estimate tooltip sits above the page, fully on screen", inside, True)
        expect("its full text is readable", tooltip.inner_text(), "79% likely. From the title and notes. A day here is your Working Hours, 8:30.")
        page.screenshot(path=str(OUT / f"app-estimate-tooltip-{THEME}.png"), clip={**card.bounding_box(), "y": max(0, card.bounding_box()["y"] - 120), "height": card.bounding_box()["height"] + 140})
        page.mouse.move(0, 0)
        page.keyboard.press("Escape")

        page.goto(f"{BASE}/settings/features/templates")
        page.get_by_role("switch", name="Templates").first.click()
        page.get_by_text("Templates are off").wait_for()
        expect("switched off, the page says the Templates are kept", page.get_by_text("come back when you switch Templates on").count() + page.get_by_text("Switch them on").count(), 1)
        page.goto(f"{BASE}/today")
        page.wait_for_selector("#main [data-task-key]")
        page.locator("#main [data-task-key]", has_text=TITLE).first.locator("[data-arrow-item]").first.click()
        page.keyboard.press("Enter")
        card.get_by_role("button", name="Break into steps").first.wait_for()
        expect("the card has no Save as Template", card.get_by_role("button", name="Save as Template").count(), 0)
        page.keyboard.press("Escape")
        page.keyboard.press("ControlOrMeta+k")
        page.wait_for_selector("[cmdk-root]")
        page.keyboard.type("template")
        page.wait_for_timeout(200)
        expect("the command bar offers no New Task from a Template", page.locator("[cmdk-item]", has_text="New Task from").count(), 0)
        page.locator("[cmdk-item]", has_text="Turn Templates on").first.click()
        page.wait_for_timeout(400)
        browser.close()
    sys.exit(1 if failed else 0)


main()
