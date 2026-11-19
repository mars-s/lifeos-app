import { err, ok } from "neverthrow";
import type { SmartEstimateError } from "./tables";

export const DECISIONS_URL = "https://api.openai.com/v1/decisions";
export const DECISIONS_MODEL = "gpt-6-luna";
export const QUESTION_NAME = "estimate";
export const NOTES_LIMIT = 600;
export const EXAMPLE_LIMIT = 6;
const MIN_CALIBRATION_TASKS = 3;
const MIN_COUNTED_ACTUAL_MINUTES = 5;
const TITLE_SHOWN = 40;

export const ESTIMATE_CHOICES = [
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

export type Calibration = { ratio: number; tasks: number };

export type EstimateSignal = { task: TaskSignal; examples: Example[]; calibration?: Calibration };

export type Suggestion = { minutes: number; confidence: number; model: string };

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

export const calibrationOf = (history: readonly PastTask[]) => {
  const ratios = history.flatMap(({ estimateMinutes, actualMinutes }) =>
    estimateMinutes !== undefined && actualMinutes !== undefined && actualMinutes >= MIN_COUNTED_ACTUAL_MINUTES
      ? [actualMinutes / estimateMinutes]
      : [],
  );
  return ratios.length < MIN_CALIBRATION_TASKS
    ? undefined
    : ({ ratio: Math.round(median(ratios) * 100) / 100, tasks: ratios.length } satisfies Calibration);
};

export const trimNotes = (notes: string) => {
  const trimmed = notes.trim().replace(/\s+/g, " ");
  return trimmed.length > NOTES_LIMIT ? `${trimmed.slice(0, NOTES_LIMIT - 1)}…` : trimmed;
};

const clock = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

export const decisionRequest = (signal: EstimateSignal) => ({
  model: DECISIONS_MODEL,
  input: [
    {
      role: "developer",
      content:
        "Estimate how long one person's Task will take. The JSON holds the Task and similar Tasks from their history. actualMinutes is focused time they really spent; estimateMinutes is what they planned. Trust actualMinutes over estimateMinutes. calibration.ratio is their usual actual time divided by their estimate: above 1 means they usually run over, so lean longer.",
    },
    { role: "user", content: [{ type: "input_json", data: signal }] },
  ],
  questions: [
    {
      type: "choice",
      name: QUESTION_NAME,
      instructions: "How long will this Task take, as focused work?",
      choices: ESTIMATE_CHOICES.map(({ minutes, description }) => ({ value: String(minutes), description })),
    },
  ],
});

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export const parseDecision = (body: unknown) => {
  const invalid = err<Suggestion, SmartEstimateError>({ kind: "invalid_response" });
  if (!isRecord(body) || !Array.isArray(body.answers)) return invalid;
  const answer: unknown = body.answers.find((entry: unknown) => isRecord(entry) && entry.name === QUESTION_NAME);
  if (!isRecord(answer)) return invalid;
  if (answer.type === "refusal") return err<Suggestion, SmartEstimateError>({ kind: "refused" });
  const minutes = typeof answer.choice === "string" ? Number(answer.choice) : Number.NaN;
  if (answer.type !== "choice" || !ESTIMATE_CHOICES.some((choice) => choice.minutes === minutes)) return invalid;
  return ok<Suggestion, SmartEstimateError>({
    minutes,
    confidence: typeof answer.confidence === "number" ? answer.confidence : 0,
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

const habit = (calibration: Calibration | undefined) => {
  if (!calibration) return "";
  const percent = Math.round(Math.abs(calibration.ratio - 1) * 100);
  if (calibration.ratio >= 1.15) return ` You usually run ${percent}% over.`;
  if (calibration.ratio <= 0.85) return ` You usually finish ${percent}% early.`;
  return "";
};

export const reasonFor = (signal: EstimateSignal, minutes: number) =>
  `${evidence(closestExample(signal.examples, minutes))}${habit(signal.calibration)}`;

export const canonicalJson = (value: unknown) =>
  JSON.stringify(value, (_key, inner: unknown) =>
    isRecord(inner) && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : inner,
  );
