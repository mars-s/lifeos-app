import { v } from "convex/values";
import { Effect } from "effect";
import { changeMutation, ownerQuery, reading, recording } from "./effect";
import { EntityNotFound } from "./errors";
import { vEntityRef, type EntityRef } from "./tables";

const requireAll = Effect.fn("links.requireAll")(function* (refs: EntityRef[]) {
  for (const entity of refs) {
    if (!(yield* reading((ctx) => ctx.db.get(entity.id)))) return yield* new EntityNotFound({ entity });
  }
});

export const link = changeMutation({
  action: "entity.link",
  args: { from: vEntityRef, to: vEntityRef },
  handler: Effect.fn("links.link")(function* ({ from, to }) {
    yield* requireAll([from, to]);
    return { linkId: yield* recording((record) => record.insert("entityLinks", { from, to })) };
  }),
});

export const unlink = changeMutation({
  action: "entity.unlink",
  args: { linkId: v.id("entityLinks") },
  handler: Effect.fn("links.unlink")(function* ({ linkId }) {
    yield* recording((record) => record.remove("entityLinks", linkId));
    return {};
  }),
});

export const backlinks = ownerQuery({
  args: { to: vEntityRef },
  handler: ({ to }) =>
    reading(async (ctx) =>
      (
        await ctx.db
          .query("entityLinks")
          .withIndex("by_to", (q) => q.eq("to.id", to.id))
          .take(200)
      ).map(({ _id, from }) => ({ linkId: _id, from })),
    ),
});
