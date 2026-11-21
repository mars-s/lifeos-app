import { generateKeyBetween } from "fractional-indexing";
import { makeMutable } from "react-native-reanimated";
import type { PlannerTask } from "@lifeos/backend/types";

export const GAP = 52;

export type Slot = {
  when: PlannerTask["when"];
  parent: PlannerTask["parent"];
  label: string;
  context?: string;
  area?: PlannerTask["area"];
  project?: PlannerTask["project"];
};

export type Ordering = "key" | "day";

export type DayPlace = { ids: string[]; at: number };

export type Drop = Slot & { order?: string; day?: DayPlace };

type Placeable = { kind: "task"; task: PlannerTask } | { kind: "header"; slot?: Slot } | { kind: "note" } | { kind: string };

export const drag = {
  host: makeMutable(""),
  gap: makeMutable(-1),
  held: makeMutable(false),
  frameTop: makeMutable(0),
  scrollY: makeMutable(0),
  gapTops: makeMutable<number[]>([]),
  rowTops: makeMutable<number[]>([]),
  source: makeMutable(-1),
  target: makeMutable(-1),
  size: makeMutable(0),
  dy: makeMutable(0),
  startScroll: makeMutable(0),
  allowed: makeMutable<boolean[]>([]),
  quiet: makeMutable(false),
};

type Mover = {
  lift: (index: number) => void;
  drop: (index: number, target: number, canceled: boolean) => void;
  nudge: (index: number, step: -1 | 1) => void;
};

const movers = new Map<string, Mover>();

export const setMover = (host: string, mover: Mover | null) => {
  if (mover) movers.set(host, mover);
  else movers.delete(host);
};

export const liftRow = (host: string, index: number) => movers.get(host)?.lift(index);

export const dropRow = (host: string, index: number, target: number, canceled: boolean) => movers.get(host)?.drop(index, target, canceled);

export const nudgeRow = (host: string, index: number, step: -1 | 1) => movers.get(host)?.nudge(index, step);

export const reorderTarget = () => {
  "worklet";
  const tops = drag.rowTops.get();
  const source = drag.source.get();
  const allowed = drag.allowed.get();
  const centre = (tops[source] ?? 0) + drag.size.get() / 2 + drag.dy.get() + drag.scrollY.get() - drag.startScroll.get();
  let position = 0;
  for (let index = 0; index + 1 < tops.length; index += 1) {
    if (index === source) continue;
    const middle = ((tops[index] ?? 0) + (tops[index + 1] ?? 0)) / 2;
    if (middle < centre) position += 1;
  }
  for (let reach = 0; reach < allowed.length; reach += 1) {
    if (allowed[position - reach]) return position - reach;
    if (allowed[position + reach]) return position + reach;
  }
  return source;
};

export const landingOffset = (source: number, target: number) => {
  "worklet";
  const tops = drag.rowTops.get();
  if (target > source) return (tops[target + 1] ?? 0) - (tops[source + 1] ?? 0);
  return (tops[target] ?? 0) - (tops[source] ?? 0);
};

export const shiftFor = (index: number) => {
  "worklet";
  const source = drag.source.get();
  const target = drag.target.get();
  const size = drag.size.get();
  const position = index < source ? index : index - 1;
  if (index < source && position >= target) return size;
  if (index > source && position < target) return -size;
  return 0;
};

const resolvers = new Map<string, (gap: number) => Drop | undefined>();

export const setDropResolver = (host: string, resolve: ((gap: number) => Drop | undefined) | null) => {
  if (resolve) resolvers.set(host, resolve);
  else resolvers.delete(host);
};

export const dropAt = (gap: number) => resolvers.get(drag.host.get())?.(gap);

export const nearestGap = (fingerY: number) => {
  "worklet";
  const tops = drag.gapTops.get();
  const open = drag.gap.get();
  const y = fingerY - drag.frameTop.get() + drag.scrollY.get();
  let best = -1;
  let distance = Number.POSITIVE_INFINITY;
  for (let gap = 0; gap < tops.length; gap += 1) {
    const top = tops[gap];
    if (top === undefined || Number.isNaN(top)) continue;
    const shown = open >= 0 && gap > open ? top + GAP : top;
    const away = Math.abs(shown + GAP / 2 - y);
    if (away < distance) {
      distance = away;
      best = gap;
    }
  }
  return best;
};

const isTask = (item: Placeable | undefined): item is { kind: "task"; task: PlannerTask } => item?.kind === "task";

const sectionSlot = (items: readonly Placeable[], gap: number, listSlot: Slot | undefined) => {
  for (let index = gap - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind === "header") return (item as { slot?: Slot }).slot;
  }
  return listSlot;
};

const neighbour = (items: readonly Placeable[], from: number, step: 1 | -1) => {
  for (let index = from; index >= 0 && index < items.length; index += step) {
    const item = items[index];
    if (isTask(item)) return item.task;
    if (item?.kind === "header") return undefined;
  }
  return undefined;
};

const keyBetween = (above: string | undefined, below: string | undefined) => {
  try {
    return generateKeyBetween(above ?? null, below ?? null);
  } catch {
    return undefined;
  }
};

const sectionTasks = (items: readonly Placeable[], gap: number) => {
  let start = gap;
  while (start > 0 && items[start - 1]?.kind !== "header") start -= 1;
  let end = gap;
  while (end < items.length && items[end]?.kind !== "header") end += 1;
  const tasks = items.slice(start, end).flatMap((item, index) => (isTask(item) ? [{ id: item.task._id as string, index: start + index }] : []));
  return { ids: tasks.map((task) => task.id), at: tasks.filter((task) => task.index < gap).length };
};

export const dropFor = (items: readonly Placeable[], gap: number, listSlot: Slot | undefined, ordering: Ordering) => {
  const slot = items[gap - 1]?.kind === "note" || items[gap]?.kind === "note" ? undefined : sectionSlot(items, gap, listSlot);
  if (!slot) return undefined;
  if (ordering === "day" && slot.when.kind !== "scheduled") return undefined;
  const order = ordering === "day" ? undefined : keyBetween(neighbour(items, gap - 1, -1)?.order, neighbour(items, gap, 1)?.order);
  const drop: Drop = { ...slot, ...(order ? { order } : {}), ...(ordering === "day" ? { day: sectionTasks(items, gap) } : {}) };
  return drop;
};
