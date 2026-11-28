import { v } from "convex/values";
import { Effect } from "effect";
import type { QueryCtx } from "../_generated/server";
import { ownerQuery, reading, recording } from "../platform/effect";
import { NameTaken } from "./errors";
import { changing, keyAfter, loadFx, parseTitleFx, plannerChange } from "./model";
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
  handler: () =>
    reading(async (ctx) =>
      (await ctx.db.query("labels").withIndex("by_order").take(LABEL_LIMIT)).map(({ _id, name, colour }) => ({
        _id,
        name,
        colour,
      })),
    ),
});

export const create = plannerChange({
  action: "label.create",
  args: { name: v.string(), colour: vColour, taskId: v.optional(v.id("tasks")) },
  handler: Effect.fn("labels.create")(function* ({ name, colour, taskId }) {
    const validName = yield* Effect.fromResult(parseTitleFx(name));
    const task = taskId ? yield* loadFx("tasks", taskId) : undefined;
    const existing = yield* reading((ctx) => labelNamed(ctx, validName));
    const last = existing ? undefined : yield* reading((ctx) => ctx.db.query("labels").withIndex("by_order").order("desc").first());
    const labelId = existing?._id ?? (yield* recording((record) => record.insert("labels", { name: validName, colour, order: keyAfter(last?.order) })));
    if (task && !task.labelIds.includes(labelId)) {
      yield* recording((record) => record.patch("tasks", task._id, { labelIds: [...task.labelIds, labelId] }));
    }
    return { labelId };
  }),
});

export const setColour = plannerChange({
  action: "label.setColour",
  args: { labelId: v.id("labels"), colour: vColour },
  handler: Effect.fn("labels.setColour")(function* ({ labelId, colour }) {
    yield* loadFx("labels", labelId);
    return { changed: yield* recording((record) => record.patch("labels", labelId, { colour })) };
  }),
});

export const rename = plannerChange({
  action: "label.rename",
  args: { labelId: v.id("labels"), name: v.string() },
  handler: Effect.fn("labels.rename")(function* ({ labelId, name }) {
    const validName = yield* Effect.fromResult(parseTitleFx(name));
    yield* loadFx("labels", labelId);
    const holder = yield* reading((ctx) => labelNamed(ctx, validName));
    if (holder && holder._id !== labelId) return yield* new NameTaken({ taken: holder.name });
    return { changed: yield* recording((record) => record.patch("labels", labelId, { name: validName })) };
  }),
});

export const remove = plannerChange({
  action: "label.remove",
  args: { labelId: v.id("labels") },
  handler: Effect.fn("labels.remove")(function* ({ labelId }) {
    const label = yield* loadFx("labels", labelId);
    const open = yield* reading((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_trashed_status_when", (q) => q.eq("trashedAt", undefined).eq("status.kind", "open"))
        .take(STRIP_LIMIT),
    );
    let stripped = 0;
    for (const task of open) {
      if (!task.labelIds.includes(labelId)) continue;
      yield* recording((record) => record.patch("tasks", task._id, { labelIds: task.labelIds.filter((id) => id !== labelId) }));
      stripped += 1;
    }
    const things = label.things;
    if (things) yield* changing((ctx) => ctx.db.insert("thingsTombstones", { thingsId: things.id }));
    yield* recording((record) => record.remove("labels", labelId));
    return { stripped };
  }),
});
