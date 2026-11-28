import { v } from "convex/values";
import { Clock, Effect, Layer, Predicate, Result, Schema } from "effect";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { ModelId } from "../../shared/ai";
import { effectFromNeverthrow } from "../../shared/effect/bridge";
import { asWire, wireError } from "../../shared/effect/wire";
import { acting, CurrentActor, internalAction, internalMutation, internalQuery, ownerMutation, ownerQuery, Reads, reading, recording, runChange, writing, Writes } from "../platform/effect";
import { sha256Hex } from "../platform/workers";
import { keyAfter, load, parseTitle } from "../planner/model";
import { canonicalJson, clock, trimNotes } from "../planner/smartEstimateModel";
import { capabilityChain, capabilityReady } from "./capabilities";
import { AiInvalidResponse } from "./errors";
import { AiRouter } from "./routing";
import { AiProvider, askJson, type JsonAsk } from "./transport";
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

const StepsAnswer = Schema.Struct({ steps: Schema.Array(Schema.Unknown), project: Schema.optional(Schema.Unknown) });

const cleanStep = (step: unknown) =>
  Predicate.isString(step) ? step.trim().replace(/\s+/g, " ").replace(/^[-*•\d.)\s]+/, "").slice(0, STEP_CHARACTERS) : "";

export const parseSteps = (body: unknown) =>
  Result.flatMap(
    Result.mapError(Schema.decodeUnknownResult(StepsAnswer)(body), () => new AiInvalidResponse()),
    (answer) => {
      const seen = new Set<string>();
      const steps = answer.steps.map(cleanStep).filter((step) => {
        const key = step.toLowerCase();
        if (step === "" || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return steps.length === 0 ? Result.fail(new AiInvalidResponse()) : Result.succeed({ steps: steps.slice(0, MAX_STEPS), project: answer.project === true });
    },
  );

const suggestionRow = (ctx: QueryCtx, taskId: Id<"tasks">) =>
  ctx.db
    .query("stepSuggestions")
    .withIndex("by_task", (q) => q.eq("taskId", taskId))
    .unique();

const wantsSteps = (task: Doc<"tasks">) => task.status.kind === "open" && task.trashedAt === undefined;

export const request = ownerMutation({
  args: { taskId: v.id("tasks"), again: v.optional(v.boolean()) },
  handler: Effect.fn("steps.request")(function* ({ taskId, again = false }) {
    if (!(yield* reading((ctx) => capabilityReady(ctx, "breakIntoSteps")))) return { requested: false };
    const task = yield* reading((ctx) => ctx.db.get("tasks", taskId));
    if (!task || !wantsSteps(task)) return { requested: false };
    const row = yield* reading((ctx) => suggestionRow(ctx, taskId));
    const requestedAt = Math.max(yield* Clock.currentTimeMillis, (row?.requestedAt ?? 0) + 1);
    yield* writing(async (ctx) => {
      if (row) await ctx.db.patch("stepSuggestions", row._id, again ? { requestedAt, outcome: { kind: "waiting" } } : { requestedAt });
      else await ctx.db.insert("stepSuggestions", { taskId, requestedAt, outcome: { kind: "waiting" } });
      await ctx.scheduler.runAfter(0, internal.ai.steps.suggest, { taskId, requestedAt });
    });
    return { requested: true };
  }),
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
  handler: ({ taskId }) =>
    reading(async (ctx) => {
      if (!(await capabilityReady(ctx, "breakIntoSteps"))) return { kind: "off" } satisfies StepsView;
      return viewOf(await suggestionRow(ctx, taskId));
    }),
});

const MAX_ACCEPTED = 20;

const addSteps = Effect.fn("steps.addSteps")(function* (taskId: Id<"tasks">, titles: readonly string[]) {
  const ctx = yield* Reads;
  yield* effectFromNeverthrow(() => load(ctx, "tasks", taskId));
  const valid = yield* Effect.forEach(titles.slice(0, MAX_ACCEPTED), (title) => effectFromNeverthrow(() => parseTitle(title)));
  const last = yield* reading((reads) =>
    reads.db
      .query("checklistItems")
      .withIndex("by_task_order", (q) => q.eq("taskId", taskId))
      .order("desc")
      .first(),
  );
  const itemIds: Id<"checklistItems">[] = [];
  let order = last?.order;
  for (const title of valid) {
    order = keyAfter(order);
    const itemOrder = order;
    itemIds.push(yield* recording((record) => record.insert("checklistItems", { taskId, title, done: false, order: itemOrder })));
  }
  return { itemIds };
});

const forgetSuggestion = (taskId: Id<"tasks">) =>
  writing(async (ctx) => {
    const row = await suggestionRow(ctx, taskId);
    if (row) await ctx.db.delete("stepSuggestions", row._id);
    return null;
  });

export const accept = ownerMutation({
  args: { taskId: v.id("tasks"), titles: v.array(v.string()) },
  handler: Effect.fn("steps.accept")(function* ({ taskId, titles }) {
    const ctx = yield* Writes;
    const accepted = runChange(ctx, yield* CurrentActor, "steps.accept", addSteps(taskId, titles));
    return yield* asWire(Effect.tap(accepted, () => forgetSuggestion(taskId)));
  }),
});

export const dismiss = ownerMutation({
  args: { taskId: v.id("tasks") },
  handler: ({ taskId }) => forgetSuggestion(taskId),
});

export type StepsPlan = { kind: "skip" } | { kind: "settle" } | { kind: "ask"; signal: StepsSignal; chain: ModelId[]; cachedHash: string | null };

export const planFor = internalQuery({
  args: { taskId: v.id("tasks"), requestedAt: v.number() },
  handler: ({ taskId, requestedAt }) =>
    reading(async (ctx) => {
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
    }),
});

export const record = internalMutation({
  args: { taskId: v.id("tasks"), requestedAt: v.number(), outcome: v.optional(vStepsOutcome) },
  returns: v.null(),
  handler: ({ taskId, requestedAt, outcome }) =>
    writing(async (ctx) => {
      const row = await suggestionRow(ctx, taskId);
      if (row?.requestedAt !== requestedAt) return null;
      if (!outcome && row.outcome.kind === "waiting") await ctx.db.delete("stepSuggestions", row._id);
      else await ctx.db.patch("stepSuggestions", row._id, { answeredAt: requestedAt, ...(outcome ? { outcome } : {}) });
      return null;
    }),
});

type SuggestArgs = { taskId: Id<"tasks">; requestedAt: number };

const recordOutcome = (args: SuggestArgs, outcome?: StepsOutcome) =>
  acting((ctx) => {
    const recorded: Promise<null> = ctx.runMutation(internal.ai.steps.record, outcome ? { ...args, outcome } : args);
    return recorded;
  });

export const suggest = internalAction({
  args: { taskId: v.id("tasks"), requestedAt: v.number() },
  returns: v.null(),
  handler: Effect.fn("steps.suggest")(
    function* (args) {
      const plan = yield* acting((ctx) => {
        const planned: Promise<StepsPlan> = ctx.runQuery(internal.ai.steps.planFor, args);
        return planned;
      });
      if (plan.kind === "settle") yield* recordOutcome(args);
      if (plan.kind !== "ask") return null;
      const inputsHash = yield* Effect.promise(() => sha256Hex(canonicalJson({ model: plan.chain[0], signal: plan.signal })));
      if (plan.cachedHash === inputsHash) {
        yield* recordOutcome(args);
        return null;
      }
      const attempts = yield* (yield* AiRouter).attemptsFor(plan.chain);
      const answer = yield* Effect.result(askJson(attempts, stepsAsk(plan.signal), parseSteps));
      const at = yield* Clock.currentTimeMillis;
      const outcome: StepsOutcome = Result.isSuccess(answer)
        ? { kind: "suggested", ...answer.success.value, answeredBy: answer.success.answeredBy, inputsHash, at }
        : { kind: "failed", error: wireError(answer.failure), inputsHash, at };
      yield* recordOutcome(args, outcome);
      return null;
    },
    Effect.provide(Layer.mergeAll(AiRouter.layer, AiProvider.layer)),
  ),
});
