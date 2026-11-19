import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

export type DayPlanMark = { readonly date: string; readonly order: string };

type Planned = { readonly _id: string; readonly plan?: DayPlanMark | undefined };

export const DEFAULT_BLOCK_MINUTES = 30;
export const BLOCK_STEP_MINUTES = 15;

export const planOrder = (task: Planned, date: string) => (task.plan?.date === date ? task.plan.order : undefined);

export const byDayPlan =
  <T extends Planned>(date: string, fallback: (a: T, b: T) => number) =>
  (a: T, b: T) => {
    const first = planOrder(a, date);
    const second = planOrder(b, date);
    if (first !== undefined && second !== undefined) return first < second ? -1 : first > second ? 1 : fallback(a, b);
    if (first !== undefined) return -1;
    if (second !== undefined) return 1;
    return fallback(a, b);
  };

export const placeInDay = <Id extends string>(others: readonly (Planned & { readonly _id: Id })[], taskId: Id, index: number, date: string) => {
  const at = Math.min(Math.max(index, 0), others.length);
  const before = others[at - 1];
  const after = others[at];
  const lower = before && planOrder(before, date);
  const upper = after && planOrder(after, date);
  const fits = (before === undefined || lower !== undefined) && (lower === undefined || upper === undefined || lower < upper);
  if (fits) return [{ taskId, plan: { date, order: generateKeyBetween(lower ?? null, upper ?? null) } }];
  const ids: Id[] = [...others.slice(0, at).map((task) => task._id), taskId, ...others.slice(at).map((task) => task._id)];
  const keys = generateNKeysBetween(null, null, ids.length);
  const known = new Map<string, string | undefined>(others.map((task) => [task._id, planOrder(task, date)]));
  return ids.flatMap((id, position) => {
    const order = keys[position] ?? "a0";
    return known.get(id) === order ? [] : [{ taskId: id, plan: { date, order } }];
  });
};

export type LoadSource = "estimate" | "blocks" | "guess";

type LoadTask<Area> = { readonly _id: string; readonly estimateMinutes?: number | undefined; readonly area?: Area | undefined };

type LoadBlock<Area> = { readonly _id: string; readonly taskId: string; readonly minutes: number; readonly area?: Area | undefined };

export type LoadSlice<Area> = { readonly id: string; readonly area: Area | undefined; readonly minutes: number; readonly source: LoadSource };

export const dayLoad = <Area>(
  tasks: readonly LoadTask<Area>[],
  blocks: readonly LoadBlock<Area>[],
  guessOf: (taskId: string) => number | undefined,
) => {
  const boxed = new Map<string, number>();
  for (const block of blocks) boxed.set(block.taskId, (boxed.get(block.taskId) ?? 0) + block.minutes);
  const listed = new Set(tasks.map((task) => task._id));
  const slices: LoadSlice<Area>[] = [];
  let unestimated = 0;
  for (const task of tasks) {
    const timed = boxed.get(task._id);
    const guess = guessOf(task._id);
    if (timed !== undefined) slices.push({ id: task._id, area: task.area, minutes: timed, source: "blocks" });
    else if (task.estimateMinutes !== undefined) slices.push({ id: task._id, area: task.area, minutes: task.estimateMinutes, source: "estimate" });
    else if (guess !== undefined) slices.push({ id: task._id, area: task.area, minutes: guess, source: "guess" });
    else unestimated += 1;
  }
  for (const block of blocks)
    if (!listed.has(block.taskId)) slices.push({ id: block._id, area: block.area, minutes: block.minutes, source: "blocks" });
  const total = (guessed: boolean) =>
    slices.reduce((sum, slice) => ((slice.source === "guess") === guessed ? sum + slice.minutes : sum), 0);
  return { slices, plannedMinutes: total(false), guessedMinutes: total(true), unestimated };
};

export const MAX_GOAL_MINUTES = 24 * 60;

export const goalMinutesOf = (freeMinutes: number, goalMinutes: number | undefined) => goalMinutes ?? Math.max(0, freeMinutes);

export const blockMinutesFor = (estimateMinutes: number | undefined) =>
  estimateMinutes === undefined
    ? DEFAULT_BLOCK_MINUTES
    : Math.max(BLOCK_STEP_MINUTES, Math.round(estimateMinutes / BLOCK_STEP_MINUTES) * BLOCK_STEP_MINUTES);
