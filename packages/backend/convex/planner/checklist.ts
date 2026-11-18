import { v } from "convex/values";
import { err, ok } from "neverthrow";
import type { Id } from "../_generated/dataModel";
import { changeMutation } from "../platform/change";
import { keyAfter, load, parseOrder, parseTitle, type PlannerError } from "./model";

export const add = changeMutation({
  action: "checklist.add",
  args: { taskId: v.id("tasks"), title: v.string() },
  handler: async (ctx, { taskId, title }, record) => {
    const task = await load(ctx, "tasks", taskId);
    const validTitle = parseTitle(title);
    if (task.isErr()) return err<{ itemId: Id<"checklistItems"> }, PlannerError>(task.error);
    if (validTitle.isErr()) return err<{ itemId: Id<"checklistItems"> }, PlannerError>(validTitle.error);
    const last = await ctx.db
      .query("checklistItems")
      .withIndex("by_task_order", (q) => q.eq("taskId", taskId))
      .order("desc")
      .first();
    const itemId = await record.insert("checklistItems", {
      taskId,
      title: validTitle.value,
      done: false,
      order: keyAfter(last?.order),
    });
    return ok<{ itemId: Id<"checklistItems"> }, PlannerError>({ itemId });
  },
});

export const edit = changeMutation({
  action: "checklist.edit",
  args: { itemId: v.id("checklistItems"), title: v.string() },
  handler: async (ctx, { itemId, title }, record) => {
    const item = await load(ctx, "checklistItems", itemId);
    const validTitle = parseTitle(title);
    if (item.isErr()) return err<{ changed: boolean }, PlannerError>(item.error);
    if (validTitle.isErr()) return err<{ changed: boolean }, PlannerError>(validTitle.error);
    return ok<{ changed: boolean }, PlannerError>({
      changed: await record.patch("checklistItems", itemId, { title: validTitle.value }),
    });
  },
});

export const tick = changeMutation({
  action: "checklist.tick",
  args: { itemId: v.id("checklistItems"), done: v.boolean() },
  handler: async (ctx, { itemId, done }, record) => {
    const item = await load(ctx, "checklistItems", itemId);
    if (item.isErr()) return err<{ changed: boolean }, PlannerError>(item.error);
    return ok<{ changed: boolean }, PlannerError>({ changed: await record.patch("checklistItems", itemId, { done }) });
  },
});

export const reorder = changeMutation({
  action: "checklist.reorder",
  args: { itemId: v.id("checklistItems"), order: v.string() },
  handler: async (ctx, { itemId, order }, record) => {
    const item = await load(ctx, "checklistItems", itemId);
    const validOrder = parseOrder(order);
    if (item.isErr()) return err<{ changed: boolean }, PlannerError>(item.error);
    if (validOrder.isErr()) return err<{ changed: boolean }, PlannerError>(validOrder.error);
    return ok<{ changed: boolean }, PlannerError>({
      changed: await record.patch("checklistItems", itemId, { order: validOrder.value }),
    });
  },
});
