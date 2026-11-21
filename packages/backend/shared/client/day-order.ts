import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { placeInDay } from "../plan";
import type { PlannerTask } from "../types";
import { whenLabel } from "./dates";
import { arrangeDay } from "./updaters";

export type Day = { readonly date: string; readonly evening: boolean };

export const shownDay = (task: PlannerTask, today: string) =>
  task.when.kind === "scheduled" && task.when.date > today
    ? ({ date: task.when.date, evening: task.when.evening } satisfies Day)
    : ({ date: today, evening: task.when.kind === "scheduled" && task.when.evening } satisfies Day);

const sameDay = (a: Day, b: Day) => a.date === b.date && a.evening === b.evening;

const withPlan = (task: PlannerTask, plan: PlannerTask["plan"]) => {
  const { plan: _previous, ...rest } = task;
  return plan ? { ...rest, plan } : rest;
};

export const dayPlacement = ({
  task,
  from,
  to,
  at,
  today,
  realIdOf,
}: {
  task: PlannerTask;
  from: readonly PlannerTask[];
  to: { day: Day; tasks: readonly PlannerTask[] };
  at: number;
  today: string;
  realIdOf: (id: Id<"tasks">) => Id<"tasks"> | undefined;
}) => {
  const others = to.tasks.filter((other) => other._id !== task._id);
  const marks = placeInDay(others, task._id, at, to.day.date);
  const plans = new Map<string, PlannerTask["plan"]>(marks.map((mark) => [mark.taskId, mark.plan]));
  const before = new Map<string, PlannerTask["plan"]>(
    marks.flatMap((mark) => (mark.taskId === task._id ? [] : [[mark.taskId, others.find((other) => other._id === mark.taskId)?.plan] as const])),
  );
  const ordered = [...others.slice(0, at), task, ...others.slice(at)];
  const when = { kind: "scheduled", date: to.day.date, evening: to.day.evening } satisfies PlannerTask["when"];
  const moved = { ...withPlan(task, plans.get(task._id)), when };
  const fromDay = shownDay(task, today);
  return {
    title: sameDay(fromDay, to.day) ? "Task moved" : `Moved to ${whenLabel(when, today)}`,
    mutation: api.planner.plan.place,
    args: {
      taskId: task._id,
      date: to.day.date,
      order: ordered.flatMap((other) => realIdOf(other._id) ?? []),
      evening: to.day.evening,
    },
    apply: arrangeDay(moved, to.day, ordered.map((other) => other._id), plans, today),
    revert: arrangeDay(task, fromDay, from.map((other) => other._id), before, today),
  };
};
