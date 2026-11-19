import { expect, test } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { newBackend, unwrap, type Backend } from "../backend.test-utils";

const TABLES = ["projects", "tasks", "checklistItems", "workBlocks", "focusSessions", "entityLinks"] as const;

const snapshot = (t: Backend) =>
  t.run(async (ctx) => Object.fromEntries(await Promise.all(TABLES.map(async (table) => [table, await ctx.db.query(table).collect()]))));

const setup = async () => {
  const t = await newBackend();
  const { areaId, labelId } = await t.run(async (ctx) => ({
    areaId: await ctx.db.insert("areas", { title: "University", colour: "teal", order: "a0" }),
    labelId: await ctx.db.insert("labels", { name: "Deep Work", colour: "violet", order: "a0" }),
  }));
  const { taskId } = unwrap(
    await t.mutation(api.planner.tasks.create, {
      title: "Write the thesis",
      notes: "Chapter by chapter.",
      when: { kind: "scheduled", date: "2026-11-20", evening: false },
      deadline: "2026-12-18",
      estimateMinutes: 600,
      parent: { kind: "area", areaId },
      labelIds: [labelId],
    }),
  );
  return { t, areaId, labelId, taskId };
};

const addHistory = (t: Backend, taskId: Id<"tasks">) =>
  t.run(async (ctx) => {
    const otherId = await ctx.db.insert("tasks", {
      title: "Book the library room",
      notes: "",
      when: { kind: "anytime" },
      parent: { kind: "loose" },
      labelIds: [],
      status: { kind: "open" },
      order: "a0",
    });
    return {
      blockId: await ctx.db.insert("workBlocks", {
        taskId,
        start: Date.parse("2026-11-20T09:00:00+11:00"),
        minutes: 90,
        timeZone: "Australia/Sydney",
        done: false,
      }),
      sessionId: await ctx.db.insert("focusSessions", {
        taskId,
        kind: "focus",
        start: Date.now(),
        pausedMs: 0,
        state: { kind: "running" },
      }),
      linkId: await ctx.db.insert("entityLinks", { from: { table: "tasks", id: otherId }, to: { table: "tasks", id: taskId } }),
    };
  });

const projectTasks = (t: Backend, projectId: Id<"projects">) =>
  t.run((ctx) =>
    ctx.db
      .query("tasks")
      .withIndex("by_project_order", (q) => q.eq("parent.projectId", projectId))
      .collect(),
  );

test("converting a Task makes a Project from it, turns its Checklist into Tasks and trashes it, and Undo puts it all back", async () => {
  const { t, areaId, labelId, taskId } = await setup();
  for (const title of ["Outline", "Literature review", "Methods"]) unwrap(await t.mutation(api.planner.checklist.add, { taskId, title }));
  const items = await t.run((ctx) => ctx.db.query("checklistItems").collect());
  unwrap(await t.mutation(api.planner.checklist.tick, { itemId: items[0]!._id, done: true }));
  const { blockId, sessionId, linkId } = await addHistory(t, taskId);
  const before = await snapshot(t);

  const { projectId, taskIds, activityId } = unwrap(await t.mutation(api.planner.convert.toProject, { taskId }));

  expect(await t.run((ctx) => ctx.db.get(projectId))).toMatchObject({
    title: "Write the thesis",
    notes: "Chapter by chapter.",
    areaId,
    when: { kind: "scheduled", date: "2026-11-20", evening: false },
    deadline: "2026-12-18",
    labelIds: [labelId],
    status: { kind: "open" },
  });
  const steps = await projectTasks(t, projectId);
  expect(steps.map((task) => task._id)).toEqual(taskIds);
  expect(steps.map(({ title, status }) => [title, status.kind])).toEqual([
    ["Outline", "completed"],
    ["Literature review", "open"],
    ["Methods", "open"],
  ]);
  const carrier = taskIds[1];
  expect(await t.run((ctx) => ctx.db.get(blockId))).toMatchObject({ taskId: carrier });
  expect(await t.run((ctx) => ctx.db.get(sessionId))).toMatchObject({ taskId: carrier, state: { kind: "running" } });
  expect(await t.run((ctx) => ctx.db.get(linkId))).toMatchObject({ to: { table: "tasks", id: carrier } });
  expect((await t.run((ctx) => ctx.db.get(taskId)))?.trashedAt).toEqual(expect.any(Number));
  expect(await t.run((ctx) => ctx.db.query("activity").collect())).toEqual(
    expect.arrayContaining([expect.objectContaining({ _id: activityId, action: "task.convertToProject" })]),
  );

  unwrap(await t.mutation(api.platform.undo.undo, { activityId: activityId! }));

  expect(await snapshot(t)).toEqual(before);
});

test("a Task with no Checklist but planned time gets one Task in the Project to carry it", async () => {
  const { t, taskId } = await setup();
  const { blockId } = await addHistory(t, taskId);

  const { projectId, taskIds } = unwrap(await t.mutation(api.planner.convert.toProject, { taskId }));

  expect((await projectTasks(t, projectId)).map(({ title }) => title)).toEqual(["Write the thesis"]);
  expect(await t.run((ctx) => ctx.db.get(blockId))).toMatchObject({ taskId: taskIds[0] });
});

test("a bare Task in the Inbox becomes an empty Project in Anytime", async () => {
  const t = await newBackend();
  const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Plan the Japan trip" }));
  const before = await snapshot(t);

  const { projectId, taskIds, activityId } = unwrap(await t.mutation(api.planner.convert.toProject, { taskId }));

  expect(taskIds).toEqual([]);
  expect(await t.run((ctx) => ctx.db.get(projectId))).toMatchObject({ when: { kind: "anytime" } });
  expect((await t.run((ctx) => ctx.db.get(projectId)))?.areaId).toBeUndefined();
  unwrap(await t.mutation(api.platform.undo.undo, { activityId: activityId! }));
  expect(await snapshot(t)).toEqual(before);
});

test("a later change to a new Task blocks Undo instead of losing it", async () => {
  const { t, taskId } = await setup();
  unwrap(await t.mutation(api.planner.checklist.add, { taskId, title: "Outline" }));
  const { taskIds, activityId } = unwrap(await t.mutation(api.planner.convert.toProject, { taskId }));
  unwrap(await t.mutation(api.planner.tasks.rename, { taskId: taskIds[0]!, title: "Outline every chapter" }));

  expect(await t.mutation(api.platform.undo.undo, { activityId: activityId! })).toMatchObject({
    ok: false,
    error: { kind: "changed_since" },
  });
});
