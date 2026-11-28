"use client";

import { useMemo } from "react";
import { api } from "@lifeos/backend/api";
import type { Id } from "@lifeos/backend/dataModel";
import type { IsoDate } from "@lifeos/backend/date";
import { blockMinutesFor, placeInDay } from "@lifeos/backend/plan";
import type { PlannerTask, WorkBlockRow } from "@lifeos/backend/types";
import type { OptimisticLocalStore } from "convex/browser";
import { formatMinutes } from "@/components/lifeos/format";
import { both, dropBlock, dropBlockAt, nothing, patchTask, patchTasks, putBlock, useChange } from "../changes";
import { clockTime, momentAt, whenLabel } from "../dates";
import { drafts, isDraftTask } from "../drafts";
import { localZone } from "./model";

const OPTIMISTIC_BLOCK = "optimistic:block:";
let blockCount = 0;

type When = PlannerTask["when"];

const scheduledOn = (date: IsoDate, evening: boolean) => ({ kind: "scheduled", date, evening }) satisfies When;

const patchPlanDay =
  (date: IsoDate, fields: { goalMinutes: number; goalSet: boolean }) =>
  (store: OptimisticLocalStore) => {
    for (const { args, value } of store.getAllQueries(api.planner.plan.week)) {
      if (!value?.ok) continue;
      const days = value.value.days.map((day) => (day.date === date ? { ...day, ...fields } : day));
      store.setQuery(api.planner.plan.week, args, { ok: true, value: { ...value.value, days } });
    }
  };

export type SpreadPick = { task: PlannerTask; start: number; minutes: number };

export type KeepPick = SpreadPick & { date: IsoDate };

const isPlannedOn = (task: PlannerTask, date: IsoDate, today: IsoDate) =>
  task.when.kind === "scheduled" && (task.when.date === date || (date === today && task.when.date <= today));

