import { v } from "convex/values";
import { errAsync, ResultAsync, type Result } from "neverthrow";
import { internal } from "../_generated/api";
import { env, internalAction, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { focusedMs, MINUTE_MS } from "../../shared/focus";
import { ownerMutation, ownerQuery } from "../platform/access";
import { preferencesOf } from "../platform/preferences";
import { sha256Hex } from "../platform/workers";
import {
  calibrationOf,
  canonicalJson,
  DECISIONS_MODEL,
  DECISIONS_URL,
  decisionRequest,
  nearestExamples,
  parseDecision,
  reasonFor,
  trimNotes,
  type EstimateSignal,
  type PastTask,
  type Suggestion,
  type TaskSignal,
} from "./smartEstimateModel";
import { vSuggestionOutcome, type SmartEstimateError, type SuggestionOutcome } from "./tables";

export const DEBOUNCE_MS = 2_000;
const HISTORY_TASKS = 300;
const HISTORY_SESSIONS = 600;
const CONTAINER_LIMIT = 500;
const CHECKLIST_LIMIT = 100;

const openAiKey = () => env.OPENAI_API_KEY;

const wantsSuggestion = (task: Doc<"tasks">) =>
  task.estimateMinutes === undefined && task.status.kind === "open" && task.trashedAt === undefined;

const suggestionRow = (ctx: QueryCtx, taskId: Id<"tasks">) =>
  ctx.db
    .query("estimateSuggestions")
    .withIndex("by_task", (q) => q.eq("taskId", taskId))
    .unique();

export const requestSuggestion = async (ctx: MutationCtx, taskId: Id<"tasks">, { onlyFirst = false } = {}) => {
  if (!openAiKey() || !(await preferencesOf(ctx)).smartEstimates) return false;
  const task = await ctx.db.get("tasks", taskId);
  if (!task || !wantsSuggestion(task)) return false;
  const row = await suggestionRow(ctx, taskId);
  if (row && onlyFirst) return false;
  const requestedAt = Math.max(Date.now(), (row?.requestedAt ?? 0) + 1);
  if (row) await ctx.db.patch("estimateSuggestions", row._id, { requestedAt });
  else await ctx.db.insert("estimateSuggestions", { taskId, requestedAt, outcome: { kind: "waiting" } });
  await ctx.scheduler.runAfter(DEBOUNCE_MS, internal.planner.smartEstimates.suggest, { taskId, requestedAt });
  return true;
};

export const request = ownerMutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => ({ requested: await requestSuggestion(ctx, taskId, { onlyFirst: true }) }),
});

export const forTask = ownerQuery({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    if (!(await preferencesOf(ctx)).smartEstimates) return null;
    const task = await ctx.db.get("tasks", taskId);
    const row = await suggestionRow(ctx, taskId);
    if (!task || task.estimateMinutes !== undefined || row?.outcome.kind !== "suggested") return null;
    return { minutes: row.outcome.minutes, reason: row.outcome.reason };
  },
});

export const status = ownerQuery({
  args: {},
  handler: async (ctx) => ({ enabled: (await preferencesOf(ctx)).smartEstimates, configured: openAiKey() !== undefined }),
});

type Lookups = {
  areas: Map<Id<"areas">, Doc<"areas">>;
  labels: Map<Id<"labels">, Doc<"labels">>;
  projects: Map<Id<"projects">, Doc<"projects"> | null>;
};

const lookupsFor = async (ctx: QueryCtx) => {
  const [areas, labels] = await Promise.all([
    ctx.db.query("areas").withIndex("by_order").take(CONTAINER_LIMIT),
    ctx.db.query("labels").withIndex("by_order").take(CONTAINER_LIMIT),
  ]);
  return {
    areas: new Map(areas.map((area) => [area._id, area])),
    labels: new Map(labels.map((label) => [label._id, label])),
    projects: new Map<Id<"projects">, Doc<"projects"> | null>(),
  } satisfies Lookups;
};

const projectOf = async (ctx: QueryCtx, lookups: Lookups, projectId: Id<"projects">) => {
  if (!lookups.projects.has(projectId)) lookups.projects.set(projectId, await ctx.db.get("projects", projectId));
  return lookups.projects.get(projectId) ?? null;
};

const contextOf = async (ctx: QueryCtx, lookups: Lookups, task: Doc<"tasks">) => {
  const project = task.parent.kind === "project" ? await projectOf(ctx, lookups, task.parent.projectId) : null;
  const areaId = task.parent.kind === "area" ? task.parent.areaId : project?.areaId;
  const area = areaId ? lookups.areas.get(areaId) : undefined;
  const signal: TaskSignal = {
    title: task.title,
    notes: trimNotes(task.notes),
    checklistItems: 0,
    labels: task.labelIds.flatMap((id) => {
      const label = lookups.labels.get(id);
      return label ? [label.name] : [];
    }),
  };
  if (area) signal.area = area.title;
  if (project) signal.project = project.title;
  return { signal, projectKey: project?._id };
};

const actualMinutesByTask = async (ctx: QueryCtx) => {
  const sessions = await ctx.db.query("focusSessions").withIndex("by_start").order("desc").take(HISTORY_SESSIONS);
  const totals = new Map<Id<"tasks">, number>();
  for (const { taskId, kind, start, pausedMs, plannedMinutes, state, removedAt } of sessions) {
    if (kind !== "focus" || state.kind !== "ended" || removedAt !== undefined) continue;
    const clock = { start, pausedMs, state, ...(plannedMinutes === undefined ? {} : { plannedMinutes }) };
    totals.set(taskId, (totals.get(taskId) ?? 0) + focusedMs(clock, state.at));
  }
  return new Map([...totals].map(([taskId, ms]) => [taskId, Math.round(ms / MINUTE_MS)] as const));
};

