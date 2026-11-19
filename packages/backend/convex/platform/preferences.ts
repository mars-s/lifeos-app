import { v } from "convex/values";
import { ok } from "neverthrow";
import type { WithoutSystemFields } from "convex/server";
import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { ownerQuery } from "./access";
import { changeMutation } from "./change";

type Preferences = WithoutSystemFields<Doc<"preferences">>;

export const DEFAULT_PREFERENCES: Preferences = { smartEstimates: true };

const storedPreferences = (ctx: QueryCtx) => ctx.db.query("preferences").first();

export const preferencesOf = async (ctx: QueryCtx) => {
  const stored = await storedPreferences(ctx);
  return { ...DEFAULT_PREFERENCES, ...(stored ? { smartEstimates: stored.smartEstimates } : {}) };
};

export const get = ownerQuery({
  args: {},
  handler: preferencesOf,
});

export const setSmartEstimates = changeMutation({
  action: "preferences.smartEstimates",
  args: { enabled: v.boolean() },
  handler: async (ctx, { enabled }, record) => {
    const stored = await storedPreferences(ctx);
    if (stored) return ok<{ changed: boolean }, never>({ changed: await record.patch("preferences", stored._id, { smartEstimates: enabled }) });
    await record.insert("preferences", { ...DEFAULT_PREFERENCES, smartEstimates: enabled });
    return ok<{ changed: boolean }, never>({ changed: true });
  },
});
