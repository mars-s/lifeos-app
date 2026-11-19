"""Cold-load cost of each screen: the JavaScript it fetches and how long until the screen shows.

Needs the throwaway backend from local-backend.sh and a production build served by waku start:

    SCRATCH=/tmp/lifeos-local-backend sh scripts/local-backend.sh
    (cd $SCRATCH && CONVEX_AGENT_MODE=anonymous npx convex dev --typecheck disable) &
    WAKU_PUBLIC_CONVEX_URL=http://127.0.0.1:3210 npx waku build && npx waku start --port 4070 &
    SCRATCH=/tmp/lifeos-local-backend uv run --with playwright python scripts/perf-load.py <output.json>

It reseeds the backend first, with scratch:seedBulk on top (a 300 Task Inbox, 12 Tasks a day, a 1,500
Task Logbook), so two runs measure the same data.
Each screen loads RUNS times in a fresh browser context (an empty HTTP cache, its own session, because
a refresh token only works once) with the CPU slowed
THROTTLE times, and the median is kept. BASE, CONVEX_URL, RUNS, THROTTLE, ONLY (comma-separated screen
names) and ENGINE (chromium or webkit, the Mac app's engine) change the run. WebKit has no CPU throttle
and no long-task entries.
"""

import gzip
import json
import os
import re
import statistics
import subprocess
import sys
import time
from datetime import date
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:4070")
CONVEX_URL = os.environ.get("CONVEX_URL", "http://127.0.0.1:3210")
SCRATCH = os.environ.get("SCRATCH", "/tmp/lifeos-local-backend")
RUNS = int(os.environ.get("RUNS", "5"))
THROTTLE = float(os.environ.get("THROTTLE", "4"))
ENGINE = os.environ.get("ENGINE", "chromium")
ONLY = [name for name in os.environ.get("ONLY", "").split(",") if name]
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
NAMESPACE = re.sub(r"[^a-zA-Z0-9]", "", CONVEX_URL)
ENV = {**os.environ, "CONVEX_AGENT_MODE": "anonymous"}

SCREENS = {
    "today": "[data-task-key]",
    "inbox": "[data-task-key]",
    "planner": "[data-plan-list]",
    "logbook": "[data-task-key]",
    "settings": "main h1",
}

WATCH = """
(([session, namespace, selector]) => {
  localStorage.setItem('__convexAuthJWT_' + namespace, session.accessToken);
  localStorage.setItem('__convexAuthRefreshToken_' + namespace, session.refreshToken);
  window.__perf = { ready: null, long: [] };
  const look = () => {
    if (window.__perf.ready === null && document.querySelector(selector)) window.__perf.ready = performance.now();
  };
  new MutationObserver(look).observe(document, { childList: true, subtree: true });
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__perf.long.push([entry.startTime, entry.duration]);
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
})
"""


def convex(*args):
    for _ in range(5):
        tried = subprocess.run(["npx", "convex", "run", *args], cwd=SCRATCH, text=True, env=ENV, capture_output=True)
        if tried.returncode == 0:
            return tried.stdout
        time.sleep(1)
    sys.exit(f"{args[0]} kept failing: {tried.stderr[-400:]}")


def sign_in():
    return json.loads(convex("scratch:signIn"))


def reseed():
    zone = subprocess.check_output(["node", "-e", "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)"], text=True).strip()
    args = json.dumps({"today": date.today().isoformat(), "timeZone": zone})
    convex("scratch:seed", args)
    convex("scratch:seedBulk", args)


def load(browser, screen, selector):
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    context.add_init_script(f"{WATCH}({json.dumps([sign_in(), NAMESPACE, selector])})")
    page = context.new_page()
    responses = []
    page.on("response", lambda response: responses.append(response) if response.url.startswith(BASE) and response.url.split("?")[0].endswith(".js") else None)
    cdp = None
    if ENGINE == "chromium":
        cdp = context.new_cdp_session(page)
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": THROTTLE})
        cdp.send("Performance.enable")
    page.goto(f"{BASE}/{screen}", wait_until="commit")
    for _ in range(300):
        if page.evaluate("window.__perf?.ready != null"):
            break
        page.wait_for_timeout(100)
    else:
        sys.exit(f"{screen} never showed {selector}")
    page.wait_for_timeout(1500)
    seen = page.evaluate("window.__perf")
    scripts = {response.url: response.body() for response in responses}
    script_ms = None
    if cdp:
        metrics = {metric["name"]: metric["value"] for metric in cdp.send("Performance.getMetrics")["metrics"]}
        script_ms = round(metrics["ScriptDuration"] * 1000)
    context.close()
    return {
        "ready_ms": round(seen["ready"]),
        "blocked_ms": round(sum(max(0, duration - 50) for start, duration in seen["long"] if start < seen["ready"])),
        "script_ms": script_ms,
        "js_files": len(scripts),
        "js_kb": round(sum(len(body) for body in scripts.values()) / 1024),
        "js_gzip_kb": round(sum(len(gzip.compress(body)) for body in scripts.values()) / 1024),
        "files": sorted(url.rsplit("/", 1)[-1] for url in scripts),
    }


def median(runs, field):
    values = [run[field] for run in runs if run[field] is not None]
    return round(statistics.median(values)) if values else None


with sync_playwright() as playwright:
    reseed()
    browser = getattr(playwright, ENGINE).launch()
    report = {}
    for screen, selector in SCREENS.items():
        if ONLY and screen not in ONLY:
            continue
        load(browser, screen, selector)
        runs = [load(browser, screen, selector) for _ in range(RUNS)]
        report[screen] = {field: median(runs, field) for field in ("ready_ms", "blocked_ms", "script_ms", "js_files", "js_kb", "js_gzip_kb")}
        report[screen]["files"] = runs[0]["files"]
        print(screen, {field: value for field, value in report[screen].items() if field != "files"}, flush=True)
    browser.close()

OUT.write_text(json.dumps({"engine": ENGINE, "throttle": THROTTLE, "runs": RUNS, "screens": report}, indent=2))
