import { expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { newBackend, unwrap, type Backend } from "../backend.test-utils";
import { zonedMoment } from "../calendar/model";
import type { IsoDate } from "../../shared/date";

const ZONE = "Australia/Sydney";
const DATE = "2030-03-12";
const caller = { userId: "owner", scopes: ["lifeos:read", "lifeos:write"], connectionId: "claude" };

const setup = async () => {
  const t = await newBackend();
  const { areaId } = unwrap(await t.mutation(api.planner.areas.create, { title: "University" }));
  unwrap(await t.mutation(api.planner.labels.create, { name: "Deep Work", colour: "violet" }));
  const task = async (title: string, estimateMinutes: number) =>
    unwrap(await t.mutation(api.planner.tasks.create, { title, when: { kind: "anytime" }, estimateMinutes })).taskId;
  return { t, areaId, task };
};

const create = (t: Backend, args: { title?: string; start?: string; end?: string; date?: string; areaIds?: string[]; labels?: string[]; repeat?: { schedule: { kind: "weekdays" }; until?: string } }) =>
  t.mutation(internal.planner.agentSmartBlocks.createSmartBlock, { title: "Focus", start: "16:00", end: "18:00", date: DATE, timeZone: ZONE, caller, ...args });

const list = (t: Backend, args: { date?: string; days?: number } = {}) =>
  t.query(internal.planner.agentSmartBlocks.listSmartBlocks, { date: DATE, timeZone: ZONE, caller, ...args });

const preview = (t: Backend, blockId: string, args: { exclude?: string[]; prefer?: string[]; timeZone?: string } = {}) =>
  t.query(internal.planner.agentSmartBlocks.previewFill, { blockId, date: DATE, caller, ...args });

const accept = (t: Backend, blockId: string) => t.mutation(internal.planner.agentSmartBlocks.acceptFill, { blockId, date: DATE, timeZone: ZONE, caller });

test("start and end take HH:mm up to 24:00, and anything else is refused with a hint", async () => {
  const { t } = await setup();
  for (const time of ["25:00", "24:30", "9:60", "nine", "16", "16:0"]) await expect(create(t, { end: time })).rejects.toThrow(`"${time}" is not a time`);
  const late = await create(t, { start: " 22:00 ", end: "24:00" });
  const [shown] = (await list(t)).smartBlocks.filter((each) => each.blockId === late.blockId);
  expect(shown).toMatchObject({ start: "2030-03-12T22:00+11:00", end: "2030-03-13T00:00+11:00" });
  await expect(create(t, { start: "9:05", end: "9:15" })).rejects.toThrow("at least 15 minutes");
});

test("Labels are found by name, and a missing Label or a bad Area id is refused", async () => {
  const { t, areaId } = await setup();
  await expect(create(t, { labels: ["Deep Work", "Errands", "Calls"] })).rejects.toThrow('No Label is named "Errands", "Calls"');
  await expect(create(t, { areaIds: ["nothing"] })).rejects.toThrow('No Area has the id "nothing"');
  const { blockId } = await create(t, { labels: ["Deep Work"], areaIds: [areaId] });
  const [shown] = (await list(t)).smartBlocks;
  expect(shown?.blockId).toBe(blockId);
  expect(shown?.filter.areaIds).toEqual([areaId]);
  expect(shown?.filter.labelIds).toHaveLength(1);
});

test("listing covers one to fourteen days and says how a series repeats and ends", async () => {
  const { t } = await setup();
  await create(t, { date: "2030-03-11", repeat: { schedule: { kind: "weekdays" }, until: "2030-04-30" } });
  expect((await list(t, { days: 0 })).smartBlocks.map((each) => each.date)).toEqual([DATE]);
  const fortnight = (await list(t, { days: 40 })).smartBlocks;
  expect(fortnight).toHaveLength(10);
  expect(fortnight.at(-1)?.date).toBe("2030-03-25");
  expect(fortnight[0]?.repeats).toMatch(/2030-04-30|30 Apr/);
  await create(t, { title: "Once", date: "2030-03-13" });
  expect((await list(t, { date: "2030-03-13" })).smartBlocks.find((each) => each.title === "Once")?.repeats).toBeUndefined();
});

test("a fill freeing a done Task's Work Block is accepted with nothing new to add", async () => {
  const { t, task } = await setup();
  const done = await task("Slides", 30);
  const { blockId } = await create(t, {});
  const first = await accept(t, blockId);
  expect(first.plan.add.map((each) => each.title)).toEqual(["Slides"]);
  expect((await list(t)).smartBlocks[0]?.filledWorkBlocks).toBe(1);
  unwrap(await t.mutation(api.planner.selection.complete, { taskIds: [done] }));
  const freed = await accept(t, blockId);
  expect(freed.plan.add).toEqual([]);
  expect(freed.plan.release).toHaveLength(1);
  expect((await list(t)).smartBlocks[0]?.filledWorkBlocks).toBe(0);
  await expect(accept(t, blockId)).rejects.toThrow("Nothing new fits");
});

test("a preview takes exclude and prefer, and shows times in the zone asked for", async () => {
  const { t, task } = await setup();
  const first = await task("First", 30);
  const second = await task("Second", 30);
  const { blockId } = await create(t, {});
  const plan = await preview(t, blockId, { exclude: [first], prefer: [second], timeZone: "Australia/Perth" });
  expect(plan.add.map((each) => [each.taskId, each.reason, each.start])).toEqual([[second, "Your pick", "2030-03-12T13:00+08:00"]]);
  expect(plan.window).toEqual({ start: "2030-03-12T13:00+08:00", end: "2030-03-12T15:00+08:00" });
  expect((await preview(t, blockId)).window.start).toBe("2030-03-12T16:00+11:00");
});

test("a removed or unknown Smart Block, or the Feature off, is refused", async () => {
  const { t } = await setup();
  const { blockId } = await create(t, {});
  await expect(preview(t, "nothing")).rejects.toThrow('No Smart Block has the id "nothing"');
  unwrap(await t.mutation(api.planner.smartBlocks.remove, { blockId: blockId as Id<"smartBlocks"> }));
  await expect(preview(t, blockId)).rejects.toThrow(`No Smart Block has the id "${blockId}"`);
  await expect(accept(t, blockId)).rejects.toThrow("No Smart Block has the id");
  unwrap(await t.mutation(api.platform.features.setEnabled, { feature: "smartBlocks", enabled: false }));
  await expect(preview(t, blockId)).rejects.toThrow("switched off");
  await expect(accept(t, blockId)).rejects.toThrow("switched off");
});

test("an accepted fill lands inside the block on the day asked for", async () => {
  const { t, task } = await setup();
  await task("Draft", 45);
  const { blockId } = await create(t, {});
  await accept(t, blockId);
  const rows = await t.run((ctx) => ctx.db.query("workBlocks").collect());
  expect(rows.map((row) => [row.start, row.minutes, row.smartBlock])).toEqual([[zonedMoment(DATE as IsoDate, 16 * 60, ZONE), 45, { blockId, date: DATE }]]);
});
