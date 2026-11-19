import { err, ok } from "neverthrow";
import type { ChoiceAsk } from "../ai/transport";
import type { SmartEstimateError } from "./tables";

export const QUESTION_NAME = "estimate";
export const VAGUE_QUESTION = "too_vague";
export const PROMPT_CACHE_KEY = "lifeos-smart-estimate";
export const VAGUE_THRESHOLD = 0.7;
export const SURE_CONFIDENCE = 0.6;

export const CERTAINLY_VAGUE = 0.95;

export const isTooVague = ({ vague, confidence }: { vague: number; confidence: number }) =>
  vague >= CERTAINLY_VAGUE || (vague >= VAGUE_THRESHOLD && confidence < SURE_CONFIDENCE);
export const GUESS_FLOOR = 0.03;
export const GUESS_LIMIT = 3;
const PLACEHOLDER_TITLES = new Set(["new task", "untitled", "task", "todo", "to do", "to-do"]);
const MIN_SIMILAR_PAIRS = 2;
const NUDGE_BAND = 0.15;
export const NOTES_LIMIT = 600;
export const EXAMPLE_LIMIT = 6;
const MIN_CALIBRATION_TASKS = 3;
const MIN_COUNTED_ACTUAL_MINUTES = 5;
const TITLE_SHOWN = 40;

const MINUTE_BUCKETS = [
  { minutes: 5, value: "5 minutes", description: "One tiny action: a quick reply, a payment, or a booking already decided." },
  { minutes: 10, value: "10 minutes", description: "A quick errand or message that needs a little thought, such as a short email, a phone call or a simple purchase." },
  { minutes: 15, value: "15 minutes", description: "A short admin job with a couple of steps: fill in a form, tidy a document, arrange a time." },
  { minutes: 20, value: "20 minutes", description: "A small task with a few steps, or one short reading." },
  { minutes: 30, value: "30 minutes", description: "A small piece of focused work: a short write-up, a small fix, reading one article closely." },
  { minutes: 45, value: "45 minutes", description: "A modest piece of work with several steps or some research." },
  { minutes: 60, value: "1 hour", description: "About an hour of focused work: a draft section, one assignment question, a meeting with preparation." },
  { minutes: 90, value: "1.5 hours", description: "A substantial session: a full short draft, several papers, a tricky bug." },
  { minutes: 120, value: "2 hours", description: "A long deep-work block: a chapter section, a study session, building a small feature." },
  { minutes: 180, value: "3 hours", description: "Half a day on one piece of work: a large assignment part, a workshop, a complex build." },
  { minutes: 240, value: "4 hours", description: "Most of a morning or afternoon on one piece of work." },
  { minutes: 360, value: "6 hours", description: "Nearly a full working day on one piece of work." },
] as const;

const DAY_BUCKETS = [
  { days: 1, value: "1 working day", description: "A whole working day: a feature end to end, an essay draft, a big clean-up." },
  { days: 2, value: "2 working days", description: "Two working days: a sizeable feature, a full report, a migration of one part of a system." },
  { days: 3, value: "3 working days", description: "Most of a working week's first half: a large piece with several parts." },
  { days: 5, value: "1 working week", description: "A full working week: a rewrite of a component, a thesis chapter, a small product." },
  { days: 10, value: "2 working weeks", description: "Two working weeks or more: rewriting a whole system, a major project. Really a Project, not one Task." },
] as const;

export type Bucket = { minutes: number; value: string; description: string; days?: number };

export const bucketsFor = (dayMinutes: number) =>
  [
    ...MINUTE_BUCKETS.map((bucket) => ({ ...bucket }) satisfies Bucket),
    ...DAY_BUCKETS.map(({ days, value, description }) => ({ minutes: days * dayMinutes, value, description, days }) satisfies Bucket),
  ] as readonly Bucket[];

export type TaskSignal = {
  title: string;
  notes: string;
  checklistItems: number;
  area?: string;
  project?: string;
  labels: string[];
  travel?: string;
};

