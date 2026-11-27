import { tool, type ToolDefinition } from "@convex-dev/mcp";
import { ConvexError, v } from "convex/values";
import type { Result } from "neverthrow";
import { internal } from "../_generated/api";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { agentMutation, agentQuery, MCP_SCOPES } from "./access";
import { endMcpRun, isLiveRun, isRunOf, latestMcpRun } from "./agentRuns";
import { undoActivity, undoAgentRun, type UndoError } from "./undo";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const CHANGE_COUNT_LIMIT = 100;

const vActivityEntry = v.object({
  id: v.string(),
  at: v.string(),
  action: v.string(),
  actor: v.union(v.literal("avi"), v.literal("agentRun"), v.literal("things"), v.literal("recurrence")),
  runId: v.optional(v.string()),
  runName: v.optional(v.string()),
  subject: v.optional(v.string()),
  changes: v.number(),
  undoesActivityId: v.optional(v.string()),
  undoesRunId: v.optional(v.string()),
  undone: v.boolean(),
});

const vActivityPage = v.object({ entries: v.array(vActivityEntry), nextCursor: v.optional(v.string()) });

const subjectOf = async (ctx: QueryCtx, change: Doc<"activityChanges"> | null) => {
  if (!change) return undefined;
  const doc = (await ctx.db.get(change.entity.id)) as Record<string, unknown> | null;
  const stored = change.change.kind === "delete" ? change.change.before : change.change.kind === "insert" ? change.change.after : {};
  const label = doc?.title ?? doc?.name ?? stored.title ?? stored.name;
  return typeof label === "string" ? label : undefined;
};

export const describeActivity = async (ctx: QueryCtx, entry: Doc<"activity">) => {
  const [changes, undoneBy, run] = await Promise.all([
    ctx.db
      .query("activityChanges")
      .withIndex("by_activity_seq", (q) => q.eq("activityId", entry._id))
      .take(CHANGE_COUNT_LIMIT),
    ctx.db
      .query("activity")
      .withIndex("by_undoes_activity", (q) => q.eq("undoes.activityId", entry._id))
      .first(),
    entry.actor.kind === "agentRun" ? ctx.db.get("jobs", entry.actor.jobId) : null,
  ]);
  const runUndone =
    entry.actor.kind === "agentRun" &&
    (await ctx.db
      .query("activity")
      .withIndex("by_undoes_run", (q) => q.eq("undoes.jobId", entry.actor.kind === "agentRun" ? entry.actor.jobId : undefined))
      .first()) !== null;
  const subject = await subjectOf(ctx, changes[0] ?? null);
  return {
    id: entry._id,
    at: new Date(entry.at).toISOString(),
    action: entry.action,
    actor: entry.actor.kind,
    ...(entry.actor.kind === "agentRun" ? { runId: entry.actor.jobId } : {}),
    ...(run ? { runName: run.job.payload.request } : {}),
    ...(subject ? { subject } : {}),
    changes: changes.length,
    ...(entry.undoes?.kind === "activity" ? { undoesActivityId: entry.undoes.activityId } : {}),
    ...(entry.undoes?.kind === "run" ? { undoesRunId: entry.undoes.jobId } : {}),
    undone: undoneBy !== null || (runUndone && entry.undoes === undefined),
  };
};

