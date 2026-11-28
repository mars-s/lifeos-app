import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Page } from "@playwright/test";
import { E2E_ROOT, OUT } from "./stack.ts";

export const PERF_OUT = join(OUT, "profiles");
export const BASELINE = join(E2E_ROOT, "perf/baseline.json");
const DROP_MS = 25;
const LONG_MS = 50;

export const INSTRUMENT = `(() => {
  const perf = { frames: [], longs: [], events: [], commits: [], inputAt: null, readyAt: null, ready: null, armed: false };
  window.__perf = perf;
  const tick = (now) => {
    if (perf.armed) {
      perf.frames.push(now);
      if (perf.ready && perf.readyAt === null && perf.inputAt !== null) {
        try { if (perf.ready()) perf.readyAt = performance.now(); } catch {}
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try { new PerformanceObserver((list) => { for (const e of list.getEntries()) perf.longs.push([e.startTime, e.duration]); }).observe({ type: 'longtask' }); } catch {}
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) perf.events.push({ name: e.name, start: e.startTime, duration: e.duration, delay: e.processingStart - e.startTime, processing: e.processingEnd - e.processingStart, presentation: e.startTime + e.duration - e.processingEnd, id: e.interactionId });
    }).observe({ type: 'event', durationThreshold: 16 });
  } catch {}
  const mark = (event) => { if (perf.armed && perf.inputAt === null) perf.inputAt = event.timeStamp; };
  for (const type of ['pointerdown', 'keydown', 'mousedown']) window.addEventListener(type, mark, { capture: true });
  let renderers = 0;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    isDisabled: false,
    renderers: new Map(),
    inject(renderer) { renderers += 1; this.renderers.set(renderers, renderer); return renderers; },
    checkDCE() {},
    onScheduleFiberRoot() {},
    onCommitFiberRoot(_id, root) {
      if (!perf.armed) return;
      const duration = root && root.current && typeof root.current.actualDuration === 'number' ? root.current.actualDuration : null;
      perf.commits.push([performance.now(), duration]);
    },
    onPostCommitFiberRoot() {},
    onCommitFiberUnmount() {},
  };
})();`;

export type Sample = {
  inputToReady: number | null;
  inp: number | null;
  inputDelay: number | null;
  processing: number | null;
  presentation: number | null;
  longTasks: number;
  longTaskMs: number;
  blockingMs: number;
  frames: number;
  dropped: number;
  worstFrame: number;
  commits: number;
  commitMs: number | null;
  worstCommit: number | null;
};

type Raw = {
  frames: number[];
  longs: [number, number][];
  events: { name: string; start: number; duration: number; delay: number; processing: number; presentation: number; id: number }[];
  commits: [number, number | null][];
  inputAt: number | null;
  readyAt: number | null;
};

export const arm = (page: Page, ready: string) =>
  page.evaluate((source) => {
    const perf = (window as unknown as { __perf: Raw & { ready: (() => boolean) | null; armed: boolean } }).__perf;
    Object.assign(perf, { frames: [], longs: [], events: [], commits: [], inputAt: null, readyAt: null, armed: true });
    perf.ready = new Function(`return (${source});`) as () => boolean;
  }, ready);

const round = (value: number) => Math.round(value * 10) / 10;

