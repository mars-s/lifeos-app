"""How long the app takes to answer a click, a key or a drag on a long Inbox and a full Planner.

Needs the throwaway backend from local-backend.sh and a production build served by waku start (see
perf-load.py for the commands). It reseeds before each screen, with scratch:seedBulk on top:

    SCRATCH=/tmp/lifeos-local-backend uv run --with playwright python scripts/perf-interact.py <output.json>

Each step reports the slowest input-to-paint time the browser measured (Event Timing, the number INP
is built from), the main-thread time blocked in long tasks, and for drags the frame times. The CPU is
slowed THROTTLE times. BASE, CONVEX_URL, THROTTLE and ONLY (comma-separated step names) change the
run. PROFILE=<step> also writes a CPU profile of that one step beside the output, and TRACE=<step>
prints where the browser spent that step (script, style, layout, paint).
"""

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
THROTTLE = float(os.environ.get("THROTTLE", "4"))
ONLY = [name for name in os.environ.get("ONLY", "").split(",") if name]
PROFILE = os.environ.get("PROFILE", "")
TRACE = os.environ.get("TRACE", "")
RENDERING = ("FunctionCall", "EventDispatch", "FireAnimationFrame", "TimerFire", "RunMicrotasks", "UpdateLayoutTree", "Layout", "PrePaint", "Paint", "Layerize", "Commit", "HitTest", "MinorGC", "MajorGC")
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
NAMESPACE = re.sub(r"[^a-zA-Z0-9]", "", CONVEX_URL)
ENV = {**os.environ, "CONVEX_AGENT_MODE": "anonymous"}

WATCH = """
(([session, namespace]) => {
  localStorage.setItem('__convexAuthJWT_' + namespace, session.accessToken);
  localStorage.setItem('__convexAuthRefreshToken_' + namespace, session.refreshToken);
  const perf = (window.__perf = { events: [], long: [], frames: [], last: 0 });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) perf.events.push([entry.name, entry.duration]);
  }).observe({ type: 'event', durationThreshold: 16, buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) perf.long.push(entry.duration);
  }).observe({ type: 'longtask', buffered: true });
  const frame = (at) => {
    if (perf.last) perf.frames.push(at - perf.last);
    perf.last = at;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
})
"""

RESET = "(() => { const perf = window.__perf; perf.events = []; perf.long = []; perf.frames = []; })()"
READ = "(() => { const perf = window.__perf; return { events: perf.events, long: perf.long, frames: perf.frames }; })()"


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


def centre(page, selector, dy=None):
    box = page.locator(selector).first.bounding_box()
    if not box:
        sys.exit(f"nothing matches {selector}")
    return box["x"] + box["width"] / 2, box["y"] + (box["height"] / 2 if dy is None else dy)


def glide(page, start, end, steps=30):
    page.mouse.move(*start)
    page.mouse.down()
    for step in range(1, steps + 1):
        page.mouse.move(start[0] + (end[0] - start[0]) * step / steps, start[1] + (end[1] - start[1]) * step / steps)
        page.wait_for_timeout(16)


def goto(page, screen, selector):
    page.goto(f"{BASE}/{screen}")
    page.wait_for_selector(selector, timeout=30_000)
    page.wait_for_timeout(2500)


ROW = "#main [data-task-key]"
DUMP = "[data-plan-list=inbox] [data-task-key]"


def inbox_select(page):
    page.locator(ROW).nth(4).click()


def inbox_open(page):
    page.locator(ROW).nth(6).dblclick()
    page.wait_for_selector("[data-open-card]")


def inbox_type(page):
    page.keyboard.type("abcde", delay=60)


def inbox_close(page):
    page.keyboard.press("Escape")


def inbox_arrows(page):
    for _ in range(8):
        page.keyboard.press("ArrowDown")
        page.wait_for_timeout(60)


def inbox_select_all(page):
    page.keyboard.press("Meta+a")
    page.wait_for_timeout(200)
    page.keyboard.press("Escape")


def inbox_complete(page):
    page.locator(f"{ROW} [role=checkbox]").nth(2).click()
    page.wait_for_timeout(2500)


def inbox_reorder(page):
    glide(page, centre(page, f"{ROW} >> nth=3"), centre(page, f"{ROW} >> nth=9"))
    page.mouse.up()


def to_planner(page):
    page.keyboard.press("8")
    page.wait_for_selector("[data-plan-list]")


def planner_drag_to_day(page):
    start = centre(page, DUMP, 20)
    end = centre(page, "[data-plan-day] >> nth=1", 200)
    glide(page, start, end)
    page.mouse.up()


def planner_drag_to_calendar(page):
    start = centre(page, DUMP, 20)
    end = centre(page, "[data-cal-day]", 500)
    glide(page, start, end)
    page.mouse.up()


