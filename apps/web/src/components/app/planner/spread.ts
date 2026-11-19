import type { IsoDate } from "@lifeos/backend/date";
import { spreadDay, type Span } from "@lifeos/backend/spread";
import type { PlannerTask } from "@lifeos/backend/types";
import type { TimeboxSleep } from "@/components/lifeos/timebox";
import { minuteOfDay } from "../dates";
import { isDraftTask } from "../drafts";
import type { SpreadPick } from "./actions";
import type { PlanDay, PlannerModel } from "./model";

export type SpreadPreview = { date: IsoDate; picks: SpreadPick[]; unfit: PlannerTask[]; spreadable: number };

export const previewSpread = ({
  day,
  model,
  sleep,
  today,
  now,
}: {
  day: PlanDay;
  model: PlannerModel;
  sleep: readonly Span[];
  today: IsoDate;
  now: number;
}) => {
  const { startMinute, endMinute } = model.workingHours;
  const window = { start: day.date === today ? Math.max(startMinute, minuteOfDay(now)) : startMinute, end: endMinute };
  const tasks = day.tasks.filter((task) => task.status.kind === "open" && !isDraftTask(task._id) && !day.boxed.has(task._id));
  const { placed, unfit } = spreadDay({
    tasks,
    boxed: day.boxed,
    guessOf: (taskId) => model.guesses.get(taskId),
    busy: [...day.busy, ...sleep],
    window,
  });
  const byId = new Map(tasks.map((task) => [task._id as string, task]));
  const picks = placed.flatMap(({ taskId, start, minutes }) => {
    const task = byId.get(taskId);
    return task ? [{ task, start, minutes }] : [];
  });
  return { date: day.date, picks, unfit, spreadable: tasks.length } satisfies SpreadPreview;
};

export const sleepOn = (bands: readonly TimeboxSleep[], day: number) =>
  bands.filter((band) => band.day === day).map(({ start, end }) => ({ start, end }));