export type PastTask = TaskSignal & { projectKey?: string; estimateMinutes?: number; actualMinutes?: number };

export type Example = {
  title: string;
  area?: string;
  project?: string;
  labels: string[];
  estimateMinutes?: number;
  actualMinutes?: number;
};

export type Calibration = { ratio: number; tasks: number; scope: "similar" | "overall" };

export type EstimateSignal = { task: TaskSignal; examples: Example[] };

export type Probability = { minutes: number; probability: number };

export type Decision = { pick: number; confidence: number; probabilities: Probability[]; vague: number; model: string };

export type Guess = { minutes: number; probability: number };

const STOP_WORDS = new Set(["the", "and", "for", "with", "from", "into", "onto", "this", "that", "about", "your", "my", "our", "a", "an", "to", "of", "on", "in", "at", "by", "or"]);

export const titleWords = (title: string) =>
  new Set(
    title
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 3 && !STOP_WORDS.has(word)),
  );

export const isPlaceholderTitle = (title: string) =>
  PLACEHOLDER_TITLES.has(title.trim().toLowerCase()) || titleWords(title).size === 0;

const overlap = (a: ReadonlySet<string>, b: ReadonlySet<string>) => {
  const shared = [...a].filter((word) => b.has(word)).length;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
};

export const similarity = (task: TaskSignal & { projectKey?: string }, past: PastTask) => {
  const words = overlap(titleWords(task.title), titleWords(past.title));
  const sameProject = task.projectKey !== undefined && task.projectKey === past.projectKey ? 1 : 0;
  const sameArea = task.area !== undefined && task.area === past.area ? 1 : 0;
  const sharedLabels = task.labels.filter((label) => past.labels.includes(label)).length;
  return 3 * words + sameProject + sameArea + 0.5 * sharedLabels;
};

const hasHistory = (past: PastTask) => past.estimateMinutes !== undefined || past.actualMinutes !== undefined;

export const nearestExamples = (task: TaskSignal & { projectKey?: string }, history: readonly PastTask[]) =>
  history
    .filter(hasHistory)
    .map((past) => ({ past, score: similarity(task, past) }))
    .filter(({ score }) => score > 0)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, EXAMPLE_LIMIT)
    .map(({ past }) => {
      const example: Example = { title: past.title, labels: past.labels };
      if (past.area !== undefined) example.area = past.area;
      if (past.project !== undefined) example.project = past.project;
      if (past.estimateMinutes !== undefined) example.estimateMinutes = past.estimateMinutes;
      if (past.actualMinutes !== undefined) example.actualMinutes = past.actualMinutes;
      return example;
    });

