import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { revealSecret } from "../platform/secrets";
import { bucketsFor, DECISIONS_MODEL, DECISIONS_URL, decisionRequest, parseDecision, taskText, type Bucket, type EstimateSignal } from "./smartEstimateModel";

const SIZES = [
  { value: "under an hour", description: "A quick or small Task, done in one sitting of less than an hour.", upTo: 45 },
  { value: "a few hours", description: "One to six hours of focused work, finished within a day.", upTo: 360 },
  { value: "days or weeks", description: "A whole working day or more: big pieces of work, rewrites, projects.", upTo: Number.POSITIVE_INFINITY },
] as const;

const post = async (key: string, body: unknown) => {
  const response = await fetch(DECISIONS_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as unknown };
};

const signalOf = (title: string, notes: string) =>
  ({ task: { title, notes, checklistItems: 0, labels: [] }, examples: [] }) satisfies EstimateSignal;

const top = (buckets: readonly Bucket[], body: unknown) =>
  parseDecision(buckets, body).match(
    ({ pick, confidence, probabilities, vague }) => ({
      pick,
      confidence,
      vague,
      top: probabilities
        .toSorted((a, b) => b.probability - a.probability)
        .slice(0, 3)
        .map(({ minutes, probability }) => `${minutes}m ${Math.round(probability * 100)}%`),
    }),
    (error) => ({ error: error.kind }),
  );

export const compare = internalAction({
  args: { tasks: v.array(v.object({ title: v.string(), notes: v.optional(v.string()) })), dayMinutes: v.optional(v.number()) },
  handler: async (ctx, { tasks, dayMinutes = 510 }) => {
    const key = await revealSecret(ctx, "openai");
    if (!key) return { error: "not_configured" };
    const buckets = bucketsFor(dayMinutes);
    const results = [];
    for (const { title, notes = "" } of tasks) {
      const signal = signalOf(title, notes);
      const single = await post(key, decisionRequest(signal, buckets));
      const coarse = await post(key, {
        model: DECISIONS_MODEL,
        input: [{ role: "user", content: taskText(signal.task) }],
        questions: [
          {
            type: "choice",
            name: "size",
            instructions: "Roughly how big is this Task?",
            choices: SIZES.map(({ value, description }) => ({ value, description })),
          },
        ],
      });
      const answer = (coarse.body as { answers?: { choice?: string }[] }).answers?.[0]?.choice;
      const size = SIZES.findIndex((entry) => entry.value === answer);
      const lower = size <= 0 ? 0 : (SIZES[size - 1]?.upTo ?? 0);
      const band = buckets.filter((bucket) => bucket.minutes > lower && bucket.minutes <= (SIZES[size]?.upTo ?? Number.POSITIVE_INFINITY));
      const fine = await post(key, decisionRequest(signal, band.length >= 2 ? band : buckets));
      results.push({
        title,
        single: top(buckets, single.body),
        twoStep: { size: answer, ...top(band.length >= 2 ? band : buckets, fine.body) },
      });
    }
    return results;
  },
});
