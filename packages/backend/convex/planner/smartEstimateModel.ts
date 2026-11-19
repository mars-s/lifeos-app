import { err, ok } from "neverthrow";
import type { SmartEstimateError } from "./tables";

export const DECISIONS_URL = "https://api.openai.com/v1/decisions";
export const DECISIONS_MODEL = "gpt-6-luna";
export const QUESTION_NAME = "estimate";
export const VAGUE_QUESTION = "too_vague";
export const PROMPT_CACHE_KEY = "lifeos-smart-estimate";
export const VAGUE_THRESHOLD = 0.7;
export const SHOW_CONFIDENCE = 0.3;
const MIN_SIMILAR_PAIRS = 2;
const NUDGE_BAND = 0.15;
export const NOTES_LIMIT = 600;
export const EXAMPLE_LIMIT = 6;
const MIN_CALIBRATION_TASKS = 3;
const MIN_COUNTED_ACTUAL_MINUTES = 5;
const TITLE_SHOWN = 40;

export const ESTIMATE_CHOICES = [
  { minutes: 5, description: "0:05. A two minute job, such as a quick reply." },
  { minutes: 10, description: "0:10. A quick message, call or errand." },
  { minutes: 15, description: "0:15. A short admin step or a small fix." },
  { minutes: 30, description: "0:30. A small piece of focused work." },
  { minutes: 45, description: "0:45. A modest piece of work with a few steps." },
  { minutes: 60, description: "1:00. A solid hour of focused work." },
  { minutes: 90, description: "1:30. A substantial piece of work." },
  { minutes: 120, description: "2:00. A long session, such as a first draft or a study block." },
  { minutes: 180, description: "3:00. Half a day of deep work." },
  { minutes: 240, description: "4:00. A very large piece of work." },
] as const;

export type TaskSignal = {
  title: string;
  notes: string;
  checklistItems: number;
  area?: string;
  project?: string;
  labels: string[];
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

const STOP_WORDS = new Set(["the", "and", "for", "with", "from", "into", "onto", "this", "that", "about", "your", "my", "our", "a", "an", "to", "of", "on", "in", "at", "by", "or"]);

export const titleWords = (title: string) =>
  new Set(
    title
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 3 && !STOP_WORDS.has(word)),
  );

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

const nearestChoice = (minutes: number) =>
  ESTIMATE_CHOICES.map((choice) => choice.minutes).reduce((best, choice) =>
    Math.abs(Math.log(choice / minutes)) < Math.abs(Math.log(best / minutes)) ? choice : best,
  );

export const nudged = (pick: number, calibration: Calibration | undefined) =>
  calibration && Math.abs(calibration.ratio - 1) > NUDGE_BAND ? nearestChoice(pick * calibration.ratio) : pick;

export const trimNotes = (notes: string) => {
  const trimmed = notes.trim().replace(/\s+/g, " ");
  return trimmed.length > NOTES_LIMIT ? `${trimmed.slice(0, NOTES_LIMIT - 1)}…` : trimmed;
};

const clock = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

const INSTRUCTIONS =
  "Estimate how long one person's Task will take as focused work. The JSON holds the Task and the most similar Tasks from their history. actualMinutes is focused time they really spent; estimateMinutes is what they planned. When a similar Task has actualMinutes, trust it over estimateMinutes.";

export const decisionRequest = (signal: EstimateSignal) => ({
  model: DECISIONS_MODEL,
  prompt_cache_key: PROMPT_CACHE_KEY,
  input: [
    { role: "developer", content: INSTRUCTIONS },
    { role: "user", content: [{ type: "input_json", data: signal }] },
  ],
  questions: [
    {
      type: "choice",
      name: QUESTION_NAME,
      instructions: "How long will this Task take, as focused work?",
      choices: ESTIMATE_CHOICES.map(({ minutes, description }) => ({ value: String(minutes), description })),
    },
    {
      type: "predicate",
      name: VAGUE_QUESTION,
      instructions: "Is this Task too vague to estimate, such as a bare word or a placeholder with no clear piece of work?",
    },
  ],
});

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const offeredMinutes = (value: unknown) => {
  const minutes = typeof value === "string" ? Number(value) : Number.NaN;
  return ESTIMATE_CHOICES.some((choice) => choice.minutes === minutes) ? minutes : undefined;
};

const probabilitiesOf = (value: unknown) =>
  (Array.isArray(value) ? value : []).flatMap((entry: unknown) => {
    if (!isRecord(entry) || typeof entry.probability !== "number") return [];
    const minutes = offeredMinutes(entry.value);
    return minutes === undefined ? [] : [{ minutes, probability: Math.round(entry.probability * 1000) / 1000 }];
  });

export const parseDecision = (body: unknown) => {
  const invalid = err<Decision, SmartEstimateError>({ kind: "invalid_response" });
  if (!isRecord(body) || !Array.isArray(body.answers)) return invalid;
  const answers: unknown[] = body.answers;
  const named = (name: string) => answers.find((entry): entry is Record<string, unknown> => isRecord(entry) && entry.name === name);
  const answer = named(QUESTION_NAME);
  if (!answer) return invalid;
  if (answer.type === "refusal") return err<Decision, SmartEstimateError>({ kind: "refused" });
  const pick = offeredMinutes(answer.choice);
  if (answer.type !== "choice" || pick === undefined) return invalid;
  const vague = named(VAGUE_QUESTION);
  return ok<Decision, SmartEstimateError>({
    pick,
    confidence: typeof answer.confidence === "number" ? answer.confidence : 0,
    probabilities: probabilitiesOf(answer.probabilities),
    vague: vague?.type === "predicate" && typeof vague.probability === "number" ? vague.probability : 0,
    model: typeof body.model === "string" ? body.model : DECISIONS_MODEL,
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
