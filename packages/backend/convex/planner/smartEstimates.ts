import { v } from "convex/values";
import { errAsync, ResultAsync, type Result } from "neverthrow";
import { internal } from "../_generated/api";
import { internalAction, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { focusedMs, MINUTE_MS } from "../../shared/focus";
import { ownerMutation, ownerQuery } from "../platform/access";
import { preferencesOf } from "../platform/preferences";
import { workingHoursOf } from "../calendar/workingHours";
import { revealSecret, secretAvailable } from "../platform/secrets";
import { sha256Hex } from "../platform/workers";
import {
  calibrationOf,
  canonicalJson,
  bucketsFor,
  guessesFrom,
  isPlaceholderTitle,
  DECISIONS_MODEL,
  DECISIONS_URL,
  decisionRequest,
  nearestExamples,
  parseDecision,
  reasonFor,
  trimNotes,
  VAGUE_THRESHOLD,
  type Bucket,
  type Calibration,
  type Decision,
  type EstimateSignal,
  type Guess,
  type PastTask,
  type TaskSignal,
} from "./smartEstimateModel";
import { vSuggestionOutcome, type SmartEstimateError, type SuggestionOutcome } from "./tables";

export const DEBOUNCE_MS = 2_000;
const HISTORY_TASKS = 300;
const HISTORY_SESSIONS = 600;
const CONTAINER_LIMIT = 500;
const CHECKLIST_LIMIT = 100;

const wantsSuggestion = (task: Doc<"tasks">) =>
  task.estimateMinutes === undefined && task.status.kind === "open" && task.trashedAt === undefined && !isPlaceholderTitle(task.title);

const suggestionRow = (ctx: QueryCtx, taskId: Id<"tasks">) =>
  ctx.db
    .query("estimateSuggestions")
    .withIndex("by_task", (q) => q.eq("taskId", taskId))
    .unique();

export const requestSuggestion = async (ctx: MutationCtx, taskId: Id<"tasks">, { onlyFirst = false } = {}) => {
  if (!(await preferencesOf(ctx)).smartEstimates || !(await secretAvailable(ctx, "openai"))) return false;
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

const workingDayMinutes = ({ startMinute, endMinute }: { startMinute: number; endMinute: number }) => endMinute - startMinute;

const smartEstimatesOn = async (ctx: QueryCtx) =>
  (await preferencesOf(ctx)).smartEstimates && (await secretAvailable(ctx, "openai"));

export type EstimateView =
  | { kind: "presets" }
  | { kind: "thinking" }
  | { kind: "guesses"; guesses: Guess[]; likely: number; reason: string; dayMinutes: number }
  | { kind: "fallback"; why: "untitled" | "vague" | "failed"; error?: SmartEstimateError["kind"] };

const viewOf = (task: Doc<"tasks">, row: Doc<"estimateSuggestions"> | null, dayMinutes: number) => {
  const { outcome } = row ?? { outcome: null };
  if (outcome?.kind === "suggested") {
    const pending = task.estimateMinutes === undefined && row !== null && row.requestedAt > (row.answeredAt ?? 0);
    return pending
      ? ({ kind: "thinking" } satisfies EstimateView)
      : ({ kind: "guesses", guesses: outcome.guesses, likely: outcome.minutes, reason: outcome.reason, dayMinutes } satisfies EstimateView);
  }
  if (task.estimateMinutes !== undefined) return { kind: "presets" } satisfies EstimateView;
  if (isPlaceholderTitle(task.title)) return { kind: "fallback", why: "untitled" } satisfies EstimateView;
  if (!row || row.requestedAt > (row.answeredAt ?? 0) || outcome?.kind === "waiting") return { kind: "thinking" } satisfies EstimateView;
  if (outcome?.kind === "unclear") return { kind: "fallback", why: "vague" } satisfies EstimateView;
  if (outcome?.kind === "failed") return { kind: "fallback", why: "failed", error: outcome.error.kind } satisfies EstimateView;
  return { kind: "presets" } satisfies EstimateView;
};

export const forTask = ownerQuery({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const task = await ctx.db.get("tasks", taskId);
    if (!task || !(await smartEstimatesOn(ctx))) return { kind: "presets" } satisfies EstimateView;
    const [row, hours] = await Promise.all([suggestionRow(ctx, taskId), workingHoursOf(ctx)]);
    return viewOf(task, row, workingDayMinutes(hours));
  },
});

export const status = ownerQuery({
  args: {},
  handler: async (ctx) => ({ enabled: (await preferencesOf(ctx)).smartEstimates, configured: await secretAvailable(ctx, "openai") }),
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
  | { kind: "settle" }
  | { kind: "gone" }
  | { kind: "ask"; signal: EstimateSignal; calibration: Calibration | null; dayMinutes: number; cachedHash: string | null };

export const planFor = internalQuery({
  args: { taskId: v.id("tasks"), requestedAt: v.number() },
  handler: async (ctx, { taskId, requestedAt }) => {
    const skip = { kind: "skip" } satisfies SuggestionPlan;
    const row = await suggestionRow(ctx, taskId);
    if (!row || row.requestedAt !== requestedAt) return skip;
    const task = await ctx.db.get("tasks", taskId);
    if (!task) return { kind: "gone" } satisfies SuggestionPlan;
    if (!wantsSuggestion(task) || !(await preferencesOf(ctx)).smartEstimates) return { kind: "settle" } satisfies SuggestionPlan;
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
    const examples = nearestExamples({ ...taskSignal, ...(projectKey ? { projectKey } : {}) }, history);
    return {
      kind: "ask",
      signal: { task: taskSignal, examples },
      calibration: calibrationOf(examples, history) ?? null,
      dayMinutes: workingDayMinutes(await workingHoursOf(ctx)),
      cachedHash: row.outcome.kind === "suggested" || row.outcome.kind === "unclear" ? row.outcome.inputsHash : null,
    } satisfies SuggestionPlan;
  },
});

export const record = internalMutation({
  args: { taskId: v.id("tasks"), requestedAt: v.number(), outcome: v.optional(vSuggestionOutcome) },
  returns: v.null(),
  handler: async (ctx, { taskId, requestedAt, outcome }) => {
    const row = await suggestionRow(ctx, taskId);
    if (row?.requestedAt !== requestedAt) return null;
    await ctx.db.patch("estimateSuggestions", row._id, { answeredAt: requestedAt, ...(outcome ? { outcome } : {}) });
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

const askDecisions = (key: string | undefined, signal: EstimateSignal, buckets: readonly Bucket[]) => {
  if (!key) return errAsync<Decision, SmartEstimateError>({ kind: "not_configured" });
  const unreachable: SmartEstimateError = { kind: "unavailable" };
  const unreadable: SmartEstimateError = { kind: "invalid_response" };
  return ResultAsync.fromPromise(
    fetch(DECISIONS_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(decisionRequest(signal, buckets)),
    }),
    () => unreachable,
  )
    .andThen((response) =>
      response.ok
        ? ResultAsync.fromPromise(response.json() as Promise<unknown>, () => unreadable)
        : errAsync<unknown, SmartEstimateError>(failureOf(response)),
    )
    .andThen((body) => parseDecision(buckets, body));
};

export const suggest = internalAction({
  args: { taskId: v.id("tasks"), requestedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const plan: SuggestionPlan = await ctx.runQuery(internal.planner.smartEstimates.planFor, args);
    if (plan.kind === "gone") await ctx.runMutation(internal.planner.smartEstimates.forget, { taskId: args.taskId });
    if (plan.kind === "settle") await ctx.runMutation(internal.planner.smartEstimates.record, args);
    if (plan.kind !== "ask") return null;
    const { signal, calibration, dayMinutes } = plan;
    const buckets = bucketsFor(dayMinutes);
    const inputsHash = await sha256Hex(canonicalJson({ model: DECISIONS_MODEL, signal, calibration, buckets }));
    if (plan.cachedHash === inputsHash) {
      await ctx.runMutation(internal.planner.smartEstimates.record, args);
      return null;
    }
    const result: Result<Decision, SmartEstimateError> = await askDecisions(await revealSecret(ctx, "openai"), signal, buckets);
    const at = Date.now();
    const outcome: SuggestionOutcome = result.match(
      ({ pick, confidence, probabilities, vague, model }) => {
        if (vague >= VAGUE_THRESHOLD) return { kind: "unclear" as const, vague, inputsHash, at };
        const { guesses, likely: minutes } = guessesFrom(buckets, { pick, confidence, probabilities }, calibration ?? undefined);
        return {
          kind: "suggested" as const,
          minutes,
          guesses,
          modelMinutes: pick,
          reason: reasonFor(signal, calibration ?? undefined, pick, minutes),
          confidence,
          probabilities,
          model,
          inputsHash,
          at,
        };
      },
      (error) => ({ kind: "failed" as const, error, inputsHash, at }),
    );
    await ctx.runMutation(internal.planner.smartEstimates.record, { ...args, outcome });
    return null;
  },
});
