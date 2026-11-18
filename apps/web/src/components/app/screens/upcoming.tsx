"use client";

import { Flag } from "@phosphor-icons/react";
import { api } from "@lifeos/backend/api";
import { addDays, type IsoDate } from "@lifeos/backend/date";
import type { PlannerTask, UpcomingView } from "@lifeos/backend/types";
import { AreaDot } from "@/components/lifeos/area";
import { EmptyState } from "@/components/lifeos/states";
import { cn } from "@/lib/utils";
import { dayNumber, daysBetween, deadlineMark, monthLong, relativeDay, weekdayLong } from "../dates";
import { useView, valueOf } from "../hooks";
import { ListPage, ListSkeleton } from "../list-page";
import { useShell } from "../shell-context";
import { LIST_META } from "../sidebar";
import { TaskItems, useHasDrafts } from "../task-item";

export const UPCOMING_DAYS = 28;
const ALWAYS_SHOWN_DAYS = 7;

type Day = UpcomingView["days"][number];

const DeadlineRow = ({ task, today }: { task: PlannerTask; today: string }) => (
  <li className="flex items-start gap-3 px-3 py-2">
    <span className="mt-[3px] grid size-[18px] shrink-0 place-items-center">
      <Flag weight="fill" className="size-4 text-deadline" aria-hidden="true" />
    </span>
    <span className="min-w-0 flex-1">
      <span className="block truncate">
        <span className="sr-only">Deadline: </span>
        {task.title}
      </span>
      {task.context && (
        <span className="flex items-center gap-1.5 text-small text-muted-foreground">
          {task.area && <AreaDot colour={task.area.colour} />}
          <span className="truncate">{task.context}</span>
        </span>
      )}
    </span>
    <span className="shrink-0 pt-px text-small font-medium text-deadline">
      Deadline
      <span className="hidden font-normal opacity-70 @sm:inline"> {deadlineMark(task.deadline ?? today, today).countdown}</span>
    </span>
  </li>
);

const NO_TASKS = [] as const;

const DaySection = ({ date, day, today }: { date: IsoDate; day: Day | undefined; today: string }) => {
  const near = daysBetween(today, date) <= ALWAYS_SHOWN_DAYS;
  const scheduledHere = new Set(day?.tasks.map((task) => task._id));
  const dueOnly = day?.deadlines.filter((task) => !scheduledHere.has(task._id)) ?? [];
  return (
    <section aria-label={`${weekdayLong(date)} ${dayNumber(date)} ${monthLong(date)}`} className={cn("@container", day ? "pb-5" : "pb-7")}>
      <h2 className="flex items-end gap-2.5">
        <span className="text-[1.75rem] leading-8 font-semibold tracking-[-0.02em]">{dayNumber(date)}</span>
        <span className="flex h-7 min-w-0 flex-1 items-center gap-2 border-t border-border pt-1 text-small font-medium text-muted-foreground">
          {relativeDay(date, today) ?? weekdayLong(date)}
          {(!near || dayNumber(date) === "1") && <span className="font-normal text-faint-foreground">{monthLong(date)}</span>}
        </span>
      </h2>
      {day && (
        <>
          {dueOnly.length > 0 && (
            <ul className="-mx-3 mt-1">
              {dueOnly.map((task) => (
                <DeadlineRow key={task._id} task={task} today={today} />
              ))}
            </ul>
          )}
          <TaskItems tasks={day.tasks} show={{ context: true }} className={dueOnly.length > 0 ? undefined : "mt-1"} />
        </>
      )}
    </section>
  );
};

export const UpcomingScreen = () => {
  const { today } = useShell();
  const view = valueOf(useView(api.planner.lists.upcoming, { date: today, days: UPCOMING_DAYS }));
  const drafting = useHasDrafts();
  const byDate = new Map(view?.days.map((day) => [day.date, day]));
  const week = Array.from({ length: ALWAYS_SHOWN_DAYS }, (_, index) => addDays(today, index + 1));
  const later = (view?.days ?? []).flatMap((day) => (week.some((date) => date === day.date) ? [] : [day.date as IsoDate]));
  return (
    <ListPage title="Upcoming" icon={LIST_META.upcoming.icon}>
      {!view ? (
        <ListSkeleton />
      ) : view.days.length === 0 && !drafting ? (
        <EmptyState
          spot="upcoming"
          title="Nothing coming up"
          hint={`Tasks with a date or a Deadline in the next ${UPCOMING_DAYS / 7} weeks show here.`}
          className="py-16"
        />
      ) : (
        <>
          <TaskItems tasks={NO_TASKS} show={{ context: true, when: true }} hostsDrafts="above" className="mb-4" />
          {[...week, ...later].map((date) => (
            <DaySection key={date} date={date} day={byDate.get(date)} today={today} />
          ))}
        </>
      )}
    </ListPage>
  );
};
