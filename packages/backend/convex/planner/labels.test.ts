import { expect, test } from "vitest";
import { api } from "../_generated/api";
import { drainJobs, newBackend, newSignedOutBackend, registerWorker, unwrap } from "../backend.test-utils";

const setup = async () => {
  const t = await newBackend();
  const things = await registerWorker(t, "things", ["things"]);
  const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Write chapter two" }));
  await drainJobs(t, things);
  const names = async () => (await t.query(api.planner.labels.list, {})).map(({ name, colour }) => [name, colour]);
  const onTask = async () => (await t.query(api.planner.tasks.card, { taskId }))!.labelIds;
  return { t, things, taskId, names, onTask };
};

test("Labels are created in order with one of the eight colours, and recoloured, each undoable, without telling Things", async () => {
  const { t, things, names } = await setup();
  const deep = unwrap(await t.mutation(api.planner.labels.create, { name: "  Deep Work ", colour: "violet" }));
  unwrap(await t.mutation(api.planner.labels.create, { name: "Admin", colour: "slate" }));
  expect(await names()).toEqual([
    ["Deep Work", "violet"],
    ["Admin", "slate"],
  ]);

  const recoloured = unwrap(await t.mutation(api.planner.labels.setColour, { labelId: deep.labelId, colour: "teal" }));
  expect(await names()).toEqual([
    ["Deep Work", "teal"],
    ["Admin", "slate"],
  ]);
  unwrap(await t.mutation(api.platform.undo.undo, { activityId: recoloured.activityId! }));
  unwrap(await t.mutation(api.platform.undo.undo, { activityId: deep.activityId! }));
  expect(await names()).toEqual([["Admin", "slate"]]);
  expect(await drainJobs(t, things)).toEqual([]);
});

test("creating a Label for a Task adds it to that Task in the same action, so one undo removes both", async () => {
  const { t, things, taskId, names, onTask } = await setup();
  const created = unwrap(await t.mutation(api.planner.labels.create, { name: "Errand", colour: "olive", taskId }));
  expect(await onTask()).toEqual([created.labelId]);
  expect((await drainJobs(t, things)).map(({ job }) => job.payload)).toMatchObject([
    { op: "update", set: { labelIds: [created.labelId] } },
  ]);

  unwrap(await t.mutation(api.platform.undo.undo, { activityId: created.activityId! }));
  expect(await onTask()).toEqual([]);
  expect(await names()).toEqual([]);
});

test("a Label name is used once: creating it again returns the Label that exists and keeps its colour", async () => {
  const { t, taskId, names, onTask } = await setup();
  const first = unwrap(await t.mutation(api.planner.labels.create, { name: "Admin", colour: "slate" }));
  const again = unwrap(await t.mutation(api.planner.labels.create, { name: "admin ", colour: "rose", taskId }));
  expect(again.labelId).toBe(first.labelId);
  expect(await names()).toEqual([["Admin", "slate"]]);
  expect(await onTask()).toEqual([first.labelId]);
});

test("a Label needs a name, a real colour, a real Task, and the owner", async () => {
  const { t, taskId } = await setup();
  expect(await t.mutation(api.planner.labels.create, { name: "  ", colour: "rose" })).toEqual({
    ok: false,
    error: { kind: "empty_title" },
  });
  await expect(t.mutation(api.planner.labels.create, { name: "Admin", colour: "pink" as never })).rejects.toThrow();
  const { labelId } = unwrap(await t.mutation(api.planner.labels.create, { name: "Admin", colour: "slate" }));
  await t.run((ctx) => ctx.db.delete("tasks", taskId));
  expect(await t.mutation(api.planner.labels.create, { name: "Errand", colour: "olive", taskId })).toEqual({
    ok: false,
    error: { kind: "not_found", table: "tasks", id: taskId },
  });
  expect((await t.query(api.planner.labels.list, {})).map(({ name }) => name)).toEqual(["Admin"]);

  const stranger = newSignedOutBackend();
  await expect(stranger.query(api.planner.labels.list, {})).rejects.toThrow();
  await expect(stranger.mutation(api.planner.labels.setColour, { labelId, colour: "rose" })).rejects.toThrow();
});
