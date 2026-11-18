import { v } from "convex/values";
import type { WithoutSystemFields } from "convex/server";
import { err, ok, type Result } from "neverthrow";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { Recorder } from "../platform/activity";
import { changeMutation } from "../platform/change";
import { endFocusOnClosedTask } from "./focus";
import { keyAfter, lastTaskOrder, load, parseDeadline, parseEstimate, parseParent, parseWhen, type PlannerError } from "./model";
import { vParent, vWhen, type Parent } from "./tables";

const MAX_SELECTION = 500;

type TaskFields = Partial<WithoutSystemFields<Doc<"tasks">>>;
type FieldsFor = (task: Doc<"tasks">) => TaskFields;
type Changed = { changed: number };

const loadAll = async (ctx: MutationCtx, taskIds: Id<"tasks">[]) => {
  const unique = [...new Set(taskIds)];
  if (unique.length > MAX_SELECTION) return err<Doc<"tasks">[], PlannerError>({ kind: "selection_too_large", limit: MAX_SELECTION });
  const tasks: Doc<"tasks">[] = [];
  for (const id of unique) {
    const task = await load(ctx, "tasks", id);
    if (task.isErr()) return err<Doc<"tasks">[], PlannerError>(task.error);
    tasks.push(task.value);
  }
  return ok<Doc<"tasks">[], PlannerError>(tasks);
};

const vTaskIds = v.array(v.id("tasks"));

const applyToAll = async (ctx: MutationCtx, record: Recorder, taskIds: Id<"tasks">[], fieldsFor: Result<FieldsFor, PlannerError>) => {
  const tasks = await loadAll(ctx, taskIds);
  if (tasks.isErr()) return err<Changed, PlannerError>(tasks.error);
  if (fieldsFor.isErr()) return err<Changed, PlannerError>(fieldsFor.error);
  let changed = 0;
  for (const task of tasks.value) if (await record.patch("tasks", task._id, fieldsFor.value(task))) changed += 1;
  return ok<Changed, PlannerError>({ changed });
};

const sameParent = (a: Parent, b: Parent) =>
  (a.kind === "loose" && b.kind === "loose") ||
  (a.kind === "area" && b.kind === "area" && a.areaId === b.areaId) ||
  (a.kind === "project" && b.kind === "project" && a.projectId === b.projectId);

export const setWhen = changeMutation({
  action: "tasks.setWhen",
  args: { taskIds: vTaskIds, when: vWhen },
  handler: (ctx, { taskIds, when }, record) =>
    applyToAll(ctx, record, taskIds, parseWhen(when).map((valid) => () => ({ when: valid }))),
});

export const setDeadline = changeMutation({
  action: "tasks.setDeadline",
  args: { taskIds: vTaskIds, deadline: v.union(v.string(), v.null()) },
  handler: (ctx, { taskIds, deadline }, record) =>
    applyToAll(ctx, record, taskIds, parseDeadline(deadline).map((valid) => () => ({ deadline: valid }))),
});

export const setEstimate = changeMutation({
  action: "tasks.setEstimate",
  args: { taskIds: vTaskIds, minutes: v.union(v.number(), v.null()) },
  handler: (ctx, { taskIds, minutes }, record) =>
    applyToAll(ctx, record, taskIds, parseEstimate(minutes).map((valid) => () => ({ estimateMinutes: valid }))),
});

export const setLabel = changeMutation({
  action: "tasks.setLabel",
  args: { taskIds: vTaskIds, labelId: v.id("labels"), on: v.boolean() },
  handler: async (ctx, { taskIds, labelId, on }, record) =>
    applyToAll(
      ctx,
      record,
      taskIds,
      (await load(ctx, "labels", labelId)).map(() => (task: Doc<"tasks">) => {
        const others = task.labelIds.filter((id) => id !== labelId);
        return { labelIds: on ? [...others, labelId] : others };
      }),
    ),
});

export const move = changeMutation({
  action: "tasks.move",
  args: { taskIds: vTaskIds, parent: vParent },
  handler: async (ctx, { taskIds, parent }, record) => {
    let order = await lastTaskOrder(ctx, parent);
    return applyToAll(
      ctx,
      record,
      taskIds,
      (await parseParent(ctx, parent)).map((valid) => (task: Doc<"tasks">) => {
        if (sameParent(task.parent, valid)) return {};
        order = keyAfter(order);
        return { parent: valid, order };
      }),
    );
  },
});

export const complete = changeMutation({
  action: "tasks.complete",
  args: { taskIds: vTaskIds },
  handler: async (ctx, { taskIds }, record) => {
    const at = Date.now();
    const result = await applyToAll(
      ctx,
      record,
      taskIds,
      ok((task) => (task.status.kind === "open" ? { status: { kind: "completed" as const, at } } : {})),
    );
    await endFocusOnClosedTask(ctx, record, at);
    return result;
  },
});

export const reopen = changeMutation({
  action: "tasks.reopen",
  args: { taskIds: vTaskIds },
  handler: (ctx, { taskIds }, record) =>
    applyToAll(
      ctx,
      record,
      taskIds,
      ok((task) => (task.status.kind === "open" ? {} : { status: { kind: "open" as const } })),
    ),
});

export const trash = changeMutation({
  action: "tasks.trash",
  args: { taskIds: vTaskIds },
  handler: async (ctx, { taskIds }, record) => {
    const at = Date.now();
    const result = await applyToAll(
      ctx,
      record,
      taskIds,
      ok((task) => (task.trashedAt === undefined ? { trashedAt: at } : {})),
    );
    await endFocusOnClosedTask(ctx, record, at);
    return result;
  },
});

export const restore = changeMutation({
  action: "tasks.restore",
  args: { taskIds: vTaskIds },
  handler: (ctx, { taskIds }, record) => applyToAll(ctx, record, taskIds, ok(() => ({ trashedAt: undefined }))),
});
