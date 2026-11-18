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

export const plannedMinutes = (
  tasks: readonly { readonly _id: string; readonly estimateMinutes?: number | undefined }[],
  blocks: readonly { readonly taskId: string; readonly minutes: number }[],
) => {
  const timeboxed = new Set(blocks.map((block) => block.taskId));
  const boxed = blocks.reduce((sum, block) => sum + block.minutes, 0);
  return tasks.reduce((sum, task) => (timeboxed.has(task._id) ? sum : sum + (task.estimateMinutes ?? 0)), boxed);
};

export const blockMinutesFor = (estimateMinutes: number | undefined) =>
  estimateMinutes === undefined
    ? DEFAULT_BLOCK_MINUTES
    : Math.max(BLOCK_STEP_MINUTES, Math.round(estimateMinutes / BLOCK_STEP_MINUTES) * BLOCK_STEP_MINUTES);