export const recentActivity = agentQuery({
  args: { runId: v.optional(v.string()), limit: v.optional(v.number()), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const numItems = Math.min(Math.max(Math.trunc(args.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
    const paginationOpts = { numItems, cursor: args.cursor ?? null };
    const jobId = args.runId === undefined ? undefined : ctx.db.normalizeId("jobs", args.runId);
    if (args.runId !== undefined && !jobId) throw new ConvexError(`No Agent Run has the id "${args.runId}".`);
    const page = jobId
      ? await ctx.db
          .query("activity")
          .withIndex("by_run", (q) => q.eq("actor.jobId", jobId))
          .order("desc")
          .paginate(paginationOpts)
      : await ctx.db.query("activity").order("desc").paginate(paginationOpts);
    return {
      entries: await Promise.all(page.page.map((entry) => describeActivity(ctx, entry))),
      ...(page.isDone ? {} : { nextCursor: page.continueCursor }),
    };
  },
});

const undoRefusals = {
  not_found: () => "No Activity entry has that id. recent_activity lists them.",
  not_undoable: (error) =>
    error.kind === "not_undoable"
      ? {
          undo: "An undo cannot itself be undone. Make the change again instead.",
          things: "A Things Import cannot be undone.",
          recurrence: "Tasks a Recurrence Rule created cannot be undone. Trash the Task instead.",
          permanent: "That change deleted something for good, so it cannot be undone.",
        }[error.reason]
      : "",
  already_undone: () => "That is already undone.",
  nothing_to_undo: () => "That Agent Run has no changes left to undo.",
  run_active: () => "That Agent Run is still running. Wait for it to finish, then undo it.",
  changed_since: (error) =>
    error.kind === "changed_since"
      ? `A later change touched the same ${error.entity.table} (${error.entity.id}), so LifeOS will not overwrite it. Undo that later change first.`
      : "",
} satisfies Record<UndoError["kind"], (error: UndoError) => string>;

const notYours = "You can only undo changes this connection made. Avi undoes his own changes in the app.";

const undone = (result: Result<{ undoActivityId: Id<"activity"> | null }, UndoError>) => {
  if (result.isErr()) throw new ConvexError(undoRefusals[result.error.kind](result.error));
  return result.value.undoActivityId ? { undoActivityId: result.value.undoActivityId as string } : {};
};

export const undo = agentMutation({
  args: { activityId: v.optional(v.string()), runId: v.optional(v.string()), currentRun: v.optional(v.boolean()) },
  handler: async (ctx, args, run, caller) => {
    const targets = [args.activityId, args.runId, args.currentRun ? true : undefined].filter((target) => target !== undefined);
    if (targets.length !== 1) throw new ConvexError("Give exactly one of activityId, runId or currentRun: true.");
    if (args.activityId !== undefined) {
      const activityId = ctx.db.normalizeId("activity", args.activityId);
      const entry = activityId && (await ctx.db.get("activity", activityId));
      if (!activityId || !entry) throw new ConvexError(`No Activity entry has the id "${args.activityId}". recent_activity lists them.`);
      const owner = entry.actor.kind === "agentRun" ? await ctx.db.get("jobs", entry.actor.jobId) : null;
      if (!isRunOf(owner, caller.connectionId)) throw new ConvexError(notYours);
      return { ...undone(await undoActivity(ctx, await run(), activityId)), undid: "activity" as const };
    }
    const now = Date.now();
    const latest = await latestMcpRun(ctx, caller.connectionId);
    const jobId = args.runId === undefined ? latest?._id : ctx.db.normalizeId("jobs", args.runId);
    if (!jobId) throw new ConvexError(args.runId === undefined ? "This connection has made no changes yet." : `No Agent Run has the id "${args.runId}".`);
    const target = await ctx.db.get("jobs", jobId);
    if (!target || !isRunOf(target, caller.connectionId)) throw new ConvexError(notYours);
    if (isLiveRun(target, now)) await endMcpRun(ctx, target, now);
    return { ...undone(await undoAgentRun(ctx, { kind: "agentRun", jobId }, jobId)), undid: "run" as const, runId: jobId as string };
  },
});

export const platformTools: Record<string, ToolDefinition> = {
  recent_activity: tool({
    title: "Recent Activity",
    description:
      "List recent changes to LifeOS, newest first: who made each (Avi, an Agent Run, a Things Import or a Recurrence Rule), what it touched, and whether it was undone. Pass runId to see one Agent Run. Paged with `cursor`.",
    args: { runId: v.optional(v.string()), limit: v.optional(v.number()), cursor: v.optional(v.string()) },
    returns: vActivityPage,
    annotations: { readOnlyHint: true },
    scope: MCP_SCOPES.read,
    handler: (ctx, args, caller) => ctx.runQuery(internal.platform.agentTools.recentActivity, { ...args, caller }),
  }),
  undo: tool({
    title: "Undo",
    description:
      "Undo one of your own changes (activityId), one of your own Agent Runs (runId), or every change in your current run (currentRun: true). Every write tool returns its runId and activityIds. Changes Avi or other agents made cannot be undone here. Undo is refused when a later change touched the same fields.",
    args: { activityId: v.optional(v.string()), runId: v.optional(v.string()), currentRun: v.optional(v.boolean()) },
    returns: v.object({
      undid: v.union(v.literal("activity"), v.literal("run")),
      undoActivityId: v.optional(v.string()),
      runId: v.optional(v.string()),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    scope: MCP_SCOPES.write,
    handler: (ctx, args, caller) => ctx.runMutation(internal.platform.agentTools.undo, { ...args, caller }),
  }),
};
