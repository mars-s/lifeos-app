"""How many compositor layers and DOM nodes each screen holds once it is still.

A layer costs memory and a little time in every frame, so a screen that is not moving should hold few.
Needs the throwaway backend from local-backend.sh and a production build served by waku start (see
perf-load.py for the commands). It reseeds first, with scratch:seedBulk on top:

    SCRATCH=/tmp/lifeos-local-backend uv run --with playwright python scripts/perf-layers.py <output.json>

BASE, CONVEX_URL and SCRATCH change the run. The Planner is counted in Day and in Week.
"""

import json
import os
import re
import subprocess
import sys
import time
from datetime import date
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:4070")
CONVEX_URL = os.environ.get("CONVEX_URL", "http://127.0.0.1:3210")
SCRATCH = os.environ.get("SCRATCH", "/tmp/lifeos-local-backend")
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
NAMESPACE = re.sub(r"[^a-zA-Z0-9]", "", CONVEX_URL)
ENV = {**os.environ, "CONVEX_AGENT_MODE": "anonymous"}

SIGN_IN = """
(([session, namespace]) => {
  localStorage.setItem('__convexAuthJWT_' + namespace, session.accessToken);
  localStorage.setItem('__convexAuthRefreshToken_' + namespace, session.refreshToken);
})
"""

COUNT = """
(() => ({
  nodes: document.querySelectorAll('*').length,
  hinted: [...document.querySelectorAll('*')].filter((node) => getComputedStyle(node).willChange !== 'auto').length,
  morph_letters: document.querySelectorAll('[torph-root] [torph-item]').length,
  tiles: document.querySelectorAll('[data-plan-list] [data-task-key]:not([data-row-gap])').length,
  blocks: document.querySelectorAll('[data-block-id]').length,
}))()
"""


def convex(*args):
    for _ in range(5):
        tried = subprocess.run(["npx", "convex", "run", *args], cwd=SCRATCH, text=True, env=ENV, capture_output=True)
        if tried.returncode == 0:
            return tried.stdout
        time.sleep(1)
    sys.exit(f"{args[0]} kept failing: {tried.stderr[-400:]}")


def reseed():
    zone = subprocess.check_output(["node", "-e", "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)"], text=True).strip()
    args = json.dumps({"today": date.today().isoformat(), "timeZone": zone})
    convex("scratch:seed", args)
    convex("scratch:seedBulk", args)


def layers(page, cdp):
    seen = []
    cdp.on("LayerTree.layerTreeDidChange", lambda event: seen.append(len(event.get("layers", []))))
    cdp.send("LayerTree.enable")
    page.mouse.move(700, 450)
    page.mouse.move(701, 451)
    page.wait_for_timeout(1200)
    cdp.send("LayerTree.disable")
    return seen[-1] if seen else None


def week(page):
    page.get_by_role("radio", name="Week").click()
    page.wait_for_timeout(1200)


VIEWS = [
    ("planner_day", "planner", "[data-plan-list]", None),
    ("planner_week", "planner", "[data-plan-list]", week),
    ("inbox", "inbox", "[data-task-key]", None),
    ("today", "today", "[data-task-key]", None),
]

with sync_playwright() as playwright:
    reseed()
    browser = playwright.chromium.launch()
    report = {}
    for name, screen, selector, prepare in VIEWS:
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        context.add_init_script(f"{SIGN_IN}({json.dumps([json.loads(convex('scratch:signIn')), NAMESPACE])})")
        page = context.new_page()
        page.goto(f"{BASE}/{screen}")
        page.wait_for_selector(selector, timeout=30_000)
        page.wait_for_timeout(2500)
        if prepare:
            prepare(page)
        cdp = context.new_cdp_session(page)
        report[name] = {"layers": layers(page, cdp), **page.evaluate(COUNT)}
        print(f"{name:14}", report[name], flush=True)
        context.close()
    browser.close()

OUT.write_text(json.dumps(report, indent=2))
