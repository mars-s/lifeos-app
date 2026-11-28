"""The open Task card unfolds without dropping frames (#85).

Seeds the Task from check-card.py (notes with a link, a Trip with the map and drive time, a passed Work
Block, a best-guess Estimate), then opens it by double-click in WebKit (the Mac app's engine) and
Chromium (on the real GPU, not SwiftShader), in the narrow Planner column and the wide Today list.
Each open is watched frame by frame for 2 s: the requestAnimationFrame gaps, the card's height in each
frame, when the Trip and the map canvas arrive, and long tasks (Chromium only). The first open is cold
(no Trip cached, no map chunk loaded); the next ones are warm. It also opens a plain Task and the Task
with a Checklist.

Needs the throwaway backend from local-backend.sh and a production build served by waku start:

    SCRATCH=/tmp/lifeos-local-backend sh scripts/local-backend.sh
    (cd $SCRATCH && CONVEX_AGENT_MODE=anonymous npx convex dev --typecheck disable) &
    WAKU_PUBLIC_CONVEX_URL=http://127.0.0.1:3210 npx waku build && npx waku start --port 4072 &
    SCRATCH=/tmp/lifeos-local-backend uv run --with playwright python scripts/check-card-motion.py <output folder>

A frame counts as dropped when its gap is over 1.5 refreshes (25 ms at 60 Hz). Each open reports the
first frame (the click's own render), the frames while the card unfolds, and the frames after it
settles, when the map mounts. The card's height must only grow while it unfolds and must not change
after it settles. Frame times are wall-clock, so a busy machine adds drops: check the load average
first. BASE, CONVEX_URL, ENGINES (webkit,chromium), OPENS (per surface) and TRACE=1 (a Chromium
performance trace of one warm open, saved in the output folder and summarised) change the run.
Exits non-zero when a frame drops or the card jumps.
"""

import json
import os
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:4072")
CONVEX_URL = os.environ.get("CONVEX_URL", "http://127.0.0.1:3210")
SCRATCH = os.environ.get("SCRATCH", "/tmp/lifeos-local-backend")
ENGINES = os.environ.get("ENGINES", "webkit,chromium").split(",")
OPENS = int(os.environ.get("OPENS", "4"))
TRACE = os.environ.get("TRACE") == "1"
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
NAMESPACE = re.sub(r"[^a-zA-Z0-9]", "", CONVEX_URL)
ZONE = subprocess.check_output(["node", "-e", "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)"], text=True).strip()
ENV = {**os.environ, "CONVEX_AGENT_MODE": "anonymous"}
TITLE = "Get moleskine notebooks from officeworks"
NOTES = (
    "Moleskine Cahier Ruled Notebook Large Black 3 Pack\n$20.00 at Officeworks\n"
    "https://www.officeworks.com.au/shop/officeworks/p/moleskine-cahier-ruled-notebook-large-black-3-pack-msqp316\n\n"
    "These are the thin cardboard Cahier journals sold as a 3-pack."
)
CHECKLIST = "Reply to Harry about the October invoice"
PLAIN = "Cook dinner for Sam"
SURFACES = [("planner", "/planner"), ("list", "/today")]
DROP_MS = 25
REAL_GPU = ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"]
failed = []

WATCH = """() => {
  window.__frames = null;
  const long = [];
  try {
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) long.push([entry.startTime, entry.duration]); })
      .observe({ type: 'longtask', buffered: false });
  } catch {}
  window.__watch = (ms) => {
    const seen = { gaps: [], heights: [], marks: {}, long: [], start: performance.now() };
    long.length = 0;
    let last = seen.start;
    const tick = (now) => {
      const at = Math.round(now - seen.start);
      seen.gaps.push([at, Math.round((now - last) * 10) / 10]);
      last = now;
      const card = document.querySelector('#main li[data-open-card]');
      seen.heights.push([at, card ? Math.round(card.getBoundingClientRect().height) : 0]);
      if (card?.querySelector('section[aria-label^="Trip"]')) seen.marks.trip ??= at;
      if (card?.querySelector('.maplibregl-canvas')) seen.marks.canvas ??= at;
      if (card?.querySelector('.maplibregl-canvas-container canvas')?.width) seen.marks.drawn ??= at;
      if (now - seen.start < ms) requestAnimationFrame(tick);
      else { seen.long = long.filter(([start]) => start >= seen.start).map(([, duration]) => Math.round(duration)); window.__frames = seen; }
    };
    requestAnimationFrame(tick);
  };
}"""


