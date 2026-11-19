import type { CalendarSchedule, Colour } from "../convex/planner/tables";
import { daysBetween, type IsoDate } from "./date";
import { occursOn } from "./recurrence";

export const SMART_BLOCK_STEP_MINUTES = 5;
export const SMART_BLOCK_BUFFER_MINUTES = 5;
export const DEFAULT_FILL_MINUTES = 30;
export const MIN_SMART_BLOCK_MINUTES = 15;
export const FOREVER = "9999-12-31";

const DAY_MS = 86_400_000;
const SOON_DAYS = 7;
const AGE_CAP_DAYS = 30;
const LONG_WAIT_DAYS = 14;
const SCARCE = 0.5;
const NEUTRAL_AREA = 0.5;
const WEIGHTS = { urgency: 45, area: 35, committed: 15, age: 5 } as const;
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export type { CalendarSchedule };

export type Span = { readonly start: number; readonly end: number };

export type SmartBlockFilter = {
  readonly areaIds: readonly string[];
  readonly projectIds: readonly string[];
  readonly labelIds: readonly string[];
};

export const ALL_TASKS: SmartBlockFilter = { areaIds: [], projectIds: [], labelIds: [] };

export type FillTask = {
  readonly _id: string;
  readonly title: string;
  readonly areaId?: string | undefined;
  readonly projectId?: string | undefined;
  readonly labelIds: readonly string[];
  readonly deadline?: string | undefined;
  readonly scheduled?: string | undefined;
  readonly planOrder?: string | undefined;
  readonly createdAt: number;
  readonly estimateMinutes?: number | undefined;
  readonly guessMinutes?: number | undefined;
  readonly colour?: Colour | undefined;
};

export type FillBlock = {
  readonly blockId: string;
  readonly taskId: string;
  readonly start: number;
  readonly minutes: number;
  readonly smartBlock?: { readonly blockId: string; readonly date: string } | undefined;
};

export type FillArea = { readonly _id: string; readonly title: string };

export type FillSnapshot = {
  readonly date: string;
  readonly tasks: readonly FillTask[];
  readonly blocks: readonly FillBlock[];
  readonly busy: readonly Span[];
  readonly areas: readonly FillArea[];
  readonly freeMinutes: readonly number[];
};

export type FillEdits = { readonly exclude: readonly string[]; readonly prefer: readonly string[] };

export const NO_EDITS: FillEdits = { exclude: [], prefer: [] };

export type SizeSource = "estimate" | "guess" | "default";

export type FillCandidate = {
  readonly task: FillTask;
  readonly minutes: number;
  readonly source: SizeSource;
  readonly reason: string;
  readonly score: number;
};

export type FillPick = FillCandidate & { readonly start: number };

export type FillSkip = FillCandidate & { readonly why: "too_long" | "no_room" };

const onStep = (minute: number) => Math.ceil(minute / SMART_BLOCK_STEP_MINUTES) * SMART_BLOCK_STEP_MINUTES;

export const sizeOf = (task: FillTask) => {
  if (task.estimateMinutes !== undefined) return { minutes: onStep(task.estimateMinutes), source: "estimate" as SizeSource };
  if (task.guessMinutes !== undefined) return { minutes: onStep(task.guessMinutes), source: "guess" as SizeSource };
  return { minutes: DEFAULT_FILL_MINUTES, source: "default" as SizeSource };
};

export const isEligible = (task: FillTask, filter: SmartBlockFilter) => {
  const anyPlace = filter.areaIds.length === 0 && filter.projectIds.length === 0;
  const inPlace =
    anyPlace ||
    (task.areaId !== undefined && filter.areaIds.includes(task.areaId)) ||
    (task.projectId !== undefined && filter.projectIds.includes(task.projectId));
  return inPlace && (filter.labelIds.length === 0 || task.labelIds.some((label) => filter.labelIds.includes(label)));
};

const weekdayOf = (date: string) => WEEKDAYS[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7] ?? "";