const historyFor = async (ctx: QueryCtx, lookups: Lookups, taskId: Id<"tasks">) => {
  const [closed, actuals] = await Promise.all([
    ctx.db
      .query("tasks")
      .withIndex("by_trashed_closed_at", (q) => q.eq("trashedAt", undefined).gt("status.at", 0))
      .order("desc")
      .take(HISTORY_TASKS),
    actualMinutesByTask(ctx),
  ]);
  const known = new Map(closed.map((task) => [task._id, task]));
  for (const id of actuals.keys()) {
    if (known.has(id)) continue;
    const task = await ctx.db.get("tasks", id);
    if (task && task.trashedAt === undefined) known.set(id, task);
  }
  known.delete(taskId);
  const history: PastTask[] = [];
  for (const task of known.values()) {
    const { signal, projectKey } = await contextOf(ctx, lookups, task);
    const actual = actuals.get(task._id);
    history.push({
      ...signal,
      ...(projectKey ? { projectKey } : {}),
      ...(task.estimateMinutes === undefined ? {} : { estimateMinutes: task.estimateMinutes }),
      ...(actual ? { actualMinutes: actual } : {}),
    });
  }
  return history;
};

export type SuggestionPlan =
  | { kind: "skip" }
  | { kind: "gone" }
  | { kind: "ask"; signal: EstimateSignal; cachedHash: string | null };

export const planFor = internalQuery({
  args: { taskId: v.id("tasks"), requestedAt: v.number() },
  handler: async (ctx, { taskId, requestedAt }) => {
    const skip = { kind: "skip" } satisfies SuggestionPlan;
    const row = await suggestionRow(ctx, taskId);
    if (!row || row.requestedAt !== requestedAt) return skip;
    const task = await ctx.db.get("tasks", taskId);
    if (!task) return { kind: "gone" } satisfies SuggestionPlan;
    if (!wantsSuggestion(task) || !(await preferencesOf(ctx)).smartEstimates) return skip;
    const lookups = await lookupsFor(ctx);
    const [{ signal, projectKey }, checklist, history] = await Promise.all([
      contextOf(ctx, lookups, task),
      ctx.db
        .query("checklistItems")
        .withIndex("by_task_order", (q) => q.eq("taskId", taskId))
        .take(CHECKLIST_LIMIT),
      historyFor(ctx, lookups, taskId),
    ]);
    const taskSignal = { ...signal, checklistItems: checklist.length };
    const calibration = calibrationOf(history);
    return {
      kind: "ask",
      signal: {
        task: taskSignal,
        examples: nearestExamples({ ...taskSignal, ...(projectKey ? { projectKey } : {}) }, history),
        ...(calibration ? { calibration } : {}),
      },
      cachedHash: row.outcome.kind === "suggested" ? row.outcome.inputsHash : null,
    } satisfies SuggestionPlan;
  },
});

export const record = internalMutation({
  args: { taskId: v.id("tasks"), requestedAt: v.number(), outcome: vSuggestionOutcome },
  returns: v.null(),
  handler: async (ctx, { taskId, requestedAt, outcome }) => {
    const row = await suggestionRow(ctx, taskId);
    if (row?.requestedAt === requestedAt) await ctx.db.patch("estimateSuggestions", row._id, { outcome });
    return null;
  },
});

export const forget = internalMutation({
  args: { taskId: v.id("tasks") },
  returns: v.null(),
  handler: async (ctx, { taskId }) => {
    const row = await suggestionRow(ctx, taskId);
    if (row) await ctx.db.delete("estimateSuggestions", row._id);
    return null;
  },
});

const failureOf = (response: Response) => {
  if (response.status === 401 || response.status === 403) return { kind: "unauthorised" } satisfies SmartEstimateError;
  if (response.status === 429) return { kind: "rate_limited" } satisfies SmartEstimateError;
  return { kind: "unavailable", status: response.status } satisfies SmartEstimateError;
};

const askDecisions = (signal: EstimateSignal) => {
  const key = openAiKey();
  if (!key) return errAsync<Suggestion, SmartEstimateError>({ kind: "not_configured" });
  const unreachable: SmartEstimateError = { kind: "unavailable" };
  const unreadable: SmartEstimateError = { kind: "invalid_response" };
  return ResultAsync.fromPromise(
    fetch(DECISIONS_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(decisionRequest(signal)),
    }),
    () => unreachable,
  )
    .andThen((response) =>
      response.ok
        ? ResultAsync.fromPromise(response.json() as Promise<unknown>, () => unreadable)
        : errAsync<unknown, SmartEstimateError>(failureOf(response)),
    )
    .andThen(parseDecision);
};

export const suggest = internalAction({
  args: { taskId: v.id("tasks"), requestedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const plan: SuggestionPlan = await ctx.runQuery(internal.planner.smartEstimates.planFor, args);
    if (plan.kind === "gone") await ctx.runMutation(internal.planner.smartEstimates.forget, { taskId: args.taskId });
    if (plan.kind !== "ask") return null;
    const inputsHash = await sha256Hex(canonicalJson({ model: DECISIONS_MODEL, signal: plan.signal }));
    if (plan.cachedHash === inputsHash) return null;
    const result: Result<Suggestion, SmartEstimateError> = await askDecisions(plan.signal);
    const at = Date.now();
    const outcome: SuggestionOutcome = result.match(
      ({ minutes, confidence, model }) => ({
        kind: "suggested" as const,
        minutes,
        reason: reasonFor(plan.signal, minutes),
        confidence,
        model,
        inputsHash,
        at,
      }),
      (error) => ({ kind: "failed" as const, error, inputsHash, at }),
    );
    await ctx.runMutation(internal.planner.smartEstimates.record, { ...args, outcome });
    return null;
  },
});