def planner_resize(page):
    handle = page.locator("[data-block-id] > span[aria-hidden]").last
    handle.scroll_into_view_if_needed()
    box = handle.bounding_box()
    at = (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    glide(page, at, (at[0], at[1] + 90))
    page.mouse.up()


def planner_move_block(page):
    block = page.locator("[data-block-id]").last
    box = block.bounding_box()
    at = (box["x"] + box["width"] - 12, box["y"] + 8)
    glide(page, at, (at[0], at[1] - 120))
    page.mouse.up()


def planner_week(page):
    page.get_by_role("radio", name="Week").click()
    page.wait_for_timeout(400)


def planner_week_move(page):
    block = page.locator("[data-block-id]").nth(3)
    block.scroll_into_view_if_needed()
    box = block.bounding_box()
    at = (box["x"] + box["width"] - 12, box["y"] + 8)
    glide(page, at, (at[0] + 220, at[1] + 100))
    page.mouse.up()


def planner_open_card(page):
    page.locator("[data-plan-day] [data-task-key]").nth(1).dblclick()
    page.wait_for_selector("[data-open-card]")
    page.wait_for_timeout(300)
    page.keyboard.press("Escape")


def today_open(page):
    page.locator(ROW).nth(3).dblclick()
    page.wait_for_selector("[data-open-card]")
    page.wait_for_timeout(300)
    page.keyboard.press("Escape")


STEPS = [
    ("inbox", "[data-task-key]", [inbox_select, inbox_open, inbox_type, inbox_close, inbox_arrows, inbox_select_all, inbox_complete, inbox_reorder, to_planner]),
    ("today", "[data-task-key]", [today_open]),
    ("planner", "[data-plan-list]", [planner_open_card, planner_drag_to_day, planner_drag_to_calendar, planner_resize, planner_move_block, planner_week, planner_week_move]),
]


NEEDS = {"inbox_type": ["inbox_open"], "inbox_close": ["inbox_open"], "planner_week_move": ["planner_week"]}


def measured(page, cdp, step):
    page.evaluate(RESET)
    if PROFILE == step.__name__:
        cdp.send("Profiler.enable")
        cdp.send("Profiler.start")
    events = []
    if TRACE == step.__name__:
        cdp.on("Tracing.dataCollected", lambda chunk: events.extend(chunk["value"]))
        cdp.send("Tracing.start", {"traceConfig": {"includedCategories": ["devtools.timeline", "v8"]}})
    step(page)
    page.wait_for_timeout(700)
    if TRACE == step.__name__:
        done = []
        cdp.on("Tracing.tracingComplete", lambda _: done.append(True))
        cdp.send("Tracing.end")
        while not done:
            page.wait_for_timeout(100)
        spent = {}
        for event in events:
            if event.get("ph") == "X" and event["name"] in RENDERING:
                spent[event["name"]] = spent.get(event["name"], 0) + event.get("tdur", event.get("dur", 0)) / 1000
        print("  trace:", {name: round(ms) for name, ms in sorted(spent.items(), key=lambda item: -item[1])}, flush=True)
    if PROFILE == step.__name__:
        OUT.with_suffix(f".{PROFILE}.cpuprofile").write_text(json.dumps(cdp.send("Profiler.stop")["profile"]))
    seen = page.evaluate(READ)
    frames = sorted(seen["frames"])
    slow = max(seen["events"], key=lambda event: event[1], default=["none", 0])
    return {
        "slowest_event": slow[0],
        "slowest_ms": round(slow[1]),
        "blocked_ms": round(sum(seen["long"])),
        "longest_task_ms": round(max(seen["long"], default=0)),
        "frame_p95_ms": round(frames[int(len(frames) * 0.95)]) if frames else 0,
        "frame_max_ms": round(frames[-1]) if frames else 0,
        "frames_over_50ms": sum(1 for frame in frames if frame > 50),
    }


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    report = {}
    for screen, selector, steps in STEPS:
        wanted = [step for step in steps if not ONLY or step.__name__ in ONLY]
        if not wanted:
            continue
        reseed()
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        context.add_init_script(f"{WATCH}({json.dumps([sign_in(), NAMESPACE])})")
        page = context.new_page()
        cdp = context.new_cdp_session(page)
        goto(page, screen, selector)
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": THROTTLE})
        needed = {before for step in wanted for before in NEEDS.get(step.__name__, [])}
        for step in steps:
            if step not in wanted and step.__name__ not in needed:
                continue
            result = measured(page, cdp, step)
            if step in wanted:
                report[step.__name__] = result
                print(f"{step.__name__:26}", result, flush=True)
        context.close()
    browser.close()

OUT.write_text(json.dumps({"throttle": THROTTLE, "steps": report}, indent=2))
