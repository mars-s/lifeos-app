"use client";

import { useMemo } from "react";
import { api } from "@lifeos/backend/api";
import { addDays, type IsoDate } from "@lifeos/backend/date";
import { BLOCK_STEP_MINUTES, byDayPlan, dayLoad, dayShareCap } from "@lifeos/backend/plan";
import type { CommitmentRow, PlanGhost, PlannerTask, WorkBlockRow } from "@lifeos/backend/types";
import type { MeterSlice } from "@/components/lifeos/capacity";
import type { LoadArea } from "@/components/lifeos/day-goal";
import type { TimeboxAllDay, TimeboxBlock, TimeboxCommitment, TimeboxTrip } from "@/components/lifeos/timebox";
import { localDate, minuteOfDay, startOfLocalDay } from "../dates";
import { useQuietView, useView, valueOf } from "../hooks";
import { isOptimistic } from "../task-actions";

export const PLAN_DAYS = 14;
export const INBOX = "inbox";
const DAY_MINUTES = 24 * 60;
const NO_BLOCKS: readonly WorkBlockRow[] = [];
const NO_COMMITMENTS: readonly CommitmentRow[] = [];

export const dayContainer = (date: string) => `day:${date}`;
export const calContainer = (date: string) => `cal:${date}`;
export const dateOfDay = (container: string) => (container.startsWith("day:") ? (container.slice(4) as IsoDate) : null);
export const dateOfCal = (container: string) => (container.startsWith("cal:") ? (container.slice(4) as IsoDate) : null);

export const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const compare = <T extends string | number>(a: T, b: T) => (a < b ? -1 : a > b ? 1 : 0);

const blocksTime = (row: CommitmentRow) =>
  row.response !== "declined" && (row.availability !== "free" && (row.availability !== "unknown" || !row.allDay));

export type PlanDay = {
  date: IsoDate;
  tasks: PlannerTask[];
  ghosts: readonly PlanGhost[];
  left: ReadonlyMap<string, number>;
  free: number;
  goal: number;
  goalSet: boolean;
  planned: number;
  guessed: number;
  unestimated: number;
  slices: MeterSlice[];
  areas: LoadArea[];
  busy: { start: number; end: number }[];
  boxed: ReadonlySet<string>;
};

const NO_AREA = "none";

const areasOf = (slices: readonly (MeterSlice & { title: string | undefined })[]) => {
  const byKey = new Map<string, LoadArea>();
  for (const slice of slices) {
    const key = slice.title === undefined ? NO_AREA : `${slice.title}:${slice.colour}`;
    const known = byKey.get(key) ?? { key, title: slice.title ?? "No Area", colour: slice.colour, minutes: 0, guessed: 0 };
    byKey.set(key, slice.guess ? { ...known, guessed: known.guessed + slice.minutes } : { ...known, minutes: known.minutes + slice.minutes });
  }
  return [...byKey.values()].toSorted((a, b) => (a.key === NO_AREA ? 1 : b.key === NO_AREA ? -1 : b.minutes + b.guessed - (a.minutes + a.guessed)));
};

const useWindow = (from: IsoDate, days: number) => {
  const start = startOfLocalDay(from);
  const end = startOfLocalDay(addDays(from, days));
  const blocks = valueOf(useQuietView(api.planner.workBlocks.range, { from: start, to: end })) ?? NO_BLOCKS;
  const commitments = valueOf(useQuietView(api.calendar.commitments.range, { from: start, to: end })) ?? NO_COMMITMENTS;
  return { blocks, commitments };
};

const clipTo = (row: { start: number; end: number }, date: IsoDate) => {
  const dayStart = startOfLocalDay(date);
  const dayEnd = startOfLocalDay(addDays(date, 1));
  if (row.end <= dayStart || row.start >= dayEnd) return null;
  return { start: row.start <= dayStart ? 0 : minuteOfDay(row.start), end: row.end >= dayEnd ? DAY_MINUTES : minuteOfDay(row.end) };
};

