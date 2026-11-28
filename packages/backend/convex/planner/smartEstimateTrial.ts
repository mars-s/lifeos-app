import { v } from "convex/values";
import { Clock, Effect, Result } from "effect";
import { acting, internalAction } from "../platform/effect";
import { CAPABILITIES, MODEL_IDS, canAnswer, MODELS } from "../../shared/ai";
import { attemptsFor } from "../ai/capabilities";
import { askDecision, bucketsFor, estimateAsk, type EstimateSignal } from "./smartEstimateModel";

const signalOf = (title: string, notes: string) =>
  ({ task: { title, notes, checklistItems: 0, labels: [] }, examples: [] }) satisfies EstimateSignal;

export const compare = internalAction({
  args: { tasks: v.array(v.object({ title: v.string(), notes: v.optional(v.string()) })), dayMinutes: v.optional(v.number()) },
  handler: Effect.fn("smartEstimateTrial.compare")(function* ({ tasks, dayMinutes = 510 }) {
    const buckets = bucketsFor(dayMinutes);
    const attempts = yield* acting((ctx) =>
      attemptsFor(
        ctx,
        MODEL_IDS.filter((model) => canAnswer(model, CAPABILITIES.smartEstimates.asks)),
      ),
    );
    const results = [];
    for (const { title, notes = "" } of tasks) {
      const ask = estimateAsk(signalOf(title, notes), buckets);
      const byModel: Record<string, unknown> = {};
      for (const attempt of attempts) {
        const started = yield* Clock.currentTimeMillis;
        const answer = yield* Effect.result(askDecision([attempt], ask, buckets));
        const ms = (yield* Clock.currentTimeMillis) - started;
        byModel[MODELS[attempt.model].title + ` (${MODELS[attempt.model].provider})`] = Result.match(answer, {
          onSuccess: ({ value: { pick, confidence, vague, probabilities } }) => ({
            pick,
            confidence: Math.round(confidence * 100),
            vague: Math.round(vague * 100),
            top: probabilities
              .toSorted((a, b) => b.probability - a.probability)
              .slice(0, 3)
              .map(({ minutes, probability }) => `${minutes}m ${Math.round(probability * 100)}%`),
            ms,
          }),
          onFailure: (error) => ({ error: error.kind }),
        });
      }
      results.push({ title, byModel });
    }
    return results;
  }),
});
