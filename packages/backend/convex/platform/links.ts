import { v } from "convex/values";
import { err, ok } from "neverthrow";
import { query, type MutationCtx } from "../_generated/server";
import { changeMutation } from "./change";
import { vEntityRef, type EntityRef } from "./tables";

export type LinkError = { readonly kind: "not_found"; readonly entity: EntityRef };

const missing = async (ctx: MutationCtx, refs: EntityRef[]) => {
  for (const ref of refs) if (!(await ctx.db.get(ref.id))) return ref;
  return null;
};

export const link = changeMutation({
  action: "entity.link",
  args: { from: vEntityRef, to: vEntityRef },
  handler: async (ctx, { from, to }, record) => {
    const absent = await missing(ctx, [from, to]);
    if (absent) return err<{ linkId: never }, LinkError>({ kind: "not_found", entity: absent });
    return ok({ linkId: await record.insert("entityLinks", { from, to }) });
  },
});

export const unlink = changeMutation({
  action: "entity.unlink",
  args: { linkId: v.id("entityLinks") },
  handler: async (_ctx, { linkId }, record) => {
    await record.remove("entityLinks", linkId);
    return ok({});
  },
});

export const backlinks = query({
  args: { to: vEntityRef },
  handler: async (ctx, { to }) =>
    (
      await ctx.db
        .query("entityLinks")
        .withIndex("by_to", (q) => q.eq("to.id", to.id))
        .take(200)
    ).map(({ _id, from }) => ({ linkId: _id, from })),
});