def convex(*args):
    return subprocess.check_output(["npx", "convex", *args], cwd=SCRATCH, env=ENV, text=True)


def seed():
    convex("run", "scratch:seed", json.dumps({"today": date.today().isoformat(), "timeZone": ZONE}))
    convex("run", "scratch:storeSecret", json.dumps({"last4": "test"}))
    convex("run", "scratch:seedPlaces", json.dumps({"title": TITLE}))
    convex("run", "scratch:suggestEstimate", json.dumps({"title": TITLE, "guesses": [{"minutes": 40, "probability": 0.72}], "reason": "A short drive and one shop."}))
    convex("run", "scratch:fillCard", json.dumps({"title": TITLE, "notes": NOTES, "plannedDaysAgo": 4}))


def summarise(seen):
    gaps = seen["gaps"][1:]
    heights = [height for _, height in seen["heights"]]
    peak = max(heights, default=0)
    opened_at = next((at for at, height in seen["heights"] if height > seen["heights"][0][1]), 0)
    settled_at = next((at for at, height in seen["heights"] if height == heights[-1]), 0) if heights else 0
    shrank = sum(1 for before, after in zip(heights, heights[1:]) if after < before - 1 and before == peak)
    later = [at for (at, height), (_, before) in zip(seen["heights"][1:], seen["heights"]) if at > 600 and abs(height - before) > 1]
    unfolding = [gap for at, gap in gaps if opened_at < at <= settled_at]
    after = [gap for at, gap in gaps if at > settled_at]
    return {
        "dropped": sum(1 for _, gap in gaps if gap > DROP_MS),
        "dropped_unfolding": sum(1 for gap in unfolding if gap > DROP_MS),
        "longest_unfolding_ms": max(unfolding, default=0),
        "dropped_after": sum(1 for gap in after if gap > DROP_MS),
        "longest_after_ms": max(after, default=0),
        "longest_ms": max((gap for _, gap in gaps), default=0),
        "frames": len(gaps),
        "opened_at": opened_at,
        "first_frame_ms": next((gap for at, gap in gaps if at == opened_at), 0),
        "long_tasks": seen["long"],
        "trip_at": seen["marks"].get("trip"),
        "canvas_at": seen["marks"].get("canvas"),
        "drawn_at": seen["marks"].get("drawn"),
        "settled_at": settled_at,
        "final_height": heights[-1] if heights else 0,
        "shrank_from_peak": shrank,
        "moved_after_600ms": later[:6],
        "slow_gaps": [(at, gap) for at, gap in gaps if gap > DROP_MS][:12],
    }


def open_and_watch(page, title, ms=2000):
    row = page.locator("#main li[data-task-key]", has_text=re.compile(re.escape(title))).first
    row.scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    target = row.locator("[data-arrow-item]").first
    page.evaluate(f"window.__watch({ms})")
    target.dblclick()
    page.wait_for_function("window.__frames !== null", timeout=ms + 4000)
    seen = page.evaluate("window.__frames")
    page.evaluate("window.__frames = null")
    return seen


def close(page):
    page.keyboard.press("Escape")
    page.wait_for_timeout(700)