const median = (values: readonly number[]) => {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

const runRatios = (tasks: readonly { estimateMinutes?: number; actualMinutes?: number }[]) =>
  tasks.flatMap(({ estimateMinutes, actualMinutes }) =>
    estimateMinutes !== undefined && actualMinutes !== undefined && actualMinutes >= MIN_COUNTED_ACTUAL_MINUTES
      ? [actualMinutes / estimateMinutes]
      : [],
  );

const calibrationFrom = (ratios: readonly number[], scope: Calibration["scope"]) =>
  ({ ratio: Math.round(median(ratios) * 100) / 100, tasks: ratios.length, scope }) satisfies Calibration;

export const calibrationOf = (examples: readonly Example[], history: readonly PastTask[]) => {
  const similar = runRatios(examples);
  if (similar.length >= MIN_SIMILAR_PAIRS) return calibrationFrom(similar, "similar");
  const overall = runRatios(history);
  return overall.length >= MIN_CALIBRATION_TASKS ? calibrationFrom(overall, "overall") : undefined;
};

const nearestChoice = (buckets: readonly Bucket[], minutes: number) =>
  buckets.map((bucket) => bucket.minutes).reduce((best, choice) =>
    Math.abs(Math.log(choice / minutes)) < Math.abs(Math.log(best / minutes)) ? choice : best,
  );

export const nudged = (buckets: readonly Bucket[], pick: number, calibration: Calibration | undefined) =>
  calibration && Math.abs(calibration.ratio - 1) > NUDGE_BAND ? nearestChoice(buckets, pick * calibration.ratio) : pick;

const rounded = (probability: number) => Math.round(probability * 1000) / 1000;

export const guessesFrom = (
  buckets: readonly Bucket[],
  decision: Pick<Decision, "pick" | "confidence" | "probabilities">,
  calibration: Calibration | undefined,
) => {
  const merged = new Map<number, number>();
  for (const { minutes, probability } of decision.probabilities) {
    const bucket = nudged(buckets, minutes, calibration);
    merged.set(bucket, (merged.get(bucket) ?? 0) + probability);
  }
  const ranked = [...merged]
    .map(([minutes, probability]) => ({ minutes, probability: rounded(probability) }) satisfies Guess)
    .filter(({ probability }) => probability >= GUESS_FLOOR)
    .toSorted((a, b) => b.probability - a.probability)
    .slice(0, GUESS_LIMIT);
  const guesses = ranked.length > 0 ? ranked : [{ minutes: nudged(buckets, decision.pick, calibration), probability: rounded(decision.confidence) }];
  return { guesses: guesses.toSorted((a, b) => a.minutes - b.minutes), likely: guesses[0]?.minutes ?? decision.pick };
};

export const trimNotes = (notes: string) => {
  const trimmed = notes.trim().replace(/\s+/g, " ");
  return trimmed.length > NOTES_LIMIT ? `${trimmed.slice(0, NOTES_LIMIT - 1)}…` : trimmed;
};

export const clock = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

const INSTRUCTIONS =
  "You estimate how long one person's Task will take as focused work, from its title and description. Similar past Tasks from their own history follow as JSON when there are any: actualMinutes is the focused time they really spent and estimateMinutes is what they planned. When a similar Task has actualMinutes, trust it over estimateMinutes.";

const line = (label: string, value: string | undefined) => (value ? [`${label}: ${value}`] : []);

export const taskText = (task: TaskSignal) =>
  [
    ...line("Task", task.title),
    ...line("Description", task.notes),
    ...line("Checklist", task.checklistItems > 0 ? `${task.checklistItems} steps` : undefined),
    ...line("Area", task.area),
    ...line("Project", task.project),
    ...line("Labels", task.labels.join(", ")),
    ...line("Travel", task.travel),
  ].join("\n");

export const estimateAsk = (signal: EstimateSignal, buckets: readonly Bucket[]) =>
  ({
  cacheKey: PROMPT_CACHE_KEY,
  instructions: INSTRUCTIONS,
  parts: [
    { type: "input_text", text: taskText(signal.task) },
    ...(signal.examples.length > 0 ? [{ type: "input_json" as const, data: { similarPastTasks: signal.examples } }] : []),
  ],
  questions: [
    {
      type: "choice",
      name: QUESTION_NAME,
      instructions: "How long will this Task take as focused work?",
      choices: buckets.map(({ value, description }) => ({ value, description })),
    },
    {
      type: "predicate",
      name: VAGUE_QUESTION,
      instructions: "Is this Task too unclear to estimate, because you cannot tell what work it means, such as a placeholder or a bare word like stuff or misc? A big or open-ended piece of work is not unclear when you can tell what it is.",
    },
  ],
}) satisfies ChoiceAsk;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const offeredMinutes = (buckets: readonly Bucket[], value: unknown) => buckets.find((bucket) => bucket.value === value)?.minutes;

const probabilitiesOf = (buckets: readonly Bucket[], value: unknown) =>
  (Array.isArray(value) ? value : []).flatMap((entry: unknown) => {
    if (!isRecord(entry) || typeof entry.probability !== "number") return [];
    const minutes = offeredMinutes(buckets, entry.value);
    return minutes === undefined ? [] : [{ minutes, probability: Math.round(entry.probability * 1000) / 1000 }];
  });

export const parseDecision = (buckets: readonly Bucket[], body: unknown) => {
  const invalid = err<Decision, SmartEstimateError>({ kind: "invalid_response" });
  if (!isRecord(body) || !Array.isArray(body.answers)) return invalid;
  const answers: unknown[] = body.answers;
  const named = (name: string) => answers.find((entry): entry is Record<string, unknown> => isRecord(entry) && entry.name === name);
  const answer = named(QUESTION_NAME);
  if (!answer) return invalid;
  if (answer.type === "refusal") return err<Decision, SmartEstimateError>({ kind: "refused" });
  const pick = offeredMinutes(buckets, answer.choice);
  if (answer.type !== "choice" || pick === undefined) return invalid;
  const vague = named(VAGUE_QUESTION);
  return ok<Decision, SmartEstimateError>({
    pick,
    confidence: typeof answer.confidence === "number" ? answer.confidence : 0,
    probabilities: probabilitiesOf(buckets, answer.probabilities),
    vague: vague?.type === "predicate" && typeof vague.probability === "number" ? vague.probability : 0,
    model: typeof body.model === "string" ? body.model : "unknown",
  });
};

const shown = (title: string) => (title.length > TITLE_SHOWN ? `${title.slice(0, TITLE_SHOWN - 1)}…` : title);

const closestExample = (examples: readonly Example[], minutes: number) =>
  examples
    .slice(0, 3)
    .map((example) => ({ example, spent: example.actualMinutes ?? example.estimateMinutes }))
    .flatMap(({ example, spent }) => (spent === undefined ? [] : [{ example, distance: Math.abs(Math.log(spent / minutes)) }]))
    .toSorted((a, b) => a.distance - b.distance)[0]?.example;

const evidence = (example: Example | undefined) => {
  if (!example) return "From the title and notes.";
  const title = `“${shown(example.title)}”`;
  return example.actualMinutes === undefined
    ? `Like ${title}, which you estimated at ${clock(example.estimateMinutes ?? 0)}.`
    : `Like ${title}, which took ${clock(example.actualMinutes)}.`;
};

const habit = (calibration: Calibration | undefined, pick: number, minutes: number) => {
  if (!calibration || Math.abs(calibration.ratio - 1) <= NUDGE_BAND) return "";
  const percent = Math.round(Math.abs(calibration.ratio - 1) * 100);
  const which = calibration.scope === "similar" ? " on Tasks like this" : "";
  const moved = minutes === pick ? "" : `, so not ${clock(pick)}`;
  return calibration.ratio > 1 ? ` You usually run ${percent}% over${which}${moved}.` : ` You usually finish ${percent}% early${which}${moved}.`;
};

export const reasonFor = (signal: EstimateSignal, calibration: Calibration | undefined, pick: number, minutes: number) =>
  `${evidence(closestExample(signal.examples, minutes))}${habit(calibration, pick, minutes)}`;

export const canonicalJson = (value: unknown) =>
  JSON.stringify(value, (_key, inner: unknown) =>
    isRecord(inner) && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : inner,
  );

export const TRAVEL_ADDED = "Not part of this Estimate. If the Task means going somewhere, estimate only the time spent there. LifeOS adds the trip there and back.";

export type TripTime = { name: string; minutes: number };

export const withTrip = <View extends { guesses: Guess[]; likely: number; reason: string }>(view: View, trip: TripTime | null) =>
  trip
    ? {
        ...view,
        guesses: view.guesses.map((guess) => ({ ...guess, minutes: guess.minutes + trip.minutes })),
        likely: view.likely + trip.minutes,
        reason: `${clock(view.likely)} at ${trip.name} plus ${clock(trip.minutes)} there and back. ${view.reason}`,
      }
    : view;
