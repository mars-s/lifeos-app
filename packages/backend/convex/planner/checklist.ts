import { v } from "convex/values";
import { Effect } from "effect";
import { reading, recording } from "../platform/effect";
import { keyAfter, loadFx, parseOrder, parseTitleFx, plannerChange } from "./model";

export const add = plannerChange({
  action: "checklist.add",
  args: { taskId: v.id("tasks"), title: v.string() },
  handler: Effect.fn("checklist.add")(function* ({ taskId, title }) {
    yield* loadFx("tasks", taskId);
    const validTitle = yield* Effect.fromResult(parseTitleFx(title));
    const last = yield* reading((ctx) =>
      ctx.db
        .query("checklistItems")
        .withIndex("by_task_order", (q) => q.eq("taskId", taskId))
        .order("desc")
        .first(),
    );
    const itemId = yield* recording((record) =>
      record.insert("checklistItems", { taskId, title: validTitle, done: false, order: keyAfter(last?.order) }),
    );
    return { itemId };
  }),
});

export const edit = plannerChange({
  action: "checklist.edit",
  args: { itemId: v.id("checklistItems"), title: v.string() },
  handler: Effect.fn("checklist.edit")(function* ({ itemId, title }) {
    yield* loadFx("checklistItems", itemId);
    const validTitle = yield* Effect.fromResult(parseTitleFx(title));
    return { changed: yield* recording((record) => record.patch("checklistItems", itemId, { title: validTitle })) };
  }),
});

export const tick = plannerChange({
  action: "checklist.tick",
  args: { itemId: v.id("checklistItems"), done: v.boolean() },
  handler: Effect.fn("checklist.tick")(function* ({ itemId, done }) {
    yield* loadFx("checklistItems", itemId);
    return { changed: yield* recording((record) => record.patch("checklistItems", itemId, { done })) };
  }),
});

export const reorder = plannerChange({
  action: "checklist.reorder",
  args: { itemId: v.id("checklistItems"), order: v.string() },
  handler: Effect.fn("checklist.reorder")(function* ({ itemId, order }) {
    yield* loadFx("checklistItems", itemId);
    const validOrder = yield* Effect.fromResult(parseOrder(order));
    return { changed: yield* recording((record) => record.patch("checklistItems", itemId, { order: validOrder })) };
  }),
});

export const remove = plannerChange({
  action: "checklist.remove",
  args: { itemId: v.id("checklistItems") },
  handler: Effect.fn("checklist.remove")(function* ({ itemId }) {
    yield* loadFx("checklistItems", itemId);
    return { changed: yield* recording((record) => record.remove("checklistItems", itemId)) };
  }),
});
