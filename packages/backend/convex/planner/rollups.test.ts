import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { newBackend, unwrap, type Backend } from "../backend.test-utils";

const nineAm = Date.UTC(2026, 10, 18, 22, 0);
const minute = 60_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: nineAm });
});

afterEach(() => {
  vi.useRealTimers();
});

const inboxRow = async (t: Backend, taskId: Id<"tasks">) => {
  const { tasks } = await t.query(api.planner.lists.inbox, {});
  const row = tasks.find((task) => task._id === taskId);
  return row && { checklist: row.checklist.map((item) => item.title), workBlocks: row.workBlocks.length, focusMinutes: Math.round(row.focus.ms / minute) };
};

const progressOf = async (t: Backend, projectId: Id<"projects">) => {
  const sidebar = unwrap(await t.query(api.planner.sidebar.get, { date: "2026-11-19" }));
  return sidebar.projects.find((project) => project._id === projectId)?.progress;
};

test("a list row follows its Task's Checklist, Work Blocks and focused time, and Undo puts them back", async () => {
  const t = await newBackend();
  const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Write chapter two" }));
  expect(await inboxRow(t, taskId)).toEqual({ checklist: [], workBlocks: 0, focusMinutes: 0 });

  const { itemId } = unwrap(await t.mutation(api.planner.checklist.add, { taskId, title: "Outline" }));
  const { blockId } = unwrap(
    await t.mutation(api.planner.workBlocks.create, { taskId, start: nineAm + 60 * minute, minutes: 45, timeZone: "Australia/Sydney" }),
  );
  const { sessionId } = unwrap(await t.mutation(api.planner.focus.start, { taskId, plan: { kind: "open" } }));
  vi.setSystemTime(nineAm + 25 * minute);
  unwrap(await t.mutation(api.planner.focus.stop, { sessionId }));
  expect(await inboxRow(t, taskId)).toEqual({ checklist: ["Outline"], workBlocks: 1, focusMinutes: 25 });

  const removed = unwrap(await t.mutation(api.planner.checklist.remove, { itemId }));
  unwrap(await t.mutation(api.planner.workBlocks.remove, { blockId }));
  expect(await inboxRow(t, taskId)).toEqual({ checklist: [], workBlocks: 0, focusMinutes: 25 });

  unwrap(await t.mutation(api.platform.undo.undo, { activityId: removed.activityId! }));
  expect(await inboxRow(t, taskId)).toEqual({ checklist: ["Outline"], workBlocks: 0, focusMinutes: 25 });
});

test("a Project's progress follows its Tasks as they are added, done, moved out and trashed", async () => {
  const t = await newBackend();
  const { projectId } = unwrap(await t.mutation(api.planner.projects.create, { title: "Honours thesis" }));
  expect(await progressOf(t, projectId)).toEqual({ done: 0, total: 0 });
  const parent = { kind: "project", projectId } as const;
  const make = async (title: string) => unwrap(await t.mutation(api.planner.tasks.create, { title, parent })).taskId;
  const [outline, review, methods] = [await make("Outline"), await make("Literature review"), await make("Methods")];
  expect(await progressOf(t, projectId)).toEqual({ done: 0, total: 3 });

  unwrap(await t.mutation(api.planner.tasks.complete, { taskId: outline }));
  expect(await progressOf(t, projectId)).toEqual({ done: 1, total: 3 });

  const moved = unwrap(await t.mutation(api.planner.tasks.move, { taskId: review, parent: { kind: "loose" } }));
  unwrap(await t.mutation(api.planner.tasks.trash, { taskId: methods }));
  expect(await progressOf(t, projectId)).toEqual({ done: 1, total: 1 });

  unwrap(await t.mutation(api.platform.undo.undo, { activityId: moved.activityId! }));
  expect(await progressOf(t, projectId)).toEqual({ done: 1, total: 2 });
});

test("the backfill gives Tasks and Projects written before the summaries the same rows and progress", async () => {
  vi.useFakeTimers({ now: nineAm });
  const t = await newBackend();
  const { taskId, projectId } = await t.run(async (ctx) => {
    const japanId = await ctx.db.insert("projects", {
      title: "Japan trip",
      notes: "",
      when: { kind: "anytime" },
      labelIds: [],
      status: { kind: "open" },
      order: "a0",
    });
    const fields = { notes: "", when: { kind: "inbox" as const }, labelIds: [], order: "a0" };
    const parent = { kind: "project", projectId: japanId } as const;
    const flightsId = await ctx.db.insert("tasks", { ...fields, title: "Book flights", parent, status: { kind: "open" } });
    await ctx.db.insert("tasks", { ...fields, title: "Renew passport", parent, status: { kind: "completed", at: nineAm } });
    await ctx.db.insert("checklistItems", { taskId: flightsId, title: "Compare fares", done: false, order: "a0" });
    await ctx.db.insert("workBlocks", { taskId: flightsId, start: nineAm, minutes: 30, timeZone: "Australia/Sydney", done: false });
    return { taskId: flightsId, projectId: japanId };
  });
  const before = await inboxRow(t, taskId);
  expect(before).toEqual({ checklist: ["Compare fares"], workBlocks: 1, focusMinutes: 0 });
  expect(await progressOf(t, projectId)).toEqual({ done: 1, total: 2 });

  await t.mutation(internal.planner.rollups.backfill, { table: "tasks" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  const [task, project] = await t.run(async (ctx) => [await ctx.db.get(taskId), await ctx.db.get(projectId)] as const);
  expect(task?.rollup).toEqual({ checklistItems: 1, workBlocks: 1, focusSessions: 0 });
  expect(project?.progress).toEqual({ done: 1, total: 2 });
  expect(await inboxRow(t, taskId)).toEqual(before);
  expect(await progressOf(t, projectId)).toEqual({ done: 1, total: 2 });
});
