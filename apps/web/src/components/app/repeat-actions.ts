"use client";

import type { OptimisticLocalStore } from "convex/browser";
import { useMemo } from "react";
import { api } from "@lifeos/backend/api";
import type { Id } from "@lifeos/backend/dataModel";
import { addDays, laterOf, type IsoDate } from "@lifeos/backend/date";
import { firstAfter, firstOnOrAfter, following, withinEnd, type RepeatEnd, type RepeatNext, type Schedule } from "@lifeos/backend/recurrence";
import type { PlannerTask, RecurringOccurrence, TaskRepeat } from "@lifeos/backend/types";
import { lowerFirst, repeatDay, repeatLabel } from "@/components/lifeos/repeat";
import { both, nothing, patchTask, useChange } from "./changes";
import { isOptimistic } from "./task-actions";

const PENDING_RULE = "optimistic:rule" as Id<"recurrenceRules">;
const ENDED = { kind: "ended" } as const satisfies RepeatNext;
const WAITING = { kind: "waiting" } as const satisfies RepeatNext;

const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const dueWithin = (end: RepeatEnd, date: IsoDate | null) =>
  date && withinEnd(end, date, 0) ? ({ kind: "due", date } satisfies RepeatNext) : ENDED;

type Occurrence = RecurringOccurrence;

const byDate = (a: Occurrence, b: Occurrence) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

const rewriteOccurrences = (store: OptimisticLocalStore, edit: (rows: Occurrence[], from: IsoDate, until: IsoDate) => Occurrence[]) => {
  for (const { args, value } of store.getAllQueries(api.planner.recurrence.upcoming)) {
    if (!value?.ok) continue;
    const from = args.date as IsoDate;
    const next = edit(value.value, from, addDays(from, args.days));
    if (next !== value.value) store.setQuery(api.planner.recurrence.upcoming, args, { ok: true, value: next });
  }
};

const placeOccurrence =
  (holds: (row: Occurrence) => boolean, row: Occurrence | null) =>
  (store: OptimisticLocalStore) =>
    rewriteOccurrences(store, (rows, from, until) => {
      const others = rows.filter((entry) => !holds(entry));
      const fits = row !== null && row.date > from && row.date <= until;
      if (!fits) return others.length === rows.length ? rows : others;
      return [...others, row].toSorted(byDate);
    });

const occurrenceOf = (task: PlannerTask, repeat: TaskRepeat | undefined) =>
  repeat?.next.kind === "due"
    ? ({
        ruleId: repeat.ruleId,
        taskId: task._id,
        date: repeat.next.date,
        title: task.title,
        estimateMinutes: task.estimateMinutes,
        evening: task.when.kind === "scheduled" && task.when.evening,
        schedule: repeat.schedule,
        end: repeat.end,
        area: task.area,
        project: task.project,
      } satisfies Occurrence)
    : null;

const withRepeat = (when: PlannerTask["when"], repeat: TaskRepeat | undefined) => (task: PlannerTask) => {
  const { repeat: _previous, ...rest } = task;
  return repeat ? { ...rest, when, repeat } : { ...rest, when };
};

const planRepeat = (task: PlannerTask, schedule: Schedule, end: RepeatEnd, today: IsoDate) => {
  const evening = task.when.kind === "scheduled" && task.when.evening;
  const live = task.repeat?.active ? task.repeat : undefined;
  if (live) {
    const from = laterOf(today, addDays(live.date as IsoDate, 1));
    const next = schedule.kind === "afterCompletion" ? WAITING : dueWithin(end, firstOnOrAfter(schedule, from, from));
    return { when: task.when, repeat: { ...live, schedule, end, next } };
  }
  if (schedule.kind === "afterCompletion") {
    return { when: task.when, repeat: { ruleId: PENDING_RULE, date: today, active: true, schedule, end, next: WAITING } };
  }
  const base = laterOf(today, task.when.kind === "scheduled" ? (task.when.date as IsoDate) : today);
  const first = firstOnOrAfter(schedule, base, base) ?? base;
  return {
    when: { kind: "scheduled", date: first, evening } satisfies PlannerTask["when"],
    repeat: { ruleId: PENDING_RULE, date: first, active: true, schedule, end, next: dueWithin(end, firstAfter(schedule, base, first)) },
  };
};