export const usePlanActions = (today: IsoDate) => {
  const change = useChange();
  return useMemo(() => {
    const moveBlock = (block: WorkBlockRow, start: number) =>
      void change({
        title: `Work Block moved to ${clockTime(start)}`,
        mutation: api.planner.workBlocks.move,
        args: { blockId: block._id, start },
        apply: putBlock({ ...block, start }),
        revert: putBlock(block),
        slot: `block:${block._id}`,
      });

    return {
      place: (task: PlannerTask, date: IsoDate, ordered: readonly PlannerTask[]) => {
        const others = ordered.filter((other) => other._id !== task._id);
        const marks = placeInDay(others, task._id, ordered.indexOf(task), date);
        const plans = new Map(marks.map((mark) => [mark.taskId, mark.plan] as const));
        const before = new Map(ordered.map((other) => [other._id, other] as const));
        const evening = task.when.kind === "scheduled" && task.when.evening;
        const stays = isPlannedOn(task, date, today);
        void change({
          title: stays ? "Day Plan reordered" : `Moved to ${whenLabel(scheduledOn(date, evening), today)}`,
          mutation: api.planner.plan.place,
          args: { taskId: task._id, date, order: ordered.map((other) => drafts.realId(other._id)).filter((id) => !isDraftTask(id)) },
          apply: patchTasks([...plans.keys()], (current) => ({
            ...current,
            plan: plans.get(current._id) ?? current.plan,
            ...(current._id === task._id ? { when: scheduledOn(date, evening) } : {}),
          })),
          revert: patchTasks([...plans.keys()], (current) => before.get(current._id) ?? current),
        });
      },

      toInbox: (task: PlannerTask) =>
        void change({
          title: "Moved to the Brain Dump",
          mutation: api.planner.tasks.setWhen,
          args: { taskId: task._id, when: { kind: "inbox" } },
          apply: patchTask(task._id, (current) => ({ ...current, when: { kind: "inbox" } })),
          revert: patchTask(task._id, (current) => ({ ...current, when: task.when })),
        }),

      addTask: (title: string, when: When, slot: string) => {
        const known = new Set([...document.querySelectorAll<HTMLElement>("#main [data-task-id]")].flatMap((row) => row.dataset.taskId ?? []));
        const key = drafts.add(
          slot,
          {
            title,
            notes: "",
            when,
            parent: { kind: "loose" },
            labelIds: [],
            status: { kind: "open" },
            order: "~",
            context: undefined,
            area: undefined,
            project: undefined,
            labels: [],
            checklist: [],
            workBlocks: [],
            focus: { ms: 0, sessions: [] },
          },
          known,
        );
        void change({
          title: "Task created",
          mutation: api.planner.tasks.create,
          args: { title, when },
          apply: nothing,
          revert: nothing,
          onSaved: ({ taskId }) => drafts.saved(key, taskId),
        }).then((saved) => {
          if (!saved) drafts.failed(key);
        });
      },

      createBlock: (task: PlannerTask, date: IsoDate, minute: number, minutes = blockMinutesFor(task.estimateMinutes), kept = false) => {
        const start = momentAt(date, minute);
        const stays = isPlannedOn(task, date, today);
        const evening = task.when.kind === "scheduled" && task.when.evening;
        const when = stays ? task.when : scheduledOn(date, evening);
        blockCount += 1;
        const block = {
          _id: `${OPTIMISTIC_BLOCK}${blockCount}` as Id<"workBlocks">,
          taskId: drafts.realId(task._id),
          start,
          minutes,
          done: false,
          task: { ...task, when },
        } satisfies WorkBlockRow;
        void change({
          title: kept ? `Kept ${task.title} at ${clockTime(start)}` : `Work Block at ${clockTime(start)} for ${formatMinutes(minutes)}`,
          mutation: api.planner.workBlocks.create,
          args: { taskId: task._id, start, minutes, timeZone: localZone(), ...(stays ? {} : { date }) },
          apply: both(putBlock(block), stays ? nothing : patchTask(task._id, (current) => ({ ...current, when }))),
          revert: both(dropBlockAt(task._id, start), stays ? nothing : patchTask(task._id, (current) => ({ ...current, when: task.when }))),
        });
      },

      setGoal: (date: IsoDate, minutes: number | null, before: { goal: number; goalSet: boolean; free: number }) =>
        void change({
          title: minutes === null ? "Goal is your free time again" : `Goal set to ${formatMinutes(minutes)}`,
          mutation: api.planner.plan.setGoal,
          args: { date, minutes },
          apply: patchPlanDay(date, { goalMinutes: minutes ?? Math.max(0, before.free), goalSet: minutes !== null }),
          revert: patchPlanDay(date, { goalMinutes: before.goal, goalSet: before.goalSet }),
          slot: `goal:${date}`,
        }),

      spread: (date: IsoDate, picks: readonly SpreadPick[], unfit: number) => {
        const placed = picks.map(({ task, start, minutes }) => {
          blockCount += 1;
          return {
            _id: `${OPTIMISTIC_BLOCK}${blockCount}` as Id<"workBlocks">,
            taskId: drafts.realId(task._id),
            start: momentAt(date, start),
            minutes,
            done: false,
            task,
          } satisfies WorkBlockRow;
        });
        const count = `${placed.length} Work Block${placed.length === 1 ? "" : "s"}`;
        void change({
          title: unfit > 0 ? `${count} placed. ${unfit} did not fit` : `${count} placed across the day`,
          mutation: api.planner.workBlocks.spread,
          args: {
            timeZone: localZone(),
            blocks: placed.map(({ taskId, start, minutes }) => ({ taskId: taskId as Id<"tasks">, start, minutes })),
          },
          apply: both(...placed.map(putBlock)),
          revert: both(...placed.map((block) => dropBlockAt(block.taskId, block.start))),
        });
      },

      keepAll: (picks: readonly KeepPick[]) => {
        const placed = picks.map(({ task, date, start, minutes }) => {
          blockCount += 1;
          return {
            _id: `${OPTIMISTIC_BLOCK}${blockCount}` as Id<"workBlocks">,
            taskId: drafts.realId(task._id),
            start: momentAt(date, start),
            minutes,
            done: false,
            task,
          } satisfies WorkBlockRow;
        });
        if (placed.length === 0) return;
        void change({
          title: `Kept ${placed.length} prediction${placed.length === 1 ? "" : "s"}`,
          mutation: api.planner.workBlocks.spread,
          args: {
            timeZone: localZone(),
            blocks: placed.map(({ taskId, start, minutes }) => ({ taskId: taskId as Id<"tasks">, start, minutes })),
          },
          apply: both(...placed.map(putBlock)),
          revert: both(...placed.map((block) => dropBlockAt(block.taskId, block.start))),
        });
      },

      moveBlock,

      resizeBlock: (block: WorkBlockRow, minutes: number) =>
        void change({
          title: `Work Block is now ${formatMinutes(minutes)}`,
          mutation: api.planner.workBlocks.resize,
          args: { blockId: block._id, minutes },
          apply: putBlock({ ...block, minutes }),
          revert: putBlock(block),
          slot: `block:${block._id}`,
        }),

      removeBlock: (block: WorkBlockRow) =>
        void change({
          title: "Work Block removed",
          mutation: api.planner.workBlocks.remove,
          args: { blockId: block._id },
          apply: dropBlock(block),
          revert: putBlock(block),
          slot: `block:${block._id}`,
        }),
    };
  }, [change, today]);
};

export type PlanActions = ReturnType<typeof usePlanActions>;