export const usePlanner = (today: IsoDate) => {
  const inbox = useView(api.planner.lists.inbox, {});
  const week = valueOf(useView(api.planner.plan.week, { from: today, days: PLAN_DAYS, timeZone: localZone() }));
  const { blocks, commitments } = useWindow(today, PLAN_DAYS);

  return useMemo(() => {
    if (!inbox || !week) return null;
    const rank = new Map<string, number>();
    const known = new Map<string, PlannerTask>();
    for (const task of week.days.flatMap((day) => day.tasks)) {
      rank.set(task._id, rank.size);
      known.set(task._id, task);
    }
    for (const task of inbox.tasks) if (!known.has(task._id)) known.set(task._id, task);
    const all = [...known.values()];
    const last = week.days.at(-1)?.date ?? today;
    const byRank = (a: PlannerTask, b: PlannerTask) =>
      compare(rank.get(a._id) ?? Number.MAX_SAFE_INTEGER, rank.get(b._id) ?? Number.MAX_SAFE_INTEGER) ||
      compare(a.order, b.order) ||
      compare(a._creationTime, b._creationTime);
    const dayOf = (task: PlannerTask) => (task.when.kind !== "scheduled" ? null : task.when.date > today ? task.when.date : today);
    const open = blocks.filter((block) => block.task.status.kind === "open");
    const guesses = new Map<string, number>(week.guesses.map((guess) => [guess.taskId, guess.minutes]));

    const days = week.days.map((day) => {
      const tasks = all.filter((task) => dayOf(task) === day.date && day.date <= last).toSorted(byDayPlan(day.date, byRank));
      const dayBlocks = open.filter((block) => localDate(block.start) === day.date);
      const load = dayLoad(
        [...tasks, ...day.ghosts.map((ghost) => ({ _id: ghost.key, estimateMinutes: ghost.estimateMinutes, area: ghost.area }))],
        dayBlocks.map((block) => ({ ...block, area: block.task.area })),
        (taskId) => guesses.get(taskId),
        dayShareCap(day.goalMinutes),
      );
      const slices = load.slices.map((slice) => ({
        id: slice.id,
        colour: slice.area?.colour,
        title: slice.area?.title,
        minutes: slice.minutes,
        guess: slice.source === "guess",
      }));
      const busy = [
        ...commitments.flatMap((row) => (row.allDay || !blocksTime(row) ? [] : (clipTo(row, day.date) ?? []))),
        ...blocks
          .filter((block) => localDate(block.start) === day.date)
          .map((block) => ({ start: minuteOfDay(block.start), end: minuteOfDay(block.start) + block.minutes })),
      ].toSorted((a, b) => a.start - b.start);
      return {
        date: day.date,
        tasks,
        ghosts: day.ghosts,
        left: new Map(load.slices.flatMap((slice) => (slice.left > 0 ? [[slice.id, slice.left] as const] : []))),
        free: day.freeMinutes,
        goal: day.goalMinutes,
        goalSet: day.goalSet,
        planned: load.plannedMinutes,
        guessed: load.guessedMinutes,
        unestimated: load.unestimated,
        slices,
        areas: areasOf(slices),
        busy,
        boxed: new Set(dayBlocks.map((block) => block.taskId)),
      } satisfies PlanDay;
    });

    return {
      dump: all.filter((task) => task.when.kind === "inbox").toSorted((a, b) => compare(a.order, b.order) || compare(a._creationTime, b._creationTime)),
      days,
      workingHours: week.workingHours,
      guesses,
    };
  }, [inbox, week, blocks, commitments, today]);
};

export type PlannerModel = NonNullable<ReturnType<typeof usePlanner>>;

const roundUp = (minute: number) => Math.ceil(minute / BLOCK_STEP_MINUTES) * BLOCK_STEP_MINUTES;

export const nextFreeSlot = (busy: readonly { start: number; end: number }[], minutes: number, earliest: number) => {
  let candidate = roundUp(earliest);
  for (const span of busy) {
    if (candidate + minutes <= span.start) break;
    if (candidate < span.end) candidate = roundUp(span.end);
  }
  return Math.min(candidate, DAY_MINUTES - minutes);
};

export const useTimebox = (dates: readonly IsoDate[], today: IsoDate, now: number | null, trips: ReadonlyMap<string, TimeboxTrip>) => {
  const first = dates[0] ?? ("1970-01-01" as IsoDate);
  const { blocks, commitments } = useWindow(first, dates.length);
  const nowMinute = now === null ? null : minuteOfDay(now);
  return useMemo(() => {
    const isPast = (date: string, endMinute: number) => date < today || (date === today && nowMinute !== null && endMinute <= nowMinute);
    const dayIndex = new Map(dates.map((date, index) => [date, index] as const));
    const timed: TimeboxCommitment[] = [];
    const allDay: TimeboxAllDay[] = [];
    for (const row of commitments) {
      const quiet = !blocksTime(row);
      dates.forEach((date, day) => {
        const span = clipTo(row, date);
        if (!span) return;
        const id = `${row._id}:${date}`;
        if (row.allDay) allDay.push({ id, day, title: row.title, colour: row.calendar.colour, quiet });
        else timed.push({ id, day, ...span, title: row.title, source: row.calendar.title, colour: row.calendar.colour, quiet, past: isPast(date, span.end) });
      });
    }
    const shown = blocks.flatMap((block) => {
      const day = dayIndex.get(localDate(block.start));
      return day === undefined
        ? []
        : [
            {
              id: block._id as string,
              day,
              start: minuteOfDay(block.start),
              minutes: block.minutes,
              title: block.task.title,
              colour: block.task.area?.colour,
              done: block.done || block.task.status.kind !== "open",
              inert: isOptimistic(block._id),
              past: isPast(localDate(block.start), minuteOfDay(block.start) + block.minutes + (trips.get(block.taskId)?.minutes ?? 0)),
              trip: trips.get(block.taskId) ?? null,
              taskId: block.taskId,
            } satisfies TimeboxBlock,
          ];
    });
    return { commitments: timed, allDay, blocks: shown, rows: blocks };
  }, [blocks, commitments, dates, today, nowMinute, trips]);
};
