"""A Planner tile's Estimate popover and the Timebox's morphing labels work as they did before they got lighter (#73).

The tile draws only a button until the Estimate popover is first opened. This checks that nothing you can
see or do changed: the same button opens it by pointer, by key and from a script, it sits under the button,
Escape gives focus back, a second click closes it, a click elsewhere closes it and keeps focus where you
clicked, an Estimate set in it shows on the tile and undoes, and a tile with the popover open stays drawn
while the Brain Dump scrolls. It then checks that a still label holds no compositor hint and still morphs.

Needs the throwaway backend from local-backend.sh and the web app running:

    SCRATCH=/tmp/lifeos-local-backend sh scripts/local-backend.sh
    (cd $SCRATCH && CONVEX_AGENT_MODE=anonymous npx convex dev --typecheck disable) &
    WAKU_PUBLIC_CONVEX_URL=http://127.0.0.1:3210 npx waku dev --port 4061 &
    SCRATCH=/tmp/lifeos-local-backend uv run --with playwright python scripts/check-planner-tile.py <output folder>

It reseeds the backend first, with scratch:seedBulk on top. BASE, CONVEX_URL, WIDTH (1440 or 390), THEME (light or dark)
and ENGINE (chromium or webkit) change the run. It writes what it measured to tile<suffix>.json, so two builds
can be compared, and exits non-zero on a failure.
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
THEME = os.environ.get("THEME", "light")
WIDTH = int(os.environ.get("WIDTH", "1440"))
ENGINE = os.environ.get("ENGINE", "chromium")
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
NAMESPACE = re.sub(r"[^a-zA-Z0-9]", "", CONVEX_URL)
ZONE = subprocess.check_output(["node", "-e", "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)"], text=True).strip()
SUFFIX = f"-{WIDTH}-{THEME}" + ("" if ENGINE == "chromium" else f"-{ENGINE}")
ENV = {**os.environ, "CONVEX_AGENT_MODE": "anonymous"}
MOD = "Meta" if sys.platform == "darwin" else "Control"
DIALOG = "[role=dialog][aria-label=Estimate]"
failed = []
measured = {}

BUTTON_STATE = """(button) => ({
  popup: button.getAttribute('aria-haspopup'),
  expanded: button.getAttribute('aria-expanded'),
  state: button.dataset.state,
  controls: button.getAttribute('aria-controls'),
  marked: button.__marked === true,
  focused: document.activeElement === button,
})"""

PLACE = """(button) => {
  const dialog = document.querySelector('[role=dialog][aria-label=Estimate]');
  const panel = dialog.getBoundingClientRect();
  const from = button.getBoundingClientRect();
  return {
    id: dialog.id,
    below: Math.round(panel.top - from.bottom),
    right: Math.round(panel.right - from.right),
    width: Math.round(panel.width),
    onScreen: panel.left >= 0 && panel.right <= innerWidth && panel.top >= 0,
    focusInside: dialog.contains(document.activeElement),
  };
}"""

OPENING = """() => { window.__watching = new Promise((done) => {
  const frames = [];
  const until = performance.now() + 450;
  const look = () => {
    const wrapper = document.querySelector('[data-radix-popper-content-wrapper]:has([role=dialog][aria-label=Estimate])');
    if (wrapper) {
      const box = wrapper.getBoundingClientRect();
      if (box.bottom > 0 && box.width > 0) frames.push([Math.round(box.left), Math.round(box.top)]);
    }
    if (performance.now() < until) requestAnimationFrame(look);
    else done(frames);
  };
  look();
}); }"""

SHOWN_AT_ONCE = """() => { window.__watching = new Promise((done) => {
  const seen = (dialog) =>
    requestAnimationFrame(() => requestAnimationFrame(() => done({ opacity: getComputedStyle(dialog).opacity, transform: getComputedStyle(dialog).transform })));
  const dialog = document.querySelector('[role=dialog][aria-label=Estimate]');
  if (dialog) return seen(dialog);
  new MutationObserver((_, watch) => {
    const found = document.querySelector('[role=dialog][aria-label=Estimate]');
    if (!found) return;
    watch.disconnect();
    seen(found);
  }).observe(document.body, { childList: true, subtree: true });
}); }"""

LETTERS = """() => {
  const letters = [...document.querySelectorAll('[torph-root] [torph-item]')];
  return { letters: letters.length, hinted: letters.filter((letter) => getComputedStyle(letter).willChange !== 'auto').length };
}"""

MORPHING = """() => { window.__watching = new Promise((done) => {
  let most = 0;
  const until = performance.now() + 400;
  const look = () => {
    const moving = document.getAnimations().filter((animation) => animation.effect?.target?.closest?.('[torph-root]')).length;
    most = Math.max(most, moving);
    if (performance.now() < until) requestAnimationFrame(look);
    else done(most);
  };
  look();
}); }"""


def watch(page, script):
    page.evaluate(script)
    return lambda: page.evaluate("() => window.__watching")


def convex(*args):
    return subprocess.check_output(["npx", "convex", *args], cwd=SCRATCH, text=True, env=ENV, stderr=subprocess.DEVNULL)


def expect(step, got, wanted):
    if got == wanted:
        print(f"ok    {step}")
    else:
        print(f"FAIL  {step}: wanted {wanted!r}, got {got!r}")
        failed.append(step)


def shot(page, name):
    page.screenshot(path=str(OUT / f"tile-{name}{SUFFIX}.png"))


def gone(page):
    page.wait_for_selector(DIALOG, state="detached", timeout=3000)


def shown(page):
    page.wait_for_selector(DIALOG, timeout=3000)
    page.wait_for_timeout(300)


def check_estimate(page):
    if WIDTH <= 640:
        page.locator("[role=radio][data-value=dump]").click()
        page.wait_for_timeout(500)
    tiles = page.locator("[data-plan-list=inbox] [data-task-key]:not([data-row-gap])")
    unestimated = tiles.locator('button[aria-label^="Set an Estimate"]').first
    unestimated.wait_for(state="attached", timeout=10_000)
    key = unestimated.locator("xpath=ancestor::li[@data-task-key][1]").get_attribute("data-task-key")
    button = page.locator(f'[data-plan-list=inbox] [data-task-key="{key}"] button[aria-label*=Estimate]')
    button.scroll_into_view_if_needed()
    button.evaluate("(button) => { button.__marked = true; }")

    rest = button.evaluate(BUTTON_STATE)
    expect("at rest the button says it opens a dialog and is closed", [rest["popup"], rest["expanded"], rest["state"], rest["controls"]], ["dialog", "false", "closed", None])

    button.hover()
    page.wait_for_timeout(200)
    opening = watch(page, OPENING)
    button.click()
    shown(page)
    places = opening()
    opened = button.evaluate(BUTTON_STATE)
    place = button.evaluate(PLACE)
    measured["pointer"] = place
    expect("from its first frame on screen the popover is in its final place", [len(places) > 0, len({tuple(spot) for spot in places})], [True, 1])
    expect("a click opens the Estimate popover from the same button", [opened["marked"], opened["expanded"], opened["state"]], [True, "true", "open"])
    expect("the button names the popover it controls", opened["controls"], place["id"])
    expect("the popover sits 8 px under the button, on screen", [place["below"], place["onScreen"]], [8, True])
    expect("focus moves into the popover", place["focusInside"], True)
    shot(page, "estimate-open")

    page.keyboard.press("Escape")
    gone(page)
    closed = button.evaluate(BUTTON_STATE)
    expect("Escape closes it and gives focus back to the same button", [closed["marked"], closed["focused"], closed["expanded"], closed["state"], closed["controls"]], [True, True, "false", "closed", None])

    waiting = watch(page, SHOWN_AT_ONCE)
    page.keyboard.press("Enter")
    first = waiting()
    expect("Enter opens it with no fade: whole by its second frame", [first["opacity"], first["transform"]], ["1", "none"])
    shown(page)
    measured["keyboard"] = button.evaluate(PLACE)
    expect("opened by key, it sits in the same place", measured["keyboard"], {**place, "id": measured["keyboard"]["id"]})

    page.locator(f"{DIALOG} input[name=estimate]").fill("45")
    page.keyboard.press("Enter")
    page.wait_for_timeout(600)
    label = button.get_attribute("aria-label") or ""
    measured["after_set"] = {"label_changes": label.startswith("Change the Estimate"), "text": button.inner_text().strip(), "still_open": page.locator(DIALOG).count() == 1}
    expect("an Estimate typed in the popover shows on the tile", [measured["after_set"]["label_changes"], measured["after_set"]["text"].endswith("0:45")], [True, True])
    shot(page, "estimate-set")
    page.keyboard.press("Escape")
    gone(page)
    page.keyboard.press(f"{MOD}+z")
    page.wait_for_timeout(700)
    expect("Undo takes the Estimate off again", (button.get_attribute("aria-label") or "").startswith("Set an Estimate"), True)

    button.click()
    shown(page)
    button.click()
    gone(page)
    page.wait_for_timeout(400)
    expect("a second click on the button closes it, and it stays closed", [page.locator(DIALOG).count(), button.get_attribute("data-state")], [0, "closed"])

    button.click()
    shown(page)
    page.mouse.click(WIDTH - 6, 6)
    gone(page)
    away = button.evaluate(BUTTON_STATE)
    expect("a click elsewhere closes it and leaves focus where you clicked", [away["focused"], away["state"]], [False, "closed"])

    button.evaluate("(button) => button.click()")
    shown(page)
    expect("a click from a script opens it too", button.get_attribute("data-state"), "open")
    scroller = page.locator("[data-plan-list=inbox]")
    drawn_before = tiles.count()
    scroller.evaluate("(list) => { list.scrollTop = 6000; }")
    page.wait_for_timeout(600)
    held = page.locator(f'[data-plan-list=inbox] [data-task-key="{key}"]:not([data-row-gap]) button[data-state=open]').count()
    measured["scrolled"] = {"drawn_before": drawn_before, "drawn_after": tiles.count(), "held": held}
    expect("the tile with the open popover stays drawn while the Brain Dump scrolls away", [held, page.locator(DIALOG).count()], [1, 1])
    page.keyboard.press("Escape")
    gone(page)
    scroller.evaluate("(list) => { list.scrollTop = 0; }")
    page.wait_for_timeout(500)


def check_morph(page):
    if WIDTH <= 640:
        page.locator("[role=radio][data-value=timebox]").click()
        page.wait_for_timeout(600)
    still = page.evaluate(LETTERS)
    measured["letters"] = still
    expect("the Timebox draws its labels letter by letter", still["letters"] > 0, True)
    expect("no still letter asks for its own layer", still["hinted"], 0)
    title = page.locator("section[aria-label=Timebox] h2")
    before = title.inner_text()
    watching = watch(page, MORPHING)
    page.get_by_role("button", name=re.compile("^Next ")).first.click()
    moving = watching()
    page.wait_for_timeout(500)
    measured["morph"] = {"moving": moving, "changed": title.inner_text() != before}
    expect("the Timebox title still morphs to the next day", [moving > 0, title.inner_text() != before], [True, True])
    expect("and holds no hint once it settles", page.evaluate(LETTERS)["hinted"], 0)
    shot(page, "timebox-next")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    args = json.dumps({"today": date.today().isoformat(), "timeZone": ZONE})
    convex("run", "scratch:seed", args)
    convex("run", "scratch:seedBulk", args)
    session = json.loads(convex("run", "scratch:signIn"))
    with sync_playwright() as playwright:
        browser = getattr(playwright, ENGINE).launch(headless=True)
        context = browser.new_context(viewport={"width": WIDTH, "height": 900}, color_scheme=THEME, device_scale_factor=2)
        page = context.new_page()
        page.on("pageerror", lambda error: failed.append(f"page error: {error}") or print(f"FAIL  page error: {error}"))
        page.on("console", lambda message: message.type == "error" and (failed.append(f"console: {message.text}") or print(f"FAIL  console error: {message.text}")))
        page.goto(f"{BASE}/design")
        page.evaluate(
            "([namespace, s]) => { localStorage.setItem(`__convexAuthJWT_${namespace}`, s.accessToken);"
            " localStorage.setItem(`__convexAuthRefreshToken_${namespace}`, s.refreshToken); }",
            [NAMESPACE, session],
        )
        page.goto(f"{BASE}/planner")
        page.wait_for_selector("[data-plan-list]", state="attached", timeout=30_000)
        page.wait_for_timeout(2500)
        check_estimate(page)
        check_morph(page)
        browser.close()
    (OUT / f"tile{SUFFIX}.json").write_text(json.dumps(measured, indent=2))
    print(f"{len(failed)} failed" if failed else "all ok")
    sys.exit(1 if failed else 0)


main()
