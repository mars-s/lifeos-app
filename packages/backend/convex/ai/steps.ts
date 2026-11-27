import { v } from "convex/values";
import { err, ok, Result } from "neverthrow";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type QueryCtx } from "../_generated/server";
import type { ModelId } from "../../shared/ai";
import { ownerMutation, ownerQuery } from "../platform/access";
import { changeMutation } from "../platform/change";
import { sha256Hex } from "../platform/workers";
import { keyAfter, load, parseTitle, type PlannerError } from "../planner/model";
import { canonicalJson, clock, trimNotes } from "../planner/smartEstimateModel";
import { attemptsFor, capabilityChain, capabilityReady } from "./capabilities";
import { askJson, type JsonAsk } from "./transport";
import { vStepsOutcome, type AiError, type StepsOutcome } from "./tables";

export const MIN_STEPS = 3;
export const MAX_STEPS = 8;
const STEP_CHARACTERS = 80;
const CHECKLIST_LIMIT = 100;

const INSTRUCTIONS = `You break one person's Task into ${MIN_STEPS} to ${MAX_STEPS} concrete steps they can tick off as a checklist. Each step is a short imperative action under 60 characters, such as "Draft the outline" or "Email Sam the figures", in the order they would do them. Leave out steps already in the checklist. Set project to true only when the work is too big for one Task, more than about two working days, and would be better as a Project with headings.`;

export const STEPS_SCHEMA = {
  type: "object",
  properties: {
    steps: { type: "array", items: { type: "string" } },
    project: { type: "boolean" },
  },
  required: ["steps", "project"],
  additionalProperties: false,
};

type StepsSignal = { title: string; notes: string; estimateMinutes: number | null; checklist: string[] };

const line = (label: string, value: string | undefined) => (value ? [`${label}: ${value}`] : []);

export const stepsAsk = (signal: StepsSignal) =>
  ({
    cacheKey: "lifeos-break-into-steps",
    instructions: INSTRUCTIONS,
    parts: [
      {
        type: "input_text",
        text: [
          ...line("Task", signal.title),
          ...line("Description", signal.notes),
          ...line("Estimate", signal.estimateMinutes === null ? undefined : clock(signal.estimateMinutes)),
          ...line("Checklist already", signal.checklist.join("; ")),
        ].join("\n"),
      },
    ],
    schemaName: "steps",
    schema: STEPS_SCHEMA,
  }) satisfies JsonAsk;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const cleanStep = (step: unknown) => (typeof step === "string" ? step.trim().replace(/\s+/g, " ").replace(/^[-*•\d.)\s]+/, "").slice(0, STEP_CHARACTERS) : "");

export const parseSteps = (body: unknown) => {
  if (!isRecord(body) || !Array.isArray(body.steps)) return err<{ steps: string[]; project: boolean }, AiError>({ kind: "invalid_response" });
  const seen = new Set<string>();
  const steps = (body.steps as unknown[]).map(cleanStep).filter((step) => {
    const key = step.toLowerCase();
    if (step === "" || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return steps.length === 0
    ? err<{ steps: string[]; project: boolean }, AiError>({ kind: "invalid_response" })
    : ok<{ steps: string[]; project: boolean }, AiError>({ steps: steps.slice(0, MAX_STEPS), project: body.project === true });
};

const suggestionRow = (ctx: QueryCtx, taskId: Id<"tasks">) =>
  ctx.db
    .query("stepSuggestions")
    .withIndex("by_task", (q) => q.eq("taskId", taskId))
    .unique();

const wantsSteps = (task: Doc<"tasks">) => task.status.kind === "open" && task.trashedAt === undefined;

export const request = ownerMutation({
  args: { taskId: v.id("tasks"), again: v.optional(v.boolean()) },
  handler: async (ctx, { taskId, again = false }) => {
    if (!(await capabilityReady(ctx, "breakIntoSteps"))) return { requested: false };
    const task = await ctx.db.get("tasks", taskId);
    if (!task || !wantsSteps(task)) return { requested: false };
    const row = await suggestionRow(ctx, taskId);
    const requestedAt = Math.max(Date.now(), (row?.requestedAt ?? 0) + 1);
    if (row) await ctx.db.patch("stepSuggestions", row._id, again ? { requestedAt, outcome: { kind: "waiting" } } : { requestedAt });
    else await ctx.db.insert("stepSuggestions", { taskId, requestedAt, outcome: { kind: "waiting" } });
    await ctx.scheduler.runAfter(0, internal.ai.steps.suggest, { taskId, requestedAt });
    return { requested: true };
  },
});

export type StepsView =
  | { kind: "off" }
  | { kind: "idle" }
  | { kind: "thinking" }
  | { kind: "steps"; steps: string[]; project: boolean; answeredBy: string }
  | { kind: "failed"; error: AiError["kind"] };

const viewOf = (row: Doc<"stepSuggestions"> | null) => {
  if (!row) return { kind: "idle" } satisfies StepsView;
  if (row.requestedAt > (row.answeredAt ?? 0) || row.outcome.kind === "waiting") return { kind: "thinking" } satisfies StepsView;
  const { outcome } = row;
  if (outcome.kind === "failed") return { kind: "failed", error: outcome.error.kind } satisfies StepsView;
  return { kind: "steps", steps: outcome.steps, project: outcome.project, answeredBy: outcome.answeredBy } satisfies StepsView;
};

export const forTask = ownerQuery({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    if (!(await capabilityReady(ctx, "breakIntoSteps"))) return { kind: "off" } satisfies StepsView;
    return viewOf(await suggestionRow(ctx, taskId));
  },
});

const MAX_ACCEPTED = 20;

export const accept = changeMutation({
  action: "steps.accept",
  args: { taskId: v.id("tasks"), titles: v.array(v.string()) },
  handler: async (ctx, { taskId, titles }, record) => {
    const task = await load(ctx, "tasks", taskId);
    if (task.isErr()) return err<{ itemIds: Id<"checklistItems">[] }, PlannerError>(task.error);
    const valid = Result.combine(titles.slice(0, MAX_ACCEPTED).map(parseTitle));
    if (valid.isErr()) return err<{ itemIds: Id<"checklistItems">[] }, PlannerError>(valid.error);
    const last = await ctx.db
      .query("checklistItems")
      .withIndex("by_task_order", (q) => q.eq("taskId", taskId))
      .order("desc")
      .first();
    const itemIds: Id<"checklistItems">[] = [];
    let order = last?.order;
    for (const title of valid.value) {
      order = keyAfter(order);
      itemIds.push(await record.insert("checklistItems", { taskId, title, done: false, order }));
    }
    const row = await suggestionRow(ctx, taskId);
    if (row) await ctx.db.delete("stepSuggestions", row._id);
    return ok<{ itemIds: Id<"checklistItems">[] }, PlannerError>({ itemIds });
  },
});

export const dismiss = ownerMutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const row = await suggestionRow(ctx, taskId);
    if (row) await ctx.db.delete("stepSuggestions", row._id);
    return null;
  },
});

