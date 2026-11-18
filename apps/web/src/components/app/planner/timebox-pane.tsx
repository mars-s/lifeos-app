"use client";

import { useDroppable } from "@dnd-kit/core";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { useMemo } from "react";
import { addDays, type IsoDate } from "@lifeos/backend/date";
import type { PlannerTask } from "@lifeos/backend/types";
import { Timebox, type TimeboxDay, type TimeboxGhost } from "@/components/lifeos/timebox";
import { IconButton } from "@/components/ui/action-button";
import { MorphText } from "@/components/ui/morph-text";
import { Segmented } from "@/components/ui/segmented-control";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { dayMonth, dayNumber, localDate, minuteOfDay, momentAt, monthYear, startOfWeek, weekdayShort } from "../dates";
import { useNow } from "../hooks";
import { useSelectionActions } from "../selection-actions";
import { SleepButton } from "../sleep-setting";
import type { PlanActions } from "./actions";
import { useGhost } from "./drag";
import { calContainer, useTimebox } from "./model";
import { useSleep } from "./sleep";

export type TimeboxMode = "day" | "week";
export type TimeboxView = { mode: TimeboxMode; anchor: IsoDate };

const NARROW_DAYS = 3;

const modes = (narrow: boolean) =>
  [
    { value: "day", label: "Day" },
    { value: "week", label: narrow ? "3 days" : "Week" },
  ] satisfies { value: TimeboxMode; label: string }[];

const CalDrop = ({ date }: { date: IsoDate }) => {
  const { setNodeRef } = useDroppable({ id: calContainer(date) });
  return <div ref={setNodeRef} data-cal-day={date} className="absolute inset-0" />;
};

export const TimeboxPane = ({
  today,
  view,
  onView,
  narrow,
  workingHours,
  actions,
  onOpenTask,
  className,
}: {
  narrow: boolean;
  today: IsoDate;
  view: TimeboxView;
  onView: (view: TimeboxView) => void;
  workingHours: { startMinute: number; endMinute: number };
  actions: PlanActions;
  onOpenTask: (task: PlannerTask, date: IsoDate) => void;
  className?: string;
}) => {
  const { mode, anchor } = view;
  const dates = useMemo(() => {
    if (mode === "day") return [anchor];
    return narrow
      ? Array.from({ length: NARROW_DAYS }, (_, index) => addDays(anchor, index))
      : Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(anchor), index));
  }, [mode, anchor, narrow]);
  const data = useTimebox(dates);
  const sleep = useSleep(dates, today);
  const tasksDo = useSelectionActions(today);
  const held = useGhost();
  const now = useNow();
  const first = dates[0] ?? anchor;
  const last = dates.at(-1) ?? anchor;
  const step = dates.length;
  const span = mode === "day" ? "day" : narrow ? "3 days" : "week";
  const showsToday = dates.includes(today);

  const days = dates.map(
    (date) => ({ key: date, weekday: weekdayShort(date), day: dayNumber(date), today: date === today }) satisfies TimeboxDay,
  );
  const ghostDay = held ? dates.indexOf(held.date) : -1;
  const ghost =
    held && ghostDay !== -1
      ? ({ day: ghostDay, start: held.minute, minutes: held.minutes, title: held.task.title, colour: held.task.area?.colour } satisfies TimeboxGhost)
      : null;
  const rowOf = (id: string) => data.rows.find((row) => row._id === id);
  const label = mode === "day" ? `${weekdayShort(anchor)} ${dayMonth(anchor)}` : first.slice(0, 7) === last.slice(0, 7) ? monthYear(first) : `${dayMonth(first)} to ${dayMonth(last)}`;

  return (
    <section aria-label="Timebox" className={cn("min-h-0 flex-col", className)}>
      <header className="mb-2 flex h-8 shrink-0 items-center gap-1 pr-3 pl-4">
        <h2 className="min-w-0 flex-1 truncate text-heading font-semibold">
          <span className="sr-only">Timebox, </span>
          <MorphText>{label}</MorphText>
        </h2>
        {!showsToday && (
          <button
            type="button"
            onClick={() => onView({ mode, anchor: today })}
            className="h-7 rounded-full px-2.5 text-small font-medium text-brand transition-[background-color,scale] duration-(--dur-press) ease-out hover:bg-brand/[0.1] active:scale-[0.97]"
          >
            Today
          </button>
        )}
        <IconButton icon={CaretLeft} iconWeight="bold" label={`Previous ${span}`} onClick={() => onView({ mode, anchor: addDays(anchor, -step) })} />
        <IconButton icon={CaretRight} iconWeight="bold" label={`Next ${span}`} onClick={() => onView({ mode, anchor: addDays(anchor, step) })} />
        <SleepButton today={today} />
        <Segmented label="Timebox view" options={modes(narrow)} value={mode} onValueChange={(next) => onView({ mode: next, anchor })} className="ml-1" />
      </header>
      <Timebox
        days={days}
        commitments={data.commitments}
        allDay={data.allDay}
        blocks={data.blocks}
        sleep={sleep}
        ghost={ghost}
        workingHours={workingHours}
        now={now !== null && showsToday ? { day: dates.indexOf(today), minute: minuteOfDay(now) } : null}
        scrollKey={`${mode}:${dates.length}`}
        dayLayers={dates.map((date) => (
          <CalDrop key={date} date={date} />
        ))}
        onMove={(id, day, start) => {
          const row = rowOf(id);
          const date = dates[day];
          if (row && date) actions.moveBlock(row, momentAt(date, start));
        }}
        onResize={(id, minutes) => {
          const row = rowOf(id);
          if (row) actions.resizeBlock(row, minutes);
        }}
        onToggle={(id, done) => {
          const row = rowOf(id);
          if (!row) return;
          haptic(done ? "complete" : "toggle");
          if (done) tasksDo.complete([row.task]);
          else tasksDo.reopen([row.task]);
        }}
        onOpen={(id) => {
          const row = rowOf(id);
          if (row) onOpenTask(row.task, localDate(row.start));
        }}
        onRemove={(id) => {
          const row = rowOf(id);
          if (row) actions.removeBlock(row);
        }}
      />
    </section>
  );
};
