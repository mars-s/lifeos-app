import { expect, test } from "vitest";
import { api } from "../_generated/api";
import { newBackend, newSignedOutBackend, unwrap } from "../backend.test-utils";

const setup = async () => {
  const t = await newBackend();
  const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Write chapter two" }));
  const names = async () => (await t.query(api.planner.labels.list, {})).map(({ name, colour }) => [name, colour]);
  const onTask = async () => (await t.query(api.planner.tasks.card, { taskId }))!.labelIds;
  return { t, taskId, names, onTask };
};

test("Labels are created in order with one of the eight colours, and recoloured, each undoable", async () => {
  const { t, names } = await setup();
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
});

test("creating a Label for a Task adds it to that Task in the same action, so one undo removes both", async () => {
  const { t, taskId, names, onTask } = await setup();
  const created = unwrap(await t.mutation(api.planner.labels.create, { name: "Errand", colour: "olive", taskId }));
  expect(await onTask()).toEqual([created.labelId]);

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

test("a Label renames, refuses a name another Label holds, and undo puts the old name back", async () => {
  const t = await newBackend();
  const admin = unwrap(await t.mutation(api.planner.labels.create, { name: "Admin", colour: "slate" })).labelId;
  unwrap(await t.mutation(api.planner.labels.create, { name: "Deep Work", colour: "violet" }));
  expect(await t.mutation(api.planner.labels.rename, { labelId: admin, name: "deep work" })).toMatchObject({ ok: false, error: { kind: "name_taken" } });
  const { activityId } = unwrap(await t.mutation(api.planner.labels.rename, { labelId: admin, name: " Paperwork " }));
  expect((await t.query(api.planner.labels.list, {})).map((label) => label.name)).toEqual(["Paperwork", "Deep Work"]);
  unwrap(await t.mutation(api.platform.undo.undo, { activityId: activityId! }));
  expect((await t.query(api.planner.labels.list, {})).map((label) => label.name)).toEqual(["Admin", "Deep Work"]);
});

test("removing a Label takes it off open Tasks and is permanent", async () => {
  const t = await newBackend();
  const taskId = unwrap(await t.mutation(api.planner.tasks.create, { title: "File the return" })).taskId;
  const admin = unwrap(await t.mutation(api.planner.labels.create, { name: "Admin", colour: "slate", taskId })).labelId;
  const { activityId, stripped } = unwrap(await t.mutation(api.planner.labels.remove, { labelId: admin }));
  expect(stripped).toBe(1);
  expect(await t.query(api.planner.labels.list, {})).toEqual([]);
  expect((await t.query(api.planner.tasks.card, { taskId }))?.labelIds).toEqual([]);
  expect(await t.mutation(api.platform.undo.undo, { activityId: activityId! })).toMatchObject({ ok: false, error: { kind: "not_undoable" } });
});
