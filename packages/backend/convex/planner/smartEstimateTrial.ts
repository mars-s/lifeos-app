import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { CAPABILITIES, MODEL_IDS, canAnswer, MODELS } from "../../shared/ai";
import { attemptsFor } from "../ai/capabilities";
import { askChoice } from "../ai/transport";
import { bucketsFor, estimateAsk, parseDecision, type EstimateSignal } from "./smartEstimateModel";

const signalOf = (title: string, notes: string) =>
  ({ task: { title, notes, checklistItems: 0, labels: [] }, examples: [] }) satisfies EstimateSignal;

export const compare = internalAction({
  args: { tasks: v.array(v.object({ title: v.string(), notes: v.optional(v.string()) })), dayMinutes: v.optional(v.number()) },
  handler: async (ctx, { tasks, dayMinutes = 510 }) => {
    const buckets = bucketsFor(dayMinutes);
    const attempts = await attemptsFor(
      ctx,
      MODEL_IDS.filter((model) => canAnswer(model, CAPABILITIES.smartEstimates.asks)),
    );
    const results = [];
    for (const { title, notes = "" } of tasks) {
      const ask = estimateAsk(signalOf(title, notes), buckets);
      const byModel: Record<string, unknown> = {};
      for (const attempt of attempts) {
        const started = Date.now();
        const answer = await askChoice([attempt], ask, (body) => parseDecision(buckets, body));
        byModel[MODELS[attempt.model].title + ` (${MODELS[attempt.model].provider})`] = answer.match(
          ({ value: { pick, confidence, vague, probabilities } }) => ({
            pick,
            confidence: Math.round(confidence * 100),
            vague: Math.round(vague * 100),
            top: probabilities
              .toSorted((a, b) => b.probability - a.probability)
              .slice(0, 3)
              .map(({ minutes, probability }) => `${minutes}m ${Math.round(probability * 100)}%`),
            ms: Date.now() - started,
          }),
          (error) => ({ error: error.kind }),
        );
      }
      results.push({ title, byModel });
    }
    return results;
  },
});
