import { ConvexError, v } from "convex/values";
import { internalMutation, type QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { vJobKind, type JobKind } from "./tables";

export const sha256Hex = async (text: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const workerForToken = async (ctx: QueryCtx, token: string) => {
  const tokenHash = await sha256Hex(token);
  const worker = await ctx.db
    .query("workers")
    .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
    .unique();
  if (!worker) throw new ConvexError("This Worker token is not valid.");
  return worker;
};

export const requireCapability = (worker: Doc<"workers">, capability: JobKind) => {
  if (!worker.capabilities.includes(capability)) {
    throw new ConvexError(`This Worker cannot do ${capability} work.`);
  }
  return worker;
};

export const register = internalMutation({
  args: { name: v.string(), capabilities: v.array(vJobKind), tokenHash: v.string() },
  handler: async (ctx, worker) => {
    if (!/^[0-9a-f]{64}$/.test(worker.tokenHash)) throw new ConvexError("tokenHash must be a SHA-256 hex digest.");
    const existing = await ctx.db
      .query("workers")
      .withIndex("by_name", (q) => q.eq("name", worker.name))
      .unique();
    if (existing) {
      await ctx.db.replace("workers", existing._id, worker);
      return existing._id;
    }
    return ctx.db.insert("workers", worker);
  },
});
