import { blockMinutesFor, dayShareOf } from "./plan";
import { SPREAD_BUFFER_MINUTES, SPREAD_STEP_MINUTES, type Span } from "./spread";

export const PREDICT_DAYS = 2;
export const LOW_ENERGY_BUFFER_MINUTES = 15;
export const FOCUS_MINUTES = 60;
export const LIGHT_MINUTES = 20;

export type EnergyWindows = { readonly peak: Span; readonly dip: Span; readonly low: boolean };

export type Fit = "peak" | "dip";

type PredictTask = {
  readonly _id: string;
  readonly estimateMinutes?: number | undefined;
  readonly labels?: readonly { readonly name: string }[] | undefined;
};

export type Prediction<Id extends string = string> = {
  readonly taskId: Id;
  readonly start: number;
  readonly minutes: number;
  readonly travel: number;
  readonly guess: boolean;
  readonly fit: Fit | undefined;
};

type Kind = "focus" | "light" | "plain";

const onStep = (minute: number) => Math.ceil(minute / SPREAD_STEP_MINUTES) * SPREAD_STEP_MINUTES;

const labelled = (task: PredictTask, name: string) => task.labels?.some((label) => label.name.trim().toLowerCase() === name) === true;

export const kindOf = (task: PredictTask, whole: number | undefined, minutes: number, travel: number) => {
  const kind: Kind =
    labelled(task, "deep work") || (whole !== undefined && whole >= FOCUS_MINUTES)
      ? "focus"
      : labelled(task, "admin") || travel > 0 || minutes <= LIGHT_MINUTES
        ? "light"
        : "plain";
  return kind;
};

const firstFit = (taken: readonly Span[], from: number, minutes: number, until: number) => {
  let candidate = onStep(from);
  for (const span of taken) {
    if (candidate + minutes <= span.start) break;
    if (candidate < span.end) candidate = onStep(span.end);
  }
  return candidate + minutes <= until ? candidate : null;
};

const within = (minute: number, span: Span) => minute >= span.start && minute < span.end;

export const predictDay = <T extends PredictTask>({
  tasks,
  boxed,
  guessOf,
  travelOf = () => 0,
  busy,
  window,
  cap,
  energy = null,
}: {
  tasks: readonly T[];
  boxed: ReadonlySet<string>;
  guessOf: (taskId: string) => number | undefined;
  travelOf?: (taskId: string) => number;
  busy: readonly Span[];
  window: Span;
  cap: number;
  energy?: EnergyWindows | null;
}) => {
  const buffer = energy?.low ? LOW_ENERGY_BUFFER_MINUTES : SPREAD_BUFFER_MINUTES;
  const padded = ({ start, end }: Span) => ({ start: start - buffer, end: end + buffer });
  const taken = busy.map(padded).toSorted((a, b) => a.start - b.start);
  const sized = tasks
    .filter((task) => !boxed.has(task._id))
    .map((task, order) => {
      const whole = task.estimateMinutes ?? guessOf(task._id);
      const minutes = blockMinutesFor(dayShareOf(whole, cap));
      const travel = Math.max(0, Math.round(travelOf(task._id)));
      return { task, order, minutes, travel, guess: task.estimateMinutes === undefined && whole !== undefined, kind: kindOf(task, whole, minutes, travel) };
    });
  const rank = { focus: 0, light: 1, plain: 2 } as const;
  const queue = energy ? sized.toSorted((a, b) => rank[a.kind] - rank[b.kind] || a.order - b.order) : sized;
  const preferred = (kind: Kind) => (energy && kind === "focus" ? energy.peak.start : energy && kind === "light" ? energy.dip.start : window.start);
  const cursors = new Map<Kind, number>();
  const placed: Prediction<T["_id"]>[] = [];
  const unfit: T[] = [];
  for (const { task, minutes, travel, guess, kind } of queue) {
    const lane = energy ? kind : "plain";
    const from = Math.max(window.start, cursors.get(lane) ?? preferred(kind));
    const outer = minutes + travel * 2;
    const found = firstFit(taken, from, outer, window.end) ?? (from > window.start ? firstFit(taken, window.start, outer, window.end) : null);
    if (found === null) {
      unfit.push(task);
      continue;
    }
    const start = found + travel;
    const fit = !energy ? undefined : kind === "focus" && within(start, energy.peak) ? "peak" : kind === "light" && within(start, energy.dip) ? "dip" : undefined;
    placed.push({ taskId: task._id, start, minutes, travel, guess, fit });
    taken.push(padded({ start: found, end: found + outer }));
    taken.sort((a, b) => a.start - b.start);
    cursors.set(lane, found + outer + buffer);
  }
  return { placed: placed.toSorted((a, b) => a.start - b.start), unfit };
};

export type DayLoadInk = { readonly done: number; readonly kept: number; readonly predicted: number };

export const inkLoad = (
  blocks: readonly { readonly minutes: number; readonly done: boolean }[],
  predictions: readonly { readonly minutes: number }[],
) =>
  ({
    done: blocks.reduce((sum, block) => (block.done ? sum + block.minutes : sum), 0),
    kept: blocks.reduce((sum, block) => (block.done ? sum : sum + block.minutes), 0),
    predicted: predictions.reduce((sum, prediction) => sum + prediction.minutes, 0),
  }) satisfies DayLoadInk;

export const isPredictedDay = (date: string, today: string, tomorrow: string) => date === today || date === tomorrow;
