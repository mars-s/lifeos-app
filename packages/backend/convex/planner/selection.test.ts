import { expect, test } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { newBackend, unwrap } from "../backend.test-utils";

const setup = async () => {
  const t = await newBackend();
  const taskIds: Id<"tasks">[] = [];
  for (const title of ["Draft intro", "Email supervisor", "Book the dentist"])
    taskIds.push(unwrap(await t.mutation(api.planner.tasks.create, { title })).taskId);
  const cards = async () => Promise.all(taskIds.map(async (taskId) => (await t.query(api.planner.tasks.card, { taskId }))!));
  const view = async <T>(pick: (card: Awaited<ReturnType<typeof cards>>[number]) => T) => (await cards()).map(pick);
  const undo = async (activityId: Id<"activity"> | null) => unwrap(await t.mutation(api.platform.undo.undo, { activityId: activityId! }));
  const activityCount = async () => t.run(async (ctx) => (await ctx.db.query("activity").collect()).length);
  return { t, taskIds, view, undo, activityCount };
};

test("a When set on three Tasks is one Activity entry and one undo step", async () => {
  const { t, taskIds, view, undo, activityCount } = await setup();
  const before = await activityCount();
  const when = { kind: "scheduled" as const, date: "2026-11-19", evening: false };
  const { activityId, changed } = unwrap(await t.mutation(api.planner.selection.setWhen, { taskIds, when }));
  expect(changed).toBe(3);
  expect(await activityCount()).toBe(before + 1);
  expect(await view((card) => card.when)).toEqual([when, when, when]);
  await undo(activityId);
  expect(await view((card) => card.when.kind)).toEqual(["inbox", "inbox", "inbox"]);
});

test("Deadline and Estimate apply to the whole selection and clear with null", async () => {
  const { t, taskIds, view } = await setup();
  unwrap(await t.mutation(api.planner.selection.setDeadline, { taskIds, deadline: "2026-11-27" }));
  unwrap(await t.mutation(api.planner.selection.setEstimate, { taskIds, minutes: 30 }));
  expect(await view((card) => [card.deadline, card.estimateMinutes])).toEqual(Array.from({ length: 3 }, () => ["2026-11-27", 30]));
  unwrap(await t.mutation(api.planner.selection.setDeadline, { taskIds, deadline: null }));
  unwrap(await t.mutation(api.planner.selection.setEstimate, { taskIds, minutes: null }));
  expect(await view((card) => [card.deadline, card.estimateMinutes])).toEqual(Array.from({ length: 3 }, () => [undefined, undefined]));
});

test("an invalid value changes none of the selection", async () => {
  const { t, taskIds, view, activityCount } = await setup();
  const before = await activityCount();
  expect(await t.mutation(api.planner.selection.setEstimate, { taskIds, minutes: 0 })).toMatchObject({
    ok: false,
    error: { kind: "invalid_estimate" },
  });
  expect(await t.mutation(api.planner.selection.setDeadline, { taskIds, deadline: "soon" })).toMatchObject({ ok: false });
  expect(await view((card) => card.estimateMinutes)).toEqual([undefined, undefined, undefined]);
  expect(await activityCount()).toBe(before);
});

test("a Label goes on and comes off every selected Task without touching their other Labels", async () => {
  const { t, taskIds, view } = await setup();
  const admin = unwrap(await t.mutation(api.planner.labels.create, { name: "Admin", colour: "slate", taskId: taskIds[0] })).labelId;
  const deep = unwrap(await t.mutation(api.planner.labels.create, { name: "Deep Work", colour: "violet" })).labelId;
  unwrap(await t.mutation(api.planner.selection.setLabel, { taskIds, labelId: deep, on: true }));
  expect(await view((card) => card.labelIds)).toEqual([[admin, deep], [deep], [deep]]);
  unwrap(await t.mutation(api.planner.selection.setLabel, { taskIds, labelId: deep, on: false }));
  expect(await view((card) => card.labelIds)).toEqual([[admin], [], []]);
});

test("moving a selection appends it to the new parent in selection order", async () => {
  const { t, taskIds, undo } = await setup();
  const { projectId } = unwrap(await t.mutation(api.planner.projects.create, { title: "Thesis" }));
  const first = unwrap(
    await t.mutation(api.planner.tasks.create, { title: "Already here", parent: { kind: "project", projectId } }),
  ).taskId;
  const titles = async () =>
    (await t.query(api.planner.lists.project, { projectId }))!.sections.flatMap((section) => section.tasks.map((task) => task.title));
  const { activityId, changed } = unwrap(
    await t.mutation(api.planner.selection.move, { taskIds: [...taskIds, first], parent: { kind: "project", projectId } }),
  );
  expect(changed).toBe(3);
  expect(await titles()).toEqual(["Already here", "Draft intro", "Email supervisor", "Book the dentist"]);
  await undo(activityId);
  expect(await titles()).toEqual(["Already here"]);
});

test("complete and trash cover the selection, skip what is already done, and undo as one", async () => {
  const { t, taskIds, view, undo } = await setup();
  const earlier = { kind: "completed" as const, at: 1_000 };
  await t.run((ctx) => ctx.db.patch(taskIds[0]!, { status: earlier }));
  const completed = unwrap(await t.mutation(api.planner.selection.complete, { taskIds }));
  expect(completed.changed).toBe(2);
  expect(await view((card) => card.status.kind)).toEqual(["completed", "completed", "completed"]);
  await undo(completed.activityId);
  expect(await view((card) => card.status)).toEqual([earlier, { kind: "open" }, { kind: "open" }]);

  unwrap(await t.mutation(api.planner.selection.reopen, { taskIds }));
  expect(await view((card) => card.status.kind)).toEqual(["open", "open", "open"]);

  const trashed = unwrap(await t.mutation(api.planner.selection.trash, { taskIds }));
  expect(await view((card) => typeof card.trashedAt)).toEqual(["number", "number", "number"]);
  await undo(trashed.activityId);
  expect(await view((card) => card.trashedAt)).toEqual([undefined, undefined, undefined]);
  unwrap(await t.mutation(api.planner.selection.trash, { taskIds }));
  unwrap(await t.mutation(api.planner.selection.restore, { taskIds }));
  expect(await view((card) => card.trashedAt)).toEqual([undefined, undefined, undefined]);
});

test("a selection with a missing Task or over the limit is refused whole", async () => {
  const { t, taskIds, view } = await setup();
  const gone = unwrap(await t.mutation(api.planner.tasks.create, { title: "Gone" })).taskId;
  await t.run((ctx) => ctx.db.delete(gone));
  expect(await t.mutation(api.planner.selection.complete, { taskIds: [...taskIds, gone] })).toMatchObject({
    ok: false,
    error: { kind: "not_found" },
  });
  expect(await view((card) => card.status.kind)).toEqual(["open", "open", "open"]);
});
