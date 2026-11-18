import { v } from "convex/values";
import { err, ok } from "neverthrow";
import { mutation, type MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { serialise } from "../../shared/result";
import { fromStored, recordedFields, sameValue, startRecording } from "./activity";
import { actorFor, vAgentRunCredential } from "./change";
import type { Actor, RecordRef, UndoTarget } from "./tables";

export type UndoError =
  | { readonly kind: "not_found" }
  | { readonly kind: "not_undoable"; readonly reason: "undo" | "things" }
  | { readonly kind: "already_undone" }
  | { readonly kind: "nothing_to_undo" }
  | { readonly kind: "changed_since"; readonly entity: RecordRef };

type Expected = { entity: RecordRef; fields: Map<string, unknown> | null; exact: boolean };

const changesOf = (ctx: MutationCtx, activityId: Id<"activity">) =>
  ctx.db
    .query("activityChanges")
    .withIndex("by_activity_seq", (q) => q.eq("activityId", activityId))
    .take(4000);

const runUndone = async (ctx: MutationCtx, jobId: Id<"jobs">) =>
  (await ctx.db
    .query("activity")
    .withIndex("by_undoes_run", (q) => q.eq("undoes.jobId", jobId))
    .first()) !== null;

const isUndone = async (ctx: MutationCtx, activity: Doc<"activity">) => {
  const direct = await ctx.db
    .query("activity")
    .withIndex("by_undoes_activity", (q) => q.eq("undoes.activityId", activity._id))
    .first();
  if (direct) return true;
  return activity.actor.kind === "agentRun" && runUndone(ctx, activity.actor.jobId);
};

const expectedState = (changes: Doc<"activityChanges">[]) => {
  const expected = new Map<string, Expected>();
  for (const { entity, change } of changes) {
    if (change.kind === "delete") {
      expected.set(entity.id, { entity, fields: null, exact: false });
    } else if (change.kind === "insert") {
      expected.set(entity.id, { entity, fields: new Map(Object.entries(change.after)), exact: true });
    } else {
      const known = expected.get(entity.id) ?? { entity, fields: new Map<string, unknown>(), exact: false };
      const fields = known.fields ?? new Map<string, unknown>();
      for (const [key, value] of Object.entries(change.after)) fields.set(key, value);
      expected.set(entity.id, { ...known, fields });
    }
  }
  return [...expected.values()];
};

const firstConflict = async (ctx: MutationCtx, changes: Doc<"activityChanges">[]) => {
  for (const { entity, fields, exact } of expectedState(changes)) {
    const doc = await ctx.db.get(entity.id);
    if (fields === null) {
      if (doc) return entity;
      continue;
    }
    if (!doc) return entity;
    const current: Record<string, unknown> = recordedFields(doc);
    const keys = exact ? new Set([...fields.keys(), ...Object.keys(current)]) : new Set(fields.keys());
    if ([...keys].some((key) => !sameValue(current[key], fields.get(key)))) return entity;
  }
  return null;
};

const revert = async (ctx: MutationCtx, actor: Actor, undoes: UndoTarget, changes: Doc<"activityChanges">[]) => {
  const conflict = await firstConflict(ctx, changes);
  if (conflict) return err<{ undoActivityId: Id<"activity"> | null }, UndoError>({ kind: "changed_since", entity: conflict });
  const record = startRecording(ctx, actor, "undo", undoes);
  for (const { entity, change } of changes.toReversed()) {
    if (change.kind === "insert") await record.remove(entity.table, entity.id);
    else if (change.kind === "patch") await record.patch(entity.table, entity.id, fromStored(change.before));
    else await record.insert(entity.table, fromStored(change.before) as never);
  }
  return ok<{ undoActivityId: Id<"activity"> | null }, UndoError>({ undoActivityId: await record.finish() });
};

const undoActivity = async (ctx: MutationCtx, actor: Actor, activityId: Id<"activity">) => {
  const activity = await ctx.db.get("activity", activityId);
  if (!activity) return err<never, UndoError>({ kind: "not_found" });
  if (activity.undoes) return err<never, UndoError>({ kind: "not_undoable", reason: "undo" });
  if (activity.actor.kind === "things") return err<never, UndoError>({ kind: "not_undoable", reason: "things" });
  if (await isUndone(ctx, activity)) return err<never, UndoError>({ kind: "already_undone" });
  return revert(ctx, actor, { kind: "activity", activityId }, await changesOf(ctx, activityId));
};

const undoAgentRun = async (ctx: MutationCtx, actor: Actor, jobId: Id<"jobs">) => {
  if (await runUndone(ctx, jobId)) return err<never, UndoError>({ kind: "already_undone" });
  const groups = await ctx.db
    .query("activity")
    .withIndex("by_run", (q) => q.eq("actor.jobId", jobId))
    .take(1000);
  const standing = [];
  for (const group of groups) {
    if (group.undoes || (await isUndone(ctx, group))) continue;
    standing.push(group);
  }
  if (standing.length === 0) return err<never, UndoError>({ kind: "nothing_to_undo" });
  const changes = (await Promise.all(standing.map((group) => changesOf(ctx, group._id)))).flat();
  return revert(ctx, actor, { kind: "run", jobId }, changes);
};

export const undo = mutation({
  args: { activityId: v.id("activity"), agentRun: vAgentRunCredential },
  handler: async (ctx, { activityId, agentRun }) =>
    serialise(await undoActivity(ctx, await actorFor(ctx, agentRun), activityId)),
});

export const undoRun = mutation({
  args: { jobId: v.id("jobs"), agentRun: vAgentRunCredential },
  handler: async (ctx, { jobId, agentRun }) =>
    serialise(await undoAgentRun(ctx, await actorFor(ctx, agentRun), jobId)),
});