export type StepsPlan = { kind: "skip" } | { kind: "settle" } | { kind: "ask"; signal: StepsSignal; chain: ModelId[]; cachedHash: string | null };

export const planFor = internalQuery({
  args: { taskId: v.id("tasks"), requestedAt: v.number() },
  handler: async (ctx, { taskId, requestedAt }) => {
    const row = await suggestionRow(ctx, taskId);
    if (!row || row.requestedAt !== requestedAt) return { kind: "skip" } satisfies StepsPlan;
    const task = await ctx.db.get("tasks", taskId);
    const chain = await capabilityChain(ctx, "breakIntoSteps");
    if (!task || !wantsSteps(task) || chain.length === 0) return { kind: "settle" } satisfies StepsPlan;
    const checklist = await ctx.db
      .query("checklistItems")
      .withIndex("by_task_order", (q) => q.eq("taskId", taskId))
      .take(CHECKLIST_LIMIT);
    return {
      kind: "ask",
      signal: { title: task.title, notes: trimNotes(task.notes), estimateMinutes: task.estimateMinutes ?? null, checklist: checklist.map((item) => item.title) },
      chain,
      cachedHash: row.outcome.kind === "suggested" ? row.outcome.inputsHash : null,
    } satisfies StepsPlan;
  },
});

export const record = internalMutation({
  args: { taskId: v.id("tasks"), requestedAt: v.number(), outcome: v.optional(vStepsOutcome) },
  returns: v.null(),
  handler: async (ctx, { taskId, requestedAt, outcome }) => {
    const row = await suggestionRow(ctx, taskId);
    if (row?.requestedAt !== requestedAt) return null;
    if (!outcome && row.outcome.kind === "waiting") await ctx.db.delete("stepSuggestions", row._id);
    else await ctx.db.patch("stepSuggestions", row._id, { answeredAt: requestedAt, ...(outcome ? { outcome } : {}) });
    return null;
  },
});

export const suggest = internalAction({
  args: { taskId: v.id("tasks"), requestedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const plan: StepsPlan = await ctx.runQuery(internal.ai.steps.planFor, args);
    if (plan.kind === "settle") await ctx.runMutation(internal.ai.steps.record, args);
    if (plan.kind !== "ask") return null;
    const inputsHash = await sha256Hex(canonicalJson({ model: plan.chain[0], signal: plan.signal }));
    if (plan.cachedHash === inputsHash) {
      await ctx.runMutation(internal.ai.steps.record, args);
      return null;
    }
    const answer = await askJson(await attemptsFor(ctx, plan.chain), stepsAsk(plan.signal), parseSteps);
    const at = Date.now();
    const outcome: StepsOutcome = answer.match(
      ({ answeredBy, value }) => ({ kind: "suggested" as const, ...value, answeredBy, inputsHash, at }),
      (error) => ({ kind: "failed" as const, error, inputsHash, at }),
    );
    await ctx.runMutation(internal.ai.steps.record, { ...args, outcome });
    return null;
  },
});
