import { ConvexError, v } from "convex/values";
import type { WithoutSystemFields } from "convex/server";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { thingsSnapshot, type ThingsSnapshot } from "./schema";

type MirroredTable = "areas" | "projects" | "tasks";

const sameFields = (current: Record<string, unknown>, incoming: Record<string, unknown>) =>
  Object.keys({ ...current, ...incoming })
    .filter((key) => key !== "_id" && key !== "_creationTime")
    .every((key) => JSON.stringify(current[key]) === JSON.stringify(incoming[key]));

const mirror = async <T extends MirroredTable>(
  ctx: MutationCtx,
  table: T,
  incoming: WithoutSystemFields<Doc<T>>[],
  replace: (id: Id<T>, row: WithoutSystemFields<Doc<T>>) => Promise<void>,
) => {
  const existing = await ctx.db.query(table).collect();
  const byThingsId = new Map(existing.map((doc) => [doc.thingsId, doc]));
  const seen = new Set(incoming.map((row) => row.thingsId));
  const counts = { inserted: 0, updated: 0, deleted: 0 };
  for (const row of incoming) {
    const current = byThingsId.get(row.thingsId);
    if (!current) {
      await ctx.db.insert(table, row);
      counts.inserted += 1;
    } else if (!sameFields(current, row)) {
      await replace(current._id, row);
      counts.updated += 1;
    }
  }
  for (const gone of existing.filter((doc) => !seen.has(doc.thingsId))) {
    await ctx.db.delete(gone._id);
    counts.deleted += 1;
  }
  return counts;
};

const sha256Hex = async (text: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const constantTimeEqual = (a: string, b: string) =>
  a.length === b.length &&
  Array.from(a).reduce((diff, char, i) => diff | (char.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0;

const assertSyncToken = async (token: string) => {
  const expected = process.env.THINGS_SYNC_TOKEN_SHA256;
  if (!expected || !constantTimeEqual(await sha256Hex(token), expected)) {
    throw new ConvexError("This sync token is not valid.");
  }
};

const applySnapshot = async (ctx: MutationCtx, snapshot: ThingsSnapshot) => {
  const changes = {
    areas: await mirror(ctx, "areas", snapshot.areas, (id, row) => ctx.db.replace("areas", id, row)),
    projects: await mirror(ctx, "projects", snapshot.projects, (id, row) => ctx.db.replace("projects", id, row)),
    tasks: await mirror(ctx, "tasks", snapshot.tasks, (id, row) => ctx.db.replace("tasks", id, row)),
  };
  const state = {
    source: "things" as const,
    syncedAt: Date.now(),
    counts: { areas: snapshot.areas.length, projects: snapshot.projects.length, tasks: snapshot.tasks.length },
  };
  const previous = await ctx.db
    .query("syncState")
    .withIndex("by_source", (q) => q.eq("source", "things"))
    .unique();
  if (previous) await ctx.db.replace(previous._id, state);
  else await ctx.db.insert("syncState", state);
  return changes;
};

export const sync = mutation({
  args: { token: v.string(), snapshot: thingsSnapshot },
  handler: async (ctx, { token, snapshot }) => {
    await assertSyncToken(token);
    return applySnapshot(ctx, snapshot);
  },
});

export const syncStatus = query({
  args: {},
  handler: (ctx) =>
    ctx.db
      .query("syncState")
      .withIndex("by_source", (q) => q.eq("source", "things"))
      .unique(),
});

