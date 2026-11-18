import { generateKeyBetween } from "fractional-indexing";
import { expect, test } from "vitest";
import { api } from "../_generated/api";
import { drainJobs, newBackend, registerWorker, unwrap } from "../backend.test-utils";

const setup = async () => {
  const t = await newBackend();
  const things = await registerWorker(t, "things", ["things"]);
  const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Pack for Hobart" }));
  await drainJobs(t, things);
  const checklist = async () => (await t.query(api.planner.tasks.card, { taskId }))!.checklist;
  return { t, things, taskId, checklist };
};

test("Checklist Items are added in order, edited, ticked and reordered, each undoable, and never reach Things", async () => {
  const { t, things, taskId, checklist } = await setup();
  const added = unwrap(await t.mutation(api.planner.checklist.add, { taskId, title: "Charger" }));
  const second = unwrap(await t.mutation(api.planner.checklist.add, { taskId, title: "Raincoat" }));
  expect((await checklist()).map(({ title, done }) => [title, done])).toEqual([
    ["Charger", false],
    ["Raincoat", false],
  ]);

  const edited = unwrap(await t.mutation(api.planner.checklist.edit, { itemId: added.itemId, title: "Laptop charger" }));
  const ticked = unwrap(await t.mutation(api.planner.checklist.tick, { itemId: added.itemId, done: true }));
  const [first] = await checklist();
  const reordered = unwrap(
    await t.mutation(api.planner.checklist.reorder, { itemId: second.itemId, order: generateKeyBetween(null, first!.order) }),
  );
  expect((await checklist()).map(({ title, done }) => [title, done])).toEqual([
    ["Raincoat", false],
    ["Laptop charger", true],
  ]);

  for (const { activityId } of [reordered, ticked, edited]) {
    unwrap(await t.mutation(api.platform.undo.undo, { activityId: activityId! }));
  }
  expect((await checklist()).map(({ title, done }) => [title, done])).toEqual([
    ["Charger", false],
    ["Raincoat", false],
  ]);
  unwrap(await t.mutation(api.platform.undo.undo, { activityId: second.activityId! }));
  expect((await checklist()).map(({ title }) => title)).toEqual(["Charger"]);
  expect(await drainJobs(t, things)).toEqual([]);
});

test("a Checklist Item needs a Task, a title and a valid order key", async () => {
  const { t, taskId } = await setup();
  const { itemId } = unwrap(await t.mutation(api.planner.checklist.add, { taskId, title: "Charger" }));
  expect(await t.mutation(api.planner.checklist.add, { taskId, title: " " })).toEqual({
    ok: false,
    error: { kind: "empty_title" },
  });
  expect(await t.mutation(api.planner.checklist.reorder, { itemId, order: "" })).toEqual({
    ok: false,
    error: { kind: "invalid_order", order: "" },
  });
});