const skipped = (repeat: TaskRepeat) =>
  repeat.next.kind === "due"
    ? { ...repeat, next: dueWithin(repeat.end, following(repeat.schedule, repeat.next.date as IsoDate, repeat.next.date as IsoDate)) }
    : repeat;

type ChangeFn = ReturnType<typeof useChange>;

export const repeatActions = (change: ChangeFn, task: PlannerTask, today: string) => {
  const taskId = task._id;
  const slot = `card:${taskId}`;
  const mine = (row: Occurrence) => row.taskId === taskId || row.ruleId === task.repeat?.ruleId;
  const show = (when: PlannerTask["when"], repeat: TaskRepeat | undefined) =>
    both(patchTask(taskId, withRepeat(when, repeat)), placeOccurrence(mine, occurrenceOf(task, repeat)));
  const restore = show(task.when, task.repeat);

  return {
    set: (schedule: Schedule, end: RepeatEnd) => {
      const plan = planRepeat(task, schedule, end, today as IsoDate);
      void change({
        title: `Repeats ${lowerFirst(repeatLabel(schedule, end))}`,
        mutation: api.planner.recurrence.setRepeat,
        args: { taskId, schedule, end, timeZone: timeZone() },
        apply: show(plan.when, plan.repeat),
        revert: restore,
        slot,
      });
    },

    stop: () => {
      if (!task.repeat?.active) return;
      void change({
        title: "Stopped repeating",
        mutation: api.planner.recurrence.stopRepeat,
        args: { taskId },
        apply: show(task.when, { ...task.repeat, active: false, next: ENDED }),
        revert: restore,
        slot,
      });
    },

    skip: () => {
      const repeat = task.repeat;
      if (repeat?.next.kind !== "due" || isOptimistic(repeat.ruleId)) return;
      void change({
        title: `Skipped ${repeatDay(repeat.next.date)}`,
        mutation: api.planner.recurrence.skip,
        args: { ruleId: repeat.ruleId, date: repeat.next.date },
        apply: show(task.when, skipped(repeat)),
        revert: restore,
        slot,
      });
    },
  };
};

export const useRepeatActions = (task: PlannerTask, today: string) => {
  const change = useChange();
  return useMemo(() => repeatActions(change, task, today), [change, task, today]);
};

const patchRepeat = (taskId: Id<"tasks">, active: boolean, next: RepeatNext) =>
  patchTask(taskId, (task) => (task.repeat ? { ...task, repeat: { ...task.repeat, active, next } } : task));

export const useOccurrenceActions = () => {
  const change = useChange();
  return useMemo(() => {
    const only = (row: Occurrence) => (entry: Occurrence) => entry.ruleId === row.ruleId;
    return {
      skip: (row: Occurrence) => {
        const next = following(row.schedule, row.date as IsoDate, row.date as IsoDate);
        const moved = next && withinEnd(row.end, next, 0) ? { ...row, date: next } : null;
        void change({
          title: `Skipped ${repeatDay(row.date)}`,
          mutation: api.planner.recurrence.skip,
          args: { ruleId: row.ruleId, date: row.date },
          apply: both(
            placeOccurrence(only(row), moved),
            row.taskId ? patchRepeat(row.taskId, true, moved ? { kind: "due", date: moved.date } : ENDED) : nothing,
          ),
          revert: both(
            placeOccurrence(only(row), row),
            row.taskId ? patchRepeat(row.taskId, true, { kind: "due", date: row.date }) : nothing,
          ),
          slot: `rule:${row.ruleId}`,
        });
      },

      stop: (row: Occurrence) => {
        if (!row.taskId) return;
        void change({
          title: "Stopped repeating",
          mutation: api.planner.recurrence.stopRepeat,
          args: { taskId: row.taskId },
          apply: both(placeOccurrence(only(row), null), patchRepeat(row.taskId, false, ENDED)),
          revert: both(placeOccurrence(only(row), row), patchRepeat(row.taskId, true, { kind: "due", date: row.date })),
          slot: `rule:${row.ruleId}`,
        });
      },
    };
  }, [change]);
};
