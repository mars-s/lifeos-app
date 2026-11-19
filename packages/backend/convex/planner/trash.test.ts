import { expect, test } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { newBackend, newSignedOutBackend, registerWorker, unwrap } from "../backend.test-utils";
import { rowsOf, thingsItem } from "./things.test-utils";

const DATE = "2026-11-18";

const setup = async () => {
  const t = await newBackend();
  const areaId = unwrap(await t.mutation(api.planner.areas.create, { title: "University" })).areaId;
  const projectId = unwrap(await t.mutation(api.planner.projects.create, { title: "Thesis", areaId })).projectId;
  const make = async (title: string, parent?: { kind: "area"; areaId: Id<"areas"> } | { kind: "project"; projectId: Id<"projects"> }) =>
    unwrap(await t.mutation(api.planner.tasks.create, { title, ...(parent ? { parent } : {}) })).taskId;
  const loose = await make("Book the dentist");
  const inArea = await make("Email supervisor", { kind: "area", areaId });
  const inProject = await make("Draft intro", { kind: "project", projectId });
  const rows = async () => (await t.query(api.planner.trash.list, {})).rows.map((row) => `${row.kind}:${row.title}`);
  const card = async (taskId: Id<"tasks">) => t.query(api.planner.tasks.card, { taskId });
  const sidebar = async () => unwrap(await t.query(api.planner.sidebar.get, { date: DATE }));
  return { t, areaId, projectId, loose, inArea, inProject, rows, card, sidebar };
};

test("Trash lists each trashed record once, newest first, with what went with it", async () => {
  const { t, areaId, loose, rows } = await setup();
  unwrap(await t.mutation(api.planner.selection.trash, { taskIds: [loose] }));
  unwrap(await t.mutation(api.planner.areas.trash, { areaId }));
  const view = await t.query(api.planner.trash.list, {});
  expect(await rows()).toEqual(["area:University", "task:Book the dentist"]);
  expect(view.rows[0]).toMatchObject({ kind: "area", projects: 1, tasks: 2 });
});

test("putting an Area back returns its Projects and Tasks, and one undo trashes them again", async () => {
  const { t, areaId, inArea, inProject, rows, card, sidebar } = await setup();
  unwrap(await t.mutation(api.planner.areas.trash, { areaId }));
  const { activityId } = unwrap(await t.mutation(api.planner.trash.restore, { items: [{ kind: "area", id: areaId }] }));
  expect(await rows()).toEqual([]);
  expect((await sidebar()).areas.map((area) => [area.title, area.projects.map((project) => project.title)])).toEqual([["University", ["Thesis"]]]);
  expect([(await card(inArea))?.trashedAt, (await card(inProject))?.trashedAt]).toEqual([undefined, undefined]);
  unwrap(await t.mutation(api.platform.undo.undo, { activityId: activityId! }));
  expect(await rows()).toEqual(["area:University"]);
});

test("a Task put back while its Project is still in Trash lands in the Project's Area", async () => {
  const { t, areaId, projectId, inProject, card } = await setup();
  unwrap(await t.mutation(api.planner.selection.trash, { taskIds: [inProject] }));
  unwrap(await t.mutation(api.planner.projects.trash, { projectId }));
  unwrap(await t.mutation(api.planner.trash.restore, { items: [{ kind: "task", id: inProject }] }));
  expect((await card(inProject))?.parent).toEqual({ kind: "area", areaId });
});

test("restore and delete refuse a record that is not in Trash and change nothing", async () => {
  const { t, loose, card } = await setup();
  expect(await t.mutation(api.planner.trash.restore, { items: [{ kind: "task", id: loose }] })).toMatchObject({ ok: false, error: { kind: "not_trashed" } });
  expect(await t.mutation(api.planner.trash.deleteForever, { items: [{ kind: "task", id: loose }] })).toMatchObject({ ok: false, error: { kind: "not_trashed" } });
  expect(await card(loose)).not.toBeNull();
});

test("delete forever removes a Task with its Checklist Items and cannot be undone", async () => {
  const { t, loose, card, rows } = await setup();
  const itemId = unwrap(await t.mutation(api.planner.checklist.add, { taskId: loose, title: "Find the number" })).itemId;
  unwrap(await t.mutation(api.planner.selection.trash, { taskIds: [loose] }));
  const { activityId } = unwrap(await t.mutation(api.planner.trash.deleteForever, { items: [{ kind: "task", id: loose }] }));
  expect(await card(loose)).toBeNull();
  expect(await t.run((ctx) => ctx.db.get("checklistItems", itemId))).toBeNull();
  expect(await rows()).toEqual([]);
  expect(await t.mutation(api.platform.undo.undo, { activityId: activityId! })).toMatchObject({ ok: false, error: { kind: "not_undoable", reason: "permanent" } });
});

