import { blockMinutesFor, dayShareOf } from "./plan";

export const SPREAD_BUFFER_MINUTES = 10;
export const SPREAD_STEP_MINUTES = 5;
export const MAX_SPREAD_BLOCKS = 100;

export type Span = { readonly start: number; readonly end: number };

type SpreadTask = { readonly _id: string; readonly estimateMinutes?: number | undefined };

export type SpreadBlock<Id extends string = string> = { readonly taskId: Id; readonly start: number; readonly minutes: number };

const onStep = (minute: number) => Math.ceil(minute / SPREAD_STEP_MINUTES) * SPREAD_STEP_MINUTES;

const padded = ({ start, end }: Span) => ({ start: start - SPREAD_BUFFER_MINUTES, end: end + SPREAD_BUFFER_MINUTES });

const firstFit = (taken: readonly Span[], from: number, minutes: number, until: number) => {
  let candidate = onStep(from);
  for (const span of taken) {
    if (candidate + minutes <= span.start) break;
    if (candidate < span.end) candidate = onStep(span.end);
  }
  return candidate + minutes <= until ? candidate : null;
};

export const spreadDay = <T extends SpreadTask>({
  tasks,
  boxed,
  guessOf,
  busy,
  window,
  cap,
}: {
  tasks: readonly T[];
  boxed: ReadonlySet<string>;
  guessOf: (taskId: string) => number | undefined;
  busy: readonly Span[];
  window: Span;
  cap: number;
}) => {
  const taken = busy.map(padded).toSorted((a, b) => a.start - b.start);
  const placed: SpreadBlock<T["_id"]>[] = [];
  const unfit: T[] = [];
  let cursor = window.start;
  for (const task of tasks) {
    if (boxed.has(task._id)) continue;
    const minutes = blockMinutesFor(dayShareOf(task.estimateMinutes ?? guessOf(task._id), cap));
    const start = firstFit(taken, cursor, minutes, window.end);
    if (start === null) {
      unfit.push(task);
      continue;
    }
    placed.push({ taskId: task._id, start, minutes });
    taken.push(padded({ start, end: start + minutes }));
    taken.sort((a, b) => a.start - b.start);
    cursor = start + minutes + SPREAD_BUFFER_MINUTES;
  }
  return { placed, unfit };
};
