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

export type Drop = Slot & { order?: string };

type Placeable = { kind: "task"; task: PlannerTask } | { kind: "header"; slot?: Slot } | { kind: "note" } | { kind: string };

export const drag = {
  host: makeMutable(""),
  gap: makeMutable(-1),
  held: makeMutable(false),
  frameTop: makeMutable(0),
  scrollY: makeMutable(0),
  gapTops: makeMutable<number[]>([]),
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

const isTail = (items: readonly Placeable[], gap: number) => gap === items.length || items[gap]?.kind === "header";

export const dropFor = (items: readonly Placeable[], gap: number, listSlot: Slot | undefined, tailOnly: boolean) => {
  const slot = items[gap - 1]?.kind === "note" || items[gap]?.kind === "note" ? undefined : sectionSlot(items, gap, listSlot);
  if (!slot || (tailOnly && !isTail(items, gap))) return undefined;
  const order = tailOnly ? undefined : keyBetween(neighbour(items, gap - 1, -1)?.order, neighbour(items, gap, 1)?.order);
  return (order ? { ...slot, order } : slot) satisfies Drop;
};