test("deleting an Area forever deletes what was trashed with it and keeps a Task that was put back", async () => {
  const { t, areaId, projectId, inArea, inProject, card } = await setup();
  unwrap(await t.mutation(api.planner.areas.trash, { areaId }));
  unwrap(await t.mutation(api.planner.trash.restore, { items: [{ kind: "task", id: inArea }] }));
  unwrap(await t.mutation(api.planner.trash.deleteForever, { items: [{ kind: "area", id: areaId }] }));
  expect((await card(inArea))?.parent).toEqual({ kind: "loose" });
  expect(await card(inProject)).toBeNull();
  expect(await t.run((ctx) => ctx.db.get("projects", projectId))).toBeNull();
  expect(await t.run((ctx) => ctx.db.get("areas", areaId))).toBeNull();
});

test("Empty Trash clears everything in batches and leaves live records alone", async () => {
  const { t, areaId, loose, card, rows } = await setup();
  const kept = unwrap(await t.mutation(api.planner.tasks.create, { title: "Call Mum" })).taskId;
  unwrap(await t.mutation(api.planner.selection.trash, { taskIds: [loose] }));
  unwrap(await t.mutation(api.planner.areas.trash, { areaId }));
  let done = false;
  let passes = 0;
  while (!done && passes < 10) {
    done = unwrap(await t.mutation(api.planner.trash.empty, {})).done;
    passes += 1;
  }
  expect(done).toBe(true);
  expect(await rows()).toEqual([]);
  expect(await card(kept)).not.toBeNull();
  expect(await t.run(async (ctx) => (await ctx.db.query("areas").collect()).length)).toBe(0);
});

test("Trash is closed to a signed-out caller", async () => {
  const t = newSignedOutBackend();
  await expect(t.query(api.planner.trash.list, {})).rejects.toThrow();
  await expect(t.mutation(api.planner.trash.empty, {})).rejects.toThrow();
});

test("a Task deleted forever does not come back with the next Things Import", async () => {
  const { t, rows } = await setup();
  const token = await registerWorker(t, "things", ["things"]);
  const incoming = rowsOf({ items: [thingsItem("things-task-1", "From Things")] });
  unwrap(await t.action(api.planner.things.importRows, { token, rows: incoming }));
  const imported = await t.run(async (ctx) => (await ctx.db.query("tasks").withIndex("by_things_id", (q) => q.eq("things.id", "things-task-1")).unique())!);
  unwrap(await t.mutation(api.planner.selection.trash, { taskIds: [imported._id] }));
  unwrap(await t.mutation(api.planner.trash.deleteForever, { items: [{ kind: "task", id: imported._id }] }));
  unwrap(await t.action(api.planner.things.importRows, { token, rows: incoming }));
  expect(await rows()).toEqual([]);
  expect(await t.run(async (ctx) => (await ctx.db.query("tasks").withIndex("by_things_id", (q) => q.eq("things.id", "things-task-1")).collect()).length)).toBe(0);
});

test("deleting a Task forever also forgets its Smart Estimate, steps and Trip", async () => {
  const { t, loose } = await setup();
  await t.run(async (ctx) => {
    const at = Date.now();
    await ctx.db.insert("estimateSuggestions", { taskId: loose, requestedAt: at, outcome: { kind: "waiting" } });
    await ctx.db.insert("stepSuggestions", { taskId: loose, requestedAt: at, outcome: { kind: "waiting" } });
    await ctx.db.insert("taskTrips", { taskId: loose, requestedAt: at, outcome: { kind: "waiting", query: "dentist" }, choice: { kind: "nearest" } });
  });
  unwrap(await t.mutation(api.planner.selection.trash, { taskIds: [loose] }));
  unwrap(await t.mutation(api.planner.trash.deleteForever, { items: [{ kind: "task", id: loose }] }));
  const left = await t.run(async (ctx) => [
    (await ctx.db.query("estimateSuggestions").collect()).length,
    (await ctx.db.query("stepSuggestions").collect()).length,
    (await ctx.db.query("taskTrips").collect()).length,
  ]);
  expect(left).toEqual([0, 0, 0]);
});