export const collect = async (page: Page, settleMs: number) => {
  await page.waitForFunction(() => (window as unknown as { __perf: Raw }).__perf.readyAt !== null, null, { timeout: 30_000 });
  await page.waitForTimeout(settleMs);
  const raw = await page.evaluate(() => {
    const perf = (window as unknown as { __perf: Raw & { armed: boolean } }).__perf;
    perf.armed = false;
    return { frames: perf.frames, longs: perf.longs, events: perf.events, commits: perf.commits, inputAt: perf.inputAt, readyAt: perf.readyAt } satisfies Raw;
  });
  const from = raw.inputAt ?? raw.frames[0] ?? 0;
  const until = (raw.readyAt ?? from) + settleMs;
  const frames = raw.frames.filter((at) => at >= from && at <= until);
  const gaps = frames.slice(1).map((at, index) => at - (frames[index] ?? at));
  const longs = raw.longs.filter(([start, duration]) => start + duration >= from && start <= until);
  const events = raw.events.filter((event) => event.start >= from - 1 && event.start <= until);
  const worst = events.toSorted((a, b) => b.duration - a.duration)[0];
  const commits = raw.commits.filter(([at]) => at >= from && at <= until);
  const durations = commits.map(([, duration]) => duration).filter((duration): duration is number => duration !== null);
  return {
    inputToReady: raw.inputAt !== null && raw.readyAt !== null ? round(raw.readyAt - raw.inputAt) : null,
    inp: worst ? round(worst.duration) : null,
    inputDelay: worst ? round(worst.delay) : null,
    processing: worst ? round(worst.processing) : null,
    presentation: worst ? round(worst.presentation) : null,
    longTasks: longs.length,
    longTaskMs: round(longs.reduce((sum, [, duration]) => sum + duration, 0)),
    blockingMs: round(longs.reduce((sum, [, duration]) => sum + Math.max(0, duration - LONG_MS), 0)),
    frames: frames.length,
    dropped: gaps.filter((gap) => gap > DROP_MS).length,
    worstFrame: round(Math.max(0, ...gaps)),
    commits: commits.length,
    commitMs: durations.length > 0 ? round(durations.reduce((sum, duration) => sum + duration, 0)) : null,
    worstCommit: durations.length > 0 ? round(Math.max(...durations)) : null,
  } satisfies Sample;
};

const median = (values: number[]) => {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length === 0 ? 0 : sorted.length % 2 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

export const summarise = (samples: Sample[]) => {
  const keys = Object.keys(samples[0] ?? {}) as (keyof Sample)[];
  return Object.fromEntries(
    keys.map((key) => {
      const values = samples.map((sample) => sample[key]).filter((value): value is number => value !== null);
      return [key, values.length > 0 ? round(median(values)) : null];
    }),
  ) as Sample;
};

export type Result = { key: string; engine: string; interaction: string; cold: Sample | null; warm: Sample; runs: number };

export const record = (result: Result) => {
  mkdirSync(join(PERF_OUT, "results"), { recursive: true });
  writeFileSync(join(PERF_OUT, "results", `${result.key.replace(/[^a-z0-9-]+/gi, "_")}.json`), JSON.stringify(result, null, 2));
};

type Baseline = Record<string, { inputToReady: number | null; blockingMs: number; dropped: number; commitMs: number | null }>;

export const readBaseline = () => (existsSync(BASELINE) ? (JSON.parse(readFileSync(BASELINE, "utf8")) as Baseline) : {});

const SLACK = { ratio: 1.5, inputToReady: 40, blockingMs: 60, dropped: 3 };

export const regressions = (result: Result, baseline: Baseline) => {
  const saved = baseline[result.key];
  if (!saved) return [];
  const now = result.warm;
  const found: string[] = [];
  if (saved.inputToReady !== null && now.inputToReady !== null && now.inputToReady > saved.inputToReady * SLACK.ratio + SLACK.inputToReady)
    found.push(`input to ready ${now.inputToReady} ms, baseline ${saved.inputToReady} ms`);
  if (now.blockingMs > saved.blockingMs * SLACK.ratio + SLACK.blockingMs) found.push(`blocking ${now.blockingMs} ms, baseline ${saved.blockingMs} ms`);
  if (now.dropped > saved.dropped * SLACK.ratio + SLACK.dropped) found.push(`dropped ${now.dropped} frames, baseline ${saved.dropped}`);
  return found;
};

export const throttle = async (page: Page, rate: number) => {
  if (page.context().browser()?.browserType().name() !== "chromium" || rate <= 1) return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
};

export const traced = async (browser: Browser, page: Page, name: string, work: () => Promise<void>) => {
  if (browser.browserType().name() !== "chromium") return work();
  mkdirSync(join(PERF_OUT, "traces"), { recursive: true });
  const path = join(PERF_OUT, "traces", `${name.replace(/[^a-z0-9-]+/gi, "_")}.json`);
  await browser.startTracing(page, { path, screenshots: false, categories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "v8.execute", "blink.user_timing", "loading", "disabled-by-default-v8.cpu_profiler"] });
  try {
    await work();
  } finally {
    await browser.stopTracing();
  }
};
