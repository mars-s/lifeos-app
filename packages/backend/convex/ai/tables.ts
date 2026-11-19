import { defineTable } from "convex/server";
import { v, type Infer } from "convex/values";

export const vAiError = v.union(
  v.object({ kind: v.literal("not_configured") }),
  v.object({ kind: v.literal("unauthorised") }),
  v.object({ kind: v.literal("rate_limited") }),
  v.object({ kind: v.literal("unavailable"), status: v.optional(v.number()) }),
  v.object({ kind: v.literal("invalid_response") }),
  v.object({ kind: v.literal("refused") }),
);

const vAnswered = { answeredBy: v.string(), inputsHash: v.string(), at: v.number() };

export const vStepsOutcome = v.union(
  v.object({ kind: v.literal("waiting") }),
  v.object({ kind: v.literal("suggested"), steps: v.array(v.string()), project: v.boolean(), ...vAnswered }),
  v.object({ kind: v.literal("failed"), error: vAiError, inputsHash: v.string(), at: v.number() }),
);

export type AiError = Infer<typeof vAiError>;
export type StepsOutcome = Infer<typeof vStepsOutcome>;

export const aiTables = {
  stepSuggestions: defineTable({
    taskId: v.id("tasks"),
    requestedAt: v.number(),
    answeredAt: v.optional(v.number()),
    outcome: vStepsOutcome,
  }).index("by_task", ["taskId"]),
};
