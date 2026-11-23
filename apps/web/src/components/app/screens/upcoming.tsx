"use client";

import { AnimatePresence } from "motion/react";
import { Flag, Repeat } from "@phosphor-icons/react";
import { api } from "@lifeos/backend/api";
import { addDays, type IsoDate } from "@lifeos/backend/date";
import type { PlannerTask, RecurringOccurrence, UpcomingView } from "@lifeos/backend/types";
import { AreaDot } from "@/components/lifeos/area";
import { CommitmentList, type CommitmentItem } from "@/components/lifeos/commitments";
import { repeatLabel } from "@lifeos/backend/client/repeat";
import { EmptyState } from "@/components/lifeos/states";
import { EstimateChip } from "@/components/lifeos/task-row";
import { cn } from "@/lib/utils";
import { useCommitmentsByDay } from "../calendar";
import { UPCOMING_DAYS, dayNumber, daysBetween, deadlineMark, monthLong, relativeDay, weekdayLong } from "../dates";
import { useQuietView, useView, valueOf } from "../hooks";
import { Arrive, Fold, Folding } from "../fold";
import { ListSkeleton } from "../list-page";
import { openMenuFor } from "../menus";
import { useShell } from "../shell-context";
import { useDraftCount } from "../drafts";
import { placeAttr } from "../new-task-place";
import { TaskItems, useHasDrafts } from "../task-item";

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

const OccurrenceRow = ({ row }: { row: RecurringOccurrence }) => (
  <li data-menu-occurrence={row.ruleId} data-occurrence-date={row.date}>
    <button
      type="button"
      data-arrow-item
      aria-haspopup="menu"
      onClick={(event) => openMenuFor(event.currentTarget, event.detail === 0)}
      className="flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left outline-none transition-[background-color] duration-(--dur-fast) ease-out hover:bg-foreground/[0.04] focus-visible:bg-foreground/[0.07]"
    >
      <span aria-hidden="true" className="mt-[3px] size-[18px] shrink-0 rounded-[6px] border-[1.5px] border-dashed border-foreground/25" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-muted-foreground">
          <span className="sr-only">Repeats next: </span>
          {row.title}
        </span>
        <span className="flex items-center gap-1.5 text-small text-faint-foreground">
          <Repeat className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{repeatLabel(row.schedule, row.end)}</span>
          {row.area && (
            <>
              <AreaDot colour={row.area.colour} className="ml-1" />
              <span className="truncate">{row.project?.title ?? row.area.title}</span>
            </>
          )}
        </span>
      </span>
      {row.estimateMinutes !== undefined && <EstimateChip minutes={row.estimateMinutes} className="mt-px opacity-60" />}
    </button>
  </li>
);

const NO_TASKS = [] as const;
const NO_OCCURRENCES = [] as const;

const DaySection = ({
  date,
  day,
  occurrences = NO_OCCURRENCES,
  commitments,
  today,
}: {
  date: IsoDate;
  day: Day | undefined;
  occurrences?: readonly RecurringOccurrence[];
  commitments: readonly CommitmentItem[] | undefined;
  today: string;
}) => {
  const near = daysBetween(today, date) <= ALWAYS_SHOWN_DAYS;
  const slot = `/upcoming:${date}`;
  const drafting = useDraftCount(slot) > 0;
  const scheduledHere = new Set(day?.tasks.map((task) => task._id));
  const dueOnly = day?.deadlines.filter((task) => !scheduledHere.has(task._id)) ?? [];
  return (
    <section
      aria-label={`${weekdayLong(date)} ${dayNumber(date)} ${monthLong(date)}`}
      {...placeAttr({ slot, when: { kind: "scheduled", date, evening: false } })}
      className={cn("@container", day || commitments || occurrences.length > 0 ? "pb-5" : "pb-7")}>
      <h2 className="flex items-end gap-2.5">
        <span className="text-[1.75rem] leading-8 font-semibold tracking-[-0.02em]">{dayNumber(date)}</span>
        <span className="flex h-7 min-w-0 flex-1 items-center gap-2 border-t border-border pt-1 text-small font-medium text-muted-foreground">
          {relativeDay(date, today) ?? weekdayLong(date)}
          {(!near || dayNumber(date) === "1") && <span className="font-normal text-faint-foreground">{monthLong(date)}</span>}
        </span>
      </h2>
      {commitments && <CommitmentList items={commitments} className="mt-1.5 mb-1" />}
      {(day || drafting) && (
        <>
          {dueOnly.length > 0 && (
            <ul className="-mx-3 mt-1">
              {dueOnly.map((task) => (
                <DeadlineRow key={task._id} task={task} today={today} />
              ))}
            </ul>
          )}
          <TaskItems
            tasks={day?.tasks ?? NO_TASKS}
            show={{ context: true }}
            hostsDrafts="inline"
            slot={slot}
            className={dueOnly.length > 0 ? undefined : "mt-1"}
          />
        </>
      )}
      {occurrences.length > 0 && (
        <ul aria-label="Repeats" className={cn("-mx-3", !day && "mt-1")}>
          {occurrences.map((row) => (
            <OccurrenceRow key={row.ruleId} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
};

export const UpcomingList = () => {
  const { today } = useShell();
  const view = valueOf(useView(api.planner.lists.upcoming, { date: today, days: UPCOMING_DAYS }));
  const drafting = useHasDrafts();
  const occurrences = valueOf(useQuietView(api.planner.recurrence.upcoming, { date: today, days: UPCOMING_DAYS })) ?? NO_OCCURRENCES;
  const repeatsOn = new Map<string, RecurringOccurrence[]>();
  for (const row of occurrences) repeatsOn.set(row.date, [...(repeatsOn.get(row.date) ?? []), row]);
  const byDate = new Map(view?.days.map((day) => [day.date, day]));
  const week = Array.from({ length: ALWAYS_SHOWN_DAYS }, (_, index) => addDays(today, index + 1));
  const commitments = useCommitmentsByDay(addDays(today, 1), addDays(today, UPCOMING_DAYS));
  const later = [...new Set([...(view?.days ?? []).map((day) => day.date as IsoDate), ...commitments.keys(), ...occurrences.map((row) => row.date as IsoDate)])]
    .filter((date) => !week.includes(date))
    .toSorted();
  const nothing = !!view && view.days.length === 0 && commitments.size === 0 && occurrences.length === 0 && !drafting;
  return (
    <div className="mx-auto w-full max-w-[44rem] px-5 pt-2 pb-28 md:px-10 md:pt-0 [&_[data-arrow-item]]:scroll-mt-28 md:[&_[data-arrow-item]]:scroll-mt-20">
      {!view ? (
        <ListSkeleton />
      ) : (
        <>
          <Fold show={!nothing} appear={false}>
            <TaskItems tasks={NO_TASKS} show={{ context: true, when: true }} hostsDrafts="above" className="mb-4" />
            <AnimatePresence initial={false}>
              {[...week, ...later].map((date) => (
                <Folding key={date}>
                  <DaySection date={date} day={byDate.get(date)} occurrences={repeatsOn.get(date)} commitments={commitments.get(date)} today={today} />
                </Folding>
              ))}
            </AnimatePresence>
          </Fold>
          <Arrive show={nothing}>
            <EmptyState
              spot="upcoming"
              title="Nothing coming up"
              hint={`Tasks with a date or a Deadline, and calendar events, in the next ${UPCOMING_DAYS / 7} weeks show here.`}
              className="py-16"
            />
          </Arrive>
        </>
      )}
    </div>
  );
};
