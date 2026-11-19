import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { DEFAULT_AI_SETTINGS } from "../../shared/ai";

export const fromSmartEstimates = internalMutation({
  args: {},
  returns: v.object({ migrated: v.boolean() }),
  handler: async (ctx) => {
    const ai = await ctx.db
      .query("features")
      .withIndex("by_feature", (q) => q.eq("feature", "ai"))
      .unique();
    if (ai) return { migrated: false };
    await ctx.db.insert("features", { feature: "ai", enabled: true, settings: DEFAULT_AI_SETTINGS });
    return { migrated: true };
  },
});
