import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx } from "../_generated/server";
import { MINUTE_MS, focusedMs } from "../../shared/focus";
import { vProgress, vTaskRollup } from "./tables";

export const CHECKLIST_LIMIT = 100;
export const WORK_BLOCK_LIMIT = 100;
export const FOCUS_LIMIT = 300;
const PROJECT_TASK_LIMIT = 1000;
const BACKFILL_BATCH = 100;
const BACKFILL_PAUSE_MS = 500;

export type TaskRollup = typeof vTaskRollup.type;

export type Progress = typeof vProgress.type;

export const checklistOf = (ctx: QueryCtx, taskId: Id<"tasks">) =>
  ctx.db
    .query("checklistItems")
    .withIndex("by_task_order", (q) => q.eq("taskId", taskId))
    .take(CHECKLIST_LIMIT);

export const workBlocksOf = (ctx: QueryCtx, taskId: Id<"tasks">) =>
  ctx.db
    .query("workBlocks")
    .withIndex("by_task_start", (q) => q.eq("taskId", taskId))
    .take(WORK_BLOCK_LIMIT);

export const focusSessionsOf = (ctx: QueryCtx, taskId: Id<"tasks">) =>
  ctx.db
    .query("focusSessions")
    .withIndex("by_task_start", (q) => q.eq("taskId", taskId))
    .order("desc")
    .take(FOCUS_LIMIT);

export const liveBlocks = (blocks: Doc<"workBlocks">[]) => blocks.filter((block) => block.removedAt === undefined);

export const countedSessions = (sessions: Doc<"focusSessions">[]) =>
  sessions.flatMap(({ _id, kind, start, state, removedAt, ...clock }) => {
    if (kind !== "focus" || state.kind !== "ended" || removedAt !== undefined) return [];
    const ms = focusedMs({ ...clock, start, state }, state.at);
    return ms >= MINUTE_MS ? [{ _id, start, end: state.at, ms }] : [];
  });

const rollupOf = async (ctx: QueryCtx, taskId: Id<"tasks">) => {
  const [items, blocks, sessions] = await Promise.all([checklistOf(ctx, taskId), workBlocksOf(ctx, taskId), focusSessionsOf(ctx, taskId)]);
  return {
    checklistItems: items.length,
    workBlocks: liveBlocks(blocks).length,
    focusSessions: countedSessions(sessions).length,
  } satisfies TaskRollup;
};

export const tasksOfProject = async (ctx: QueryCtx, projectId: Id<"projects">) =>
  (
    await ctx.db
      .query("tasks")
      .withIndex("by_project_order", (q) => q.eq("parent.projectId", projectId))
      .take(PROJECT_TASK_LIMIT)
  ).filter((task) => task.trashedAt === undefined);

export const progressOf = (tasks: Doc<"tasks">[]) =>
  ({ done: tasks.filter((task) => task.status.kind !== "open").length, total: tasks.length }) satisfies Progress;

export type Touched = { tasks: Set<Id<"tasks">>; projects: Set<Id<"projects">> };

export const nothingTouched = () => ({ tasks: new Set<Id<"tasks">>(), projects: new Set<Id<"projects">>() }) satisfies Touched;

type Fields = Record<string, unknown>;

const sameFields = <T extends Record<string, number>>(a: T | undefined, b: T) =>
  a !== undefined && Object.keys(b).every((key) => a[key] === b[key]);

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const CHILD_TABLES = new Set(["checklistItems", "workBlocks", "focusSessions"]);
const PROGRESS_KEYS = ["status", "parent", "trashedAt"];

const projectOf = (task: Fields | null) => {
  const parent = task?.parent as Doc<"tasks">["parent"] | undefined;
  return parent?.kind === "project" ? parent.projectId : undefined;
};

export const noteWrite = (touched: Touched, table: string, id: string, before: Fields | null, after: Fields | null) => {
  if (CHILD_TABLES.has(table)) {
    for (const doc of [before, after]) if (doc?.taskId) touched.tasks.add(doc.taskId as Id<"tasks">);
  }
  if (table === "tasks") {
    if (before === null) touched.tasks.add(id as Id<"tasks">);
    const moves = before === null || after === null || PROGRESS_KEYS.some((key) => !sameJson(before[key], after[key]));
    if (moves) for (const projectId of [projectOf(before), projectOf(after)]) if (projectId) touched.projects.add(projectId);
  }
  if (table === "projects" && before === null) touched.projects.add(id as Id<"projects">);
};

const settleTask = async (ctx: MutationCtx, taskId: Id<"tasks">) => {
  const task = await ctx.db.get("tasks", taskId);
  if (!task) return;
  const rollup = await rollupOf(ctx, taskId);
  if (!sameFields(task.rollup, rollup)) await ctx.db.patch("tasks", taskId, { rollup });
};

const settleProject = async (ctx: MutationCtx, projectId: Id<"projects">) => {
  const project = await ctx.db.get("projects", projectId);
  if (!project) return;
  const progress = progressOf(await tasksOfProject(ctx, projectId));
  if (!sameFields(project.progress, progress)) await ctx.db.patch("projects", projectId, { progress });
};

export const settle = async (ctx: MutationCtx, touched: Touched) => {
  for (const taskId of touched.tasks) await settleTask(ctx, taskId);
  for (const projectId of touched.projects) await settleProject(ctx, projectId);
};

export const backfill = internalMutation({
  args: { table: v.union(v.literal("tasks"), v.literal("projects")), cursor: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { table, cursor }) => {
    const { page, isDone, continueCursor } = await ctx.db.query(table).paginate({ cursor: cursor ?? null, numItems: BACKFILL_BATCH });
    for (const doc of page) {
      if (table === "tasks") await settleTask(ctx, doc._id as Id<"tasks">);
      else await settleProject(ctx, doc._id as Id<"projects">);
    }
    if (!isDone) await ctx.scheduler.runAfter(BACKFILL_PAUSE_MS, internal.planner.rollups.backfill, { table, cursor: continueCursor });
    else if (table === "tasks") await ctx.scheduler.runAfter(BACKFILL_PAUSE_MS, internal.planner.rollups.backfill, { table: "projects" });
    return null;
  },
});