const shortDate = (date: string) => {
  const at = new Date(`${date}T00:00:00Z`);
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()] ?? ""}`;
};

const compare = <T extends string | number>(a: T, b: T) => (a < b ? -1 : a > b ? 1 : 0);

const ranker = (snapshot: FillSnapshot) => {
  const date = snapshot.date as IsoDate;
  const dayStart = Date.parse(`${date}T00:00:00Z`);
  const areaIndex = new Map(snapshot.areas.map((area, index) => [area._id, index]));
  const lastIndex = snapshot.areas.length - 1;
  const areaWeight = (areaId: string | undefined) => {
    const index = areaId === undefined ? undefined : areaIndex.get(areaId);
    if (index === undefined) return NEUTRAL_AREA;
    return lastIndex <= 0 ? 1 : 1 - index / lastIndex;
  };
  const freeUntil = (daysLeft: number) =>
    snapshot.freeMinutes.slice(0, Math.min(daysLeft, snapshot.freeMinutes.length - 1) + 1).reduce((sum, minutes) => sum + Math.max(0, minutes), 0);
  const urgencyOf = (task: FillTask, minutes: number) => {
    if (task.deadline === undefined) return { urgency: 0, scarcity: 0 };
    const daysLeft = daysBetween(date, task.deadline as IsoDate);
    if (daysLeft <= 0) return { urgency: 1, scarcity: 1 };
    const free = freeUntil(daysLeft);
    const scarcity = free > 0 ? Math.min(1, minutes / free) : 1;
    return { urgency: Math.max(scarcity, Math.max(0, 1 - daysLeft / SOON_DAYS)), scarcity };
  };
  const ageDays = (task: FillTask) => Math.max(0, (dayStart - task.createdAt) / DAY_MS);
  const committed = (task: FillTask) => task.scheduled !== undefined && task.scheduled <= date;

  const reasonOf = (task: FillTask, scarcity: number) => {
    if (task.deadline !== undefined) {
      const daysLeft = daysBetween(date, task.deadline as IsoDate);
      if (daysLeft < 0) return "Overdue";
      if (daysLeft === 0) return "Due today";
      if (daysLeft === 1) return "Deadline tomorrow";
      if (daysLeft < SOON_DAYS) return `Deadline ${weekdayOf(task.deadline)}`;
      if (scarcity >= SCARCE) return `Deadline ${shortDate(task.deadline)}`;
    }
    if (committed(task)) return "On the Day Plan";
    const area = task.areaId === undefined ? undefined : snapshot.areas[areaIndex.get(task.areaId) ?? -1];
    if (area && areaIndex.get(area._id) === 0 && lastIndex > 0) return `${area.title} first`;
    const waited = ageDays(task);
    if (waited >= LONG_WAIT_DAYS) return `Waiting ${Math.floor(waited / 7)} weeks`;
    return area?.title ?? "Fits the time";
  };

  return (task: FillTask) => {
    const { minutes, source } = sizeOf(task);
    const { urgency, scarcity } = urgencyOf(task, minutes);
    const score =
      WEIGHTS.urgency * urgency +
      WEIGHTS.area * areaWeight(task.areaId) +
      WEIGHTS.committed * (committed(task) ? 1 : 0) +
      WEIGHTS.age * (Math.min(AGE_CAP_DAYS, ageDays(task)) / AGE_CAP_DAYS);
    return { task, minutes, source, score, reason: reasonOf(task, scarcity) } satisfies FillCandidate;
  };
};

const byRank = (prefer: readonly string[]) => (a: FillCandidate, b: FillCandidate) => {
  const pickedA = prefer.indexOf(a.task._id);
  const pickedB = prefer.indexOf(b.task._id);
  if (pickedA !== -1 || pickedB !== -1) {
    if (pickedA === -1) return 1;
    if (pickedB === -1) return -1;
    return pickedA - pickedB;
  }
  if (a.score !== b.score) return b.score - a.score;
  const planA = a.task.planOrder;
  const planB = b.task.planOrder;
  if (planA !== undefined && planB !== undefined && planA !== planB) return compare(planA, planB);
  if (planA !== undefined && planB === undefined) return -1;
  if (planB !== undefined && planA === undefined) return 1;
  return compare(a.task._id, b.task._id);
};

const gapsIn = (window: Span, taken: readonly Span[]) => {
  const padded = taken
    .map(({ start, end }) => ({ start: start - SMART_BLOCK_BUFFER_MINUTES, end: end + SMART_BLOCK_BUFFER_MINUTES }))
    .toSorted((a, b) => a.start - b.start);
  const gaps: { start: number; end: number }[] = [];
  let cursor = window.start;
  for (const span of padded) {
    if (span.start >= window.end) break;
    if (span.start > cursor) gaps.push({ start: cursor, end: Math.min(span.start, window.end) });
    cursor = Math.max(cursor, span.end);
  }
  if (cursor < window.end) gaps.push({ start: cursor, end: window.end });
  return gaps.map(({ start, end }) => ({ start: onStep(start), end })).filter(({ start, end }) => end - start >= SMART_BLOCK_STEP_MINUTES);
};

const lengthOf = (gaps: readonly Span[]) => gaps.reduce((sum, gap) => sum + gap.end - gap.start, 0);

export const fillSmartBlock = ({
  snapshot,
  blockId,
  window,
  filter,
  now,
  edits = NO_EDITS,
}: {
  snapshot: FillSnapshot;
  blockId: string | null;
  window: Span;
  filter: SmartBlockFilter;
  now: number;
  edits?: FillEdits;
}) => {
  const excluded = new Set(edits.exclude);
  const open = new Map(snapshot.tasks.map((task) => [task._id, task]));
  const eligible = (taskId: string) => {
    const task = open.get(taskId);
    return task !== undefined && isEligible(task, filter);
  };
  const ours = (block: FillBlock) => blockId !== null && block.smartBlock?.blockId === blockId && block.smartBlock.date === snapshot.date;
  const inside = (block: FillBlock) => block.start >= window.start && block.start + block.minutes <= window.end;
  const kept: FillBlock[] = [];
  const released: FillBlock[] = [];
  for (const block of snapshot.blocks.filter(ours)) {
    const stays = eligible(block.taskId) && !excluded.has(block.taskId) && inside(block);
    if (stays || block.start < now) kept.push(block);
    else released.push(block);
  }
  const others = snapshot.blocks.filter((block) => !ours(block));
  const boxed = new Set([...others, ...kept].map((block) => block.taskId));
  const opens = { start: Math.max(window.start, onStep(now)), end: window.end };
  const fixed = [...snapshot.busy, ...others.map((block) => ({ start: block.start, end: block.start + block.minutes }))];
  const roomy = gapsIn(opens, fixed);
  const widest = Math.max(0, ...roomy.map((gap) => gap.end - gap.start));
  const gaps = gapsIn(opens, [...fixed, ...kept.map((block) => ({ start: block.start, end: block.start + block.minutes }))]);
  const freeMinutes = lengthOf(gaps);

  const rank = ranker(snapshot);
  const candidates = snapshot.tasks
    .filter((task) => !boxed.has(task._id) && !excluded.has(task._id) && isEligible(task, filter))
    .map(rank)
    .toSorted(byRank(edits.prefer));

  const picks: FillPick[] = [];
  const skipped: FillSkip[] = [];
  const spare: FillCandidate[] = [];
  for (const candidate of candidates) {
    const reason = edits.prefer.includes(candidate.task._id) ? "Your pick" : candidate.reason;
    if (candidate.minutes > widest) {
      skipped.push({ ...candidate, reason, why: "too_long" });
      continue;
    }
    let best: { start: number; end: number } | undefined;
    for (const gap of gaps) {
      const leftover = gap.end - gap.start - candidate.minutes;
      if (leftover >= 0 && (best === undefined || leftover < best.end - best.start - candidate.minutes)) best = gap;
    }
    if (!best) {
      skipped.push({ ...candidate, reason, why: "no_room" });
      spare.push({ ...candidate, reason });
      continue;
    }
    picks.push({ ...candidate, reason, start: best.start });
    best.start = onStep(best.start + candidate.minutes + SMART_BLOCK_BUFFER_MINUTES);
  }
  const keptInside = kept.filter(inside).reduce((sum, block) => sum + block.minutes, 0);
  return {
    picks: picks.toSorted((a, b) => a.start - b.start),
    kept,
    released,
    skipped,
    spare,
    freeMinutes,
    filledMinutes: keptInside + picks.reduce((sum, pick) => sum + pick.minutes, 0),
  };
};

export type SmartFill = ReturnType<typeof fillSmartBlock>;

export type SmartBlockSeries = {
  readonly date: string;
  readonly until: string;
  readonly repeat?: { readonly schedule: CalendarSchedule; readonly skipped: readonly string[] } | undefined;
};

export const occursOnDate = (block: SmartBlockSeries, date: string) => {
  if (date < block.date || date > block.until) return false;
  if (!block.repeat) return date === block.date;
  return !block.repeat.skipped.includes(date) && occursOn(block.repeat.schedule, block.date as IsoDate, date as IsoDate);
};

export const isWindow = (startMinute: number, endMinute: number) =>
  Number.isInteger(startMinute) &&
  Number.isInteger(endMinute) &&
  startMinute >= 0 &&
  endMinute <= 24 * 60 &&
  endMinute - startMinute >= MIN_SMART_BLOCK_MINUTES;
