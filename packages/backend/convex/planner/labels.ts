import { v } from "convex/values";
import { err, ok } from "neverthrow";
import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { ownerQuery } from "../platform/access";
import { changeMutation } from "../platform/change";
import { keyAfter, load, parseTitle, type PlannerError } from "./model";
import { vColour } from "./tables";

const LABEL_LIMIT = 500;
const STRIP_LIMIT = 2000;

export const labelNamed = async (ctx: QueryCtx, name: string) => {
  const exact = await ctx.db
    .query("labels")
    .withIndex("by_name", (q) => q.eq("name", name))
    .first();
  if (exact) return exact;
  const folded = name.toLowerCase();
  return (await ctx.db.query("labels").withIndex("by_order").take(LABEL_LIMIT)).find(
    (label) => label.name.toLowerCase() === folded,
  );
};

export const list = ownerQuery({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query("labels").withIndex("by_order").take(LABEL_LIMIT)).map(({ _id, name, colour }) => ({
      _id,
      name,
      colour,
    })),
});

export const create = changeMutation({
  action: "label.create",
  args: { name: v.string(), colour: vColour, taskId: v.optional(v.id("tasks")) },
  handler: async (ctx, { name, colour, taskId }, record) => {
    const validName = parseTitle(name);
    if (validName.isErr()) return err<{ labelId: Id<"labels"> }, PlannerError>(validName.error);
    const task = taskId ? await load(ctx, "tasks", taskId) : undefined;
    if (task?.isErr()) return err<{ labelId: Id<"labels"> }, PlannerError>(task.error);
    const existing = await labelNamed(ctx, validName.value);
    const last = existing ? undefined : await ctx.db.query("labels").withIndex("by_order").order("desc").first();
    const labelId =
      existing?._id ?? (await record.insert("labels", { name: validName.value, colour, order: keyAfter(last?.order) }));
    if (task?.isOk() && !task.value.labelIds.includes(labelId)) {
      await record.patch("tasks", task.value._id, { labelIds: [...task.value.labelIds, labelId] });
    }
    return ok<{ labelId: Id<"labels"> }, PlannerError>({ labelId });
  },
});

export const setColour = changeMutation({
  action: "label.setColour",
  args: { labelId: v.id("labels"), colour: vColour },
  handler: async (ctx, { labelId, colour }, record) => {
    const label = await load(ctx, "labels", labelId);
    if (label.isErr()) return err<{ changed: boolean }, PlannerError>(label.error);
    return ok<{ changed: boolean }, PlannerError>({ changed: await record.patch("labels", labelId, { colour }) });
  },
});

export const rename = changeMutation({
  action: "label.rename",
  args: { labelId: v.id("labels"), name: v.string() },
  handler: async (ctx, { labelId, name }, record) => {
    const validName = parseTitle(name);
    if (validName.isErr()) return err<{ changed: boolean }, PlannerError>(validName.error);
    const label = await load(ctx, "labels", labelId);
    if (label.isErr()) return err<{ changed: boolean }, PlannerError>(label.error);
    const holder = await labelNamed(ctx, validName.value);
    if (holder && holder._id !== labelId) return err<{ changed: boolean }, PlannerError>({ kind: "name_taken", name: holder.name });
    return ok<{ changed: boolean }, PlannerError>({ changed: await record.patch("labels", labelId, { name: validName.value }) });
  },
});

export const remove = changeMutation({
  action: "label.remove",
  args: { labelId: v.id("labels") },
  handler: async (ctx, { labelId }, record) => {
    const label = await load(ctx, "labels", labelId);
    if (label.isErr()) return err<{ stripped: number }, PlannerError>(label.error);
    const open = await ctx.db
      .query("tasks")
      .withIndex("by_trashed_status_when", (q) => q.eq("trashedAt", undefined).eq("status.kind", "open"))
      .take(STRIP_LIMIT);
    let stripped = 0;
    for (const task of open) {
      if (!task.labelIds.includes(labelId)) continue;
      await record.patch("tasks", task._id, { labelIds: task.labelIds.filter((id) => id !== labelId) });
      stripped += 1;
    }
    if (label.value.things) await ctx.db.insert("thingsTombstones", { thingsId: label.value.things.id });
    await record.remove("labels", labelId);
    return ok<{ stripped: number }, PlannerError>({ stripped });
  },
});
