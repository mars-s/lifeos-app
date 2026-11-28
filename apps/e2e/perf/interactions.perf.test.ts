import type { Page } from "@playwright/test";
import { expect, test as base } from "../src/app.fixture.ts";
import { arm, collect, INSTRUMENT, readBaseline, record, regressions, summarise, throttle, traced, type Sample } from "../src/perf.ts";

const RUNS = Number(process.env.E2E_PERF_RUNS ?? 5);
const THROTTLE = Number(process.env.E2E_THROTTLE ?? 4);
const SETTLE_MS = 1000;
const QUIET_MS = 3000;

const test = base.extend({
  context: async ({ context }, use) => {
    await context.addInitScript(INSTRUMENT);
    await use(context);
  },
});

const notLoading = `!document.querySelector('#main [role=status][aria-label="Loading…"]')`;
const PLANNER = {
  name: "planner",
  path: "/planner",
  ready: `document.title.startsWith("Planner") && ${notLoading} && !!document.querySelector('#main [role=group][aria-label=Days]') && !!document.querySelector('#main section[aria-label=Timebox]')`,
};
const LISTS = ["Inbox", "Today", "Upcoming", "Anytime", "Someday", "Logbook", "Trash"].map((title) => ({
  name: title.toLowerCase(),
  path: `/${title.toLowerCase()}`,
  ready: `document.title.startsWith(${JSON.stringify(title)}) && ${notLoading}`,
}));

type Tab = typeof PLANNER;

const link = (page: Page, tab: Tab) => page.locator(`nav[data-sidebar-mode] a[href="${tab.path}"]`).first();

const switchTo = async (page: Page, tab: Tab) => {
  await arm(page, tab.ready);
  await link(page, tab).click();
  return collect(page, SETTLE_MS);
};

const settleOn = async (page: Page, tab: Tab) => {
  await page.goto(tab.path);
  await page.waitForFunction((source) => new Function(`return (${source});`)() as boolean, tab.ready, { timeout: 30_000 });
  await page.waitForTimeout(QUIET_MS);
};

const engineOf = (page: Page) => page.context().browser()?.browserType().name() ?? "unknown";

const save = (page: Page, interaction: string, cold: Sample | null, warm: Sample[]) => {
  const engine = engineOf(page);
  const result = { key: `${engine}:${interaction}`, engine, interaction, cold, warm: summarise(warm), runs: warm.length };
  record(result);
  expect(regressions(result, readBaseline()), `${result.key} regressed against perf/baseline.json`).toEqual([]);
};

test.describe.configure({ mode: "serial" });

for (const from of LISTS)
  test(`switch ${from.name} to the Planner and back`, async ({ page, browser }) => {
    await throttle(page, THROTTLE);
    await settleOn(page, from);
    let cold: Sample | null = null;
    await traced(browser, page, `${engineOf(page)}-${from.name}-to-planner-cold`, async () => {
      cold = await switchTo(page, PLANNER);
    });
    const there: Sample[] = [];
    const back: Sample[] = [];
    for (let run = 0; run < RUNS; run += 1) {
      back.push(await switchTo(page, from));
      await page.waitForTimeout(300);
      there.push(await switchTo(page, PLANNER));
      await page.waitForTimeout(300);
    }
    await traced(browser, page, `${engineOf(page)}-${from.name}-to-planner-warm`, async () => {
      await switchTo(page, from);
      await page.waitForTimeout(300);
      there.push(await switchTo(page, PLANNER));
    });
    save(page, `${from.name} → planner`, cold, there);
    save(page, `planner → ${from.name}`, null, back);
  });

test("open a Task card", async ({ page, browser }) => {
  await throttle(page, THROTTLE);
  const today = LISTS[1];
  if (!today) throw new Error("no Today");
  await settleOn(page, today);
  const samples: Sample[] = [];
  const open = async () => {
    await arm(page, `!!document.querySelector('#main li[data-open-card]')`);
    await page.locator("#main [data-task-key] [data-arrow-item]").nth(2).dblclick();
    const sample = await collect(page, SETTLE_MS);
    await page.keyboard.press("Escape");
    await expect(page.locator("#main li[data-open-card]")).toHaveCount(0);
    await page.waitForTimeout(400);
    return sample;
  };
  const cold = await open();
  for (let run = 0; run < RUNS; run += 1) samples.push(await open());
  await traced(browser, page, `${engineOf(page)}-open-card`, async () => {
    samples.push(await open());
  });
  save(page, "open a Task card", cold, samples);
});

test("open the command bar", async ({ page }) => {
  await throttle(page, THROTTLE);
  const today = LISTS[1];
  if (!today) throw new Error("no Today");
  await settleOn(page, today);
  const samples: Sample[] = [];
  for (let run = 0; run <= RUNS; run += 1) {
    await arm(page, `!!document.querySelector('[cmdk-root]')`);
    await page.locator("#main").focus();
    await page.keyboard.press("ControlOrMeta+k");
    samples.push(await collect(page, SETTLE_MS));
    await page.keyboard.press("Escape");
    await expect(page.locator("[cmdk-root]")).toHaveCount(0);
    await page.waitForTimeout(300);
  }
  const [cold, ...warm] = samples;
  save(page, "open the command bar", cold ?? null, warm);
});

test("drag a Task to tomorrow in the Planner", async ({ page }) => {
  await throttle(page, THROTTLE);
  await settleOn(page, PLANNER);
  const columns = page.locator('#main [data-plan-list^="day:"]');
  const first = columns.nth(0);
  const second = columns.nth(1);
  const from = await first.getAttribute("data-plan-list");
  const to = await second.getAttribute("data-plan-list");
  const row = first.locator("[data-task-key]").first();
  const key = await row.getAttribute("data-task-key");
  if (!from || !to || !key) throw new Error("no Planner columns");
  const samples: Sample[] = [];
  const drag = async (target: string, here: string) => {
    const source = page.locator(`#main [data-plan-list="${here}"] [data-task-key="${key}"]`).first();
    const box = await source.boundingBox();
    const goal = await page.locator(`#main [data-plan-list="${target}"]`).first().boundingBox();
    if (!box || !goal) throw new Error("nothing to drag");
    await arm(page, `!!document.querySelector('#main [data-plan-list="${target}"] [data-task-key="${key}"]') && !document.querySelector('[data-dnd-overlay], .dnd-overlay')`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2, { steps: 4 });
    await page.mouse.move(goal.x + goal.width / 2, goal.y + 120, { steps: 20 });
    await page.mouse.up();
    samples.push(await collect(page, SETTLE_MS));
  };
  for (let run = 0; run < RUNS; run += 1) {
    await drag(to, from);
    await drag(from, to);
  }
  save(page, "drag a Task between days", null, samples);
});

test("type in a note", async ({ page }) => {
  await throttle(page, THROTTLE);
  await page.goto("/notes");
  await page.locator("nav[data-sidebar-mode=notes]").getByRole("button", { name: "New note" }).click();
  const editor = page.locator(".cm-content");
  await expect(editor).toBeVisible();
  await editor.click();
  await page.waitForTimeout(QUIET_MS);
  const samples: Sample[] = [];
  for (let run = 0; run < RUNS; run += 1) {
    const words = `Run ${run} typing a sentence into the note`;
    await arm(page, `document.querySelector('.cm-content')?.textContent?.includes(${JSON.stringify(words)})`);
    await page.keyboard.type(words, { delay: 40 });
    samples.push(await collect(page, SETTLE_MS));
    await page.keyboard.press("Enter");
  }
  save(page, "type in a note", null, samples);
});
