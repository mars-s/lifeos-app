import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, type QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { vCapability, type Capability } from "./tables";

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

export const forToken = internalQuery({
  args: { token: v.string() },
  handler: (ctx, { token }) => workerForToken(ctx, token),
});

export const requireCapability = (worker: Doc<"workers">, capability: Capability) => {
  if (!worker.capabilities.includes(capability)) {
    throw new ConvexError(`This Worker cannot do ${capability} work.`);
  }
  return worker;
};

export const register = internalMutation({
  args: { name: v.string(), capabilities: v.array(vCapability), tokenHash: v.string() },
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

export const grant = internalMutation({
  args: { name: v.string(), capability: vCapability },
  handler: async (ctx, { name, capability }) => {
    const worker = await ctx.db
      .query("workers")
      .withIndex("by_name", (q) => q.eq("name", name))
      .unique();
    if (!worker) throw new ConvexError(`No Worker is named ${name}.`);
    if (worker.capabilities.includes(capability)) return worker.capabilities;
    const capabilities = [...worker.capabilities, capability];
    await ctx.db.patch("workers", worker._id, { capabilities });
    return capabilities;
  },
});
