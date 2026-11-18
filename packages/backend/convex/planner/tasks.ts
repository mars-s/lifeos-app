import { v } from "convex/values";
import type { WithoutSystemFields } from "convex/server";
import { Result, err, ok } from "neverthrow";
import { query, type MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { Recorder } from "../platform/activity";
import { changeMutation } from "../platform/change";
import {
  keyAfter,
  lastTaskOrder,
  load,
  parseDeadline,
  parseEstimate,
  parseLabels,
  parseOrder,
  parseParent,
  parseTitle,
  parseWhen,
  type PlannerError,
} from "./model";
import { vParent, vWhen } from "./tables";

const CARD_LIMIT = 500;

type TaskFields = Partial<WithoutSystemFields<Doc<"tasks">>>;

const edit = async (
  ctx: MutationCtx,
  record: Recorder,
  taskId: Id<"tasks">,
  fieldsFor: (task: Doc<"tasks">) => Promise<Result<TaskFields, PlannerError>> | Result<TaskFields, PlannerError>,
) => {
  const task = await load(ctx, "tasks", taskId);
  if (task.isErr()) return err<{ changed: boolean }, PlannerError>(task.error);
  const fields = await fieldsFor(task.value);
  if (fields.isErr()) return err<{ changed: boolean }, PlannerError>(fields.error);
  return ok<{ changed: boolean }, PlannerError>({ changed: await record.patch("tasks", taskId, fields.value) });
};

export const create = changeMutation({
  action: "task.create",
  args: {
    title: v.string(),
    notes: v.optional(v.string()),
    when: v.optional(vWhen),
    deadline: v.optional(v.string()),
    estimateMinutes: v.optional(v.number()),
    parent: v.optional(vParent),
    labelIds: v.optional(v.array(v.id("labels"))),
  },
  handler: async (ctx, args, record) => {
    const fields = Result.combine([
      parseTitle(args.title),
      parseWhen(args.when ?? { kind: "inbox" }),
      parseDeadline(args.deadline ?? null),
      parseEstimate(args.estimateMinutes ?? null),
      await parseParent(ctx, args.parent ?? { kind: "loose" }),
      await parseLabels(ctx, args.labelIds ?? []),
    ]);
    if (fields.isErr()) return err<{ taskId: Id<"tasks"> }, PlannerError>(fields.error);
    const [title, when, deadline, estimateMinutes, parent, labelIds] = fields.value;
    const taskId = await record.insert("tasks", {
      title,
      notes: args.notes ?? "",
      when,
      ...(deadline ? { deadline } : {}),
      ...(estimateMinutes ? { estimateMinutes } : {}),
      parent,
      labelIds,
      status: { kind: "open" },
      order: keyAfter(await lastTaskOrder(ctx, parent)),
    });
    return ok<{ taskId: Id<"tasks"> }, PlannerError>({ taskId });
  },
});

export const rename = changeMutation({
  action: "task.rename",
  args: { taskId: v.id("tasks"), title: v.string() },
  handler: (ctx, { taskId, title }, record) => edit(ctx, record, taskId, () => parseTitle(title).map((valid) => ({ title: valid }))),
});

export const setNotes = changeMutation({
  action: "task.setNotes",
  args: { taskId: v.id("tasks"), notes: v.string() },
  handler: (ctx, { taskId, notes }, record) => edit(ctx, record, taskId, () => ok({ notes })),
});

export const setWhen = changeMutation({
  action: "task.setWhen",
  args: { taskId: v.id("tasks"), when: vWhen },
  handler: (ctx, { taskId, when }, record) => edit(ctx, record, taskId, () => parseWhen(when).map((valid) => ({ when: valid }))),
});

export const setDeadline = changeMutation({
  action: "task.setDeadline",
  args: { taskId: v.id("tasks"), deadline: v.union(v.string(), v.null()) },
  handler: (ctx, { taskId, deadline }, record) =>
    edit(ctx, record, taskId, () => parseDeadline(deadline).map((valid) => ({ deadline: valid }))),
});

export const setEstimate = changeMutation({
  action: "task.setEstimate",
  args: { taskId: v.id("tasks"), minutes: v.union(v.number(), v.null()) },
  handler: (ctx, { taskId, minutes }, record) =>
    edit(ctx, record, taskId, () => parseEstimate(minutes).map((valid) => ({ estimateMinutes: valid }))),
});

export const setLabels = changeMutation({
  action: "task.setLabels",
  args: { taskId: v.id("tasks"), labelIds: v.array(v.id("labels")) },
  handler: (ctx, { taskId, labelIds }, record) =>
    edit(ctx, record, taskId, async () => (await parseLabels(ctx, labelIds)).map((valid) => ({ labelIds: valid }))),
});

export const move = changeMutation({
  action: "task.move",
  args: { taskId: v.id("tasks"), parent: vParent, order: v.optional(v.string()) },
  handler: (ctx, { taskId, parent, order }, record) =>
    edit(ctx, record, taskId, async () => {
      const validParent = await parseParent(ctx, parent);
      if (validParent.isErr()) return err(validParent.error);
      const validOrder = order === undefined ? ok(keyAfter(await lastTaskOrder(ctx, parent))) : parseOrder(order);
      return validOrder.map((key) => ({ parent: validParent.value, order: key }));
    }),
});

export const complete = changeMutation({
  action: "task.complete",
  args: { taskId: v.id("tasks") },
  handler: (ctx, { taskId }, record) =>
    edit(ctx, record, taskId, (task) =>
      ok(task.status.kind === "completed" ? {} : { status: { kind: "completed" as const, at: Date.now() } }),
    ),
});

export const uncomplete = changeMutation({
  action: "task.uncomplete",
  args: { taskId: v.id("tasks") },
  handler: (ctx, { taskId }, record) => edit(ctx, record, taskId, () => ok({ status: { kind: "open" as const } })),
});

export const trash = changeMutation({
  action: "task.trash",
  args: { taskId: v.id("tasks") },
  handler: (ctx, { taskId }, record) =>
    edit(ctx, record, taskId, (task) => ok(task.trashedAt === undefined ? { trashedAt: Date.now() } : {})),
});

export const restore = changeMutation({
  action: "task.restore",
  args: { taskId: v.id("tasks") },
  handler: (ctx, { taskId }, record) => edit(ctx, record, taskId, () => ok({ trashedAt: undefined })),
});

export const card = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const task = await ctx.db.get("tasks", taskId);
    if (!task) return null;
    const [checklist, blocks] = await Promise.all([
      ctx.db
        .query("checklistItems")
        .withIndex("by_task_order", (q) => q.eq("taskId", taskId))
        .take(CARD_LIMIT),
      ctx.db
        .query("workBlocks")
        .withIndex("by_task_start", (q) => q.eq("taskId", taskId))
        .take(CARD_LIMIT),
    ]);
    return { ...task, checklist, workBlocks: blocks.filter((block) => block.removedAt === undefined) };
  },
});