def trace(browser, page, name):
    browser.start_tracing(page=page, path=str(OUT / f"{name}.trace.json"), categories=["devtools.timeline", "disabled-by-default-devtools.timeline", "v8.execute", "blink.user_timing", "gpu"])
    seen = open_and_watch(page, TITLE)
    browser.stop_tracing()
    close(page)
    events = json.loads((OUT / f"{name}.trace.json").read_text())
    events = events["traceEvents"] if isinstance(events, dict) else events
    main = {}
    for event in events:
        if event.get("ph") == "X" and event.get("name") in {"Layout", "UpdateLayoutTree", "Paint", "PrePaint", "Layerize", "FunctionCall", "EvaluateScript", "v8.compile", "ParseHTML", "HitTest", "RunTask", "TimerFire", "FireAnimationFrame", "Commit", "RasterTask", "GPUTask"}:
            main.setdefault(event["name"], [0, 0, 0])
            spent = event.get("dur", 0) / 1000
            main[event["name"]][0] += 1
            main[event["name"]][1] += spent
            main[event["name"]][2] = max(main[event["name"]][2], spent)
    print(f"     trace {name}: " + ", ".join(f"{key} n={n} total={round(total)}ms max={round(top, 1)}ms" for key, (n, total, top) in sorted(main.items(), key=lambda item: -item[1][1])))
    return summarise(seen)


def run(playwright, engine):
    browser = playwright.chromium.launch(args=REAL_GPU) if engine == "chromium" else playwright.webkit.launch()
    results = {}
    for surface, path in SURFACES:
        session = json.loads(convex("run", "scratch:signIn"))
        context = browser.new_context(viewport={"width": 1440, "height": 1000}, color_scheme="dark", device_scale_factor=2)
        context.add_init_script(f"({WATCH})()")
        page = context.new_page()
        page.goto(f"{BASE}/design")
        page.evaluate(
            "([namespace, s]) => { localStorage.setItem(`__convexAuthJWT_${namespace}`, s.accessToken);"
            " localStorage.setItem(`__convexAuthRefreshToken_${namespace}`, s.refreshToken); }",
            [NAMESPACE, session],
        )
        page.goto(f"{BASE}{path}")
        page.wait_for_selector("#main li[data-task-key]")
        page.wait_for_timeout(1500)
        for attempt in range(OPENS):
            name = f"{engine}-{surface}-{'cold' if attempt == 0 else f'warm{attempt}'}"
            results[name] = summarise(open_and_watch(page, TITLE))
            if attempt == 1:
                page.screenshot(path=str(OUT / f"{name}.png"))
            close(page)
        for label, title in (("plain", PLAIN), ("checklist", CHECKLIST)):
            open_and_watch(page, title)
            close(page)
            results[f"{engine}-{surface}-{label}"] = summarise(open_and_watch(page, title))
            close(page)
        if TRACE and engine == "chromium":
            results[f"{engine}-{surface}-traced"] = trace(browser, page, f"{engine}-{surface}")
        context.close()
    browser.close()
    return results


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    seed()
    results = {}
    with sync_playwright() as playwright:
        for engine in ENGINES:
            results |= run(playwright, engine)
    (OUT / "card-motion.json").write_text(json.dumps(results, indent=2))
    for name, result in results.items():
        jumped = result["shrank_from_peak"] > 0 or result["moved_after_600ms"]
        ok = result["dropped"] == 0 and not jumped
        print(f"{'ok  ' if ok else 'FAIL'} {name}: unfolding dropped {result['dropped_unfolding']}, longest {result['longest_unfolding_ms']} ms; "
              f"after dropped {result['dropped_after']}, longest {result['longest_after_ms']} ms; first frame {result['first_frame_ms']} ms; opened {result['opened_at']}, settled {result['settled_at']} ms "
              f"at {result['final_height']} px; trip {result['trip_at']}, map {result['canvas_at']}; long tasks {result['long_tasks']}; "
              f"moved late {result['moved_after_600ms']}; slow {result['slow_gaps']}")
        if not ok:
            failed.append(name)
    print("FAILED: " + ", ".join(failed) if failed else "Every open unfolded without a dropped frame.")
    sys.exit(1 if failed else 0)


main()
