"use client";

import { useDroppable } from "@dnd-kit/core";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { useEffect, useMemo } from "react";
import { addDays, type IsoDate } from "@lifeos/backend/date";
import type { PlannerTask } from "@lifeos/backend/types";
import { Timebox, type TimeboxDay, type TimeboxGhost, type TimeboxPreview } from "@/components/lifeos/timebox";
import { Button, IconButton } from "@/components/ui/action-button";
import { KeyCombo } from "@/components/ui/key-hint";
import { MorphText } from "@/components/ui/morph-text";
import { Segmented } from "@/components/ui/segmented-control";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { dayMonth, dayNumber, localDate, minuteOfDay, momentAt, monthShort, monthYear, monthYearShort, startOfWeek, weekdayShort } from "../dates";
import { useNow } from "../hooks";
import { useSelectionActions } from "../selection-actions";
import { SleepButton } from "../sleep-setting";
import type { PlanActions } from "./actions";
import { useDraftBlocks } from "../drafts";
import { useGhost } from "./drag";
import { calContainer, useTimebox } from "./model";
import { useSleep } from "./sleep";
import type { SpreadPreview } from "./spread";
import { draftOf, fillPreviews, newDraft, SmartBlockBar, SmartZones, useSmartActions, useSmartBlocks, type SmartDraft } from "./smart-blocks";
import type { SmartFill } from "@lifeos/backend/smartBlocks";

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
  spread,
  onApplySpread,
  onCancelSpread,
  smart,
  className,
}: {
  smart: {
    draft: SmartDraft | null;
    fill: SmartFill | null;
    pending: { date: IsoDate; fill: SmartFill } | null;
    setDraft: (draft: SmartDraft | null) => void;
    onAccept: () => void;
  };
  spread: SpreadPreview | null;
  onApplySpread: () => void;
  onCancelSpread: () => void;
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
  const smartRange = useSmartBlocks(dates);
  const smartActions = useSmartActions();
  const smartOn = smartRange?.on === true;
  const tasksDo = useSelectionActions(today);
  const sleep = useSleep(dates, today);
  const held = useGhost();
  const draftBlocks = useDraftBlocks();
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
  const spreadDay = spread ? dates.indexOf(spread.date) : -1;
  const previews =
    spread && spreadDay !== -1
      ? spread.picks.map(
          ({ task, start, minutes }) =>
            ({ id: `spread:${task._id}`, day: spreadDay, start, minutes, title: task.title, colour: task.area?.colour }) satisfies TimeboxPreview,
        )
      : [];
  const draftDay = smart.draft ? dates.indexOf(smart.draft.date) : -1;
  const opened = smart.draft ? `${smart.draft.blockId ?? "new"}:${smart.draft.date}:${draftDay}` : null;
  useEffect(() => {
    if (opened === null) return;
    const frame = requestAnimationFrame(() => document.querySelector("[data-smart-draft]")?.scrollIntoView({ block: "start", behavior: "smooth" }));
    return () => cancelAnimationFrame(frame);
  }, [opened]);
  const pendingDay = smart.pending ? dates.indexOf(smart.pending.date) : -1;
  const draftPreviews = draftBlocks.flatMap(({ key, title, block }) => {
    const day = dates.indexOf(block.date);
    return day === -1 ? [] : [{ id: key, day, start: block.minute, minutes: block.minutes, title: title || "New Task", colour: undefined } satisfies TimeboxPreview];
  });
  const smartPreviews = [
    ...(draftDay === -1 ? [] : fillPreviews(smart.fill, draftDay)),
    ...(pendingDay === -1 || !smart.pending ? [] : fillPreviews(smart.pending.fill, pendingDay)),
  ];
  const rowOf = (id: string) => data.rows.find((row) => row._id === id);
  const sameMonth = first.slice(0, 7) === last.slice(0, 7);
  const [label, shortLabel] =
    mode === "day"
      ? [`${weekdayShort(anchor)} ${dayMonth(anchor)}`, dayMonth(anchor)]
      : sameMonth
        ? [monthYear(first), monthYearShort(first)]
        : [`${dayMonth(first)} to ${dayMonth(last)}`, `${monthShort(first)} to ${monthShort(last)}`];

  return (
    <section aria-label="Timebox" className={cn("relative min-h-0 flex-col", className)}>
      <header className="@container mb-2 flex min-h-8 shrink-0 flex-wrap items-center gap-x-1 gap-y-1.5 pr-3 pl-4">
        <h2 className="min-w-0 truncate text-heading font-semibold">
          <span className="sr-only">Timebox, </span>
          <span className="hidden @lg:inline">
            <MorphText>{label}</MorphText>
          </span>
          <span className="@lg:hidden">
            <MorphText>{shortLabel}</MorphText>
          </span>
        </h2>
        <div className="ml-auto flex items-center gap-1">
          {!showsToday && (
            <button
              type="button"
              onClick={() => onView({ mode, anchor: today })}
              className="h-7 rounded-full px-2.5 text-small font-medium text-brand transition-[background-color,scale] duration-(--dur-press) ease-out outline-none hover:bg-brand/[0.1] focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.97]"
            >
              Today
            </button>
          )}
          <IconButton icon={CaretLeft} iconWeight="bold" label={`Previous ${span}`} onClick={() => onView({ mode, anchor: addDays(anchor, -step) })} />
          <IconButton icon={CaretRight} iconWeight="bold" label={`Next ${span}`} onClick={() => onView({ mode, anchor: addDays(anchor, step) })} />
          <SleepButton today={today} />
          <Segmented label="Timebox view" options={modes(narrow)} value={mode} onValueChange={(next) => onView({ mode: next, anchor })} className="ml-1" />
        </div>
      </header>
      {spread && <SpreadBar spread={spread} isToday={spread.date === today} onApply={onApplySpread} onCancel={onCancelSpread} />}
      {smart.draft && (
        <SmartBlockBar draft={smart.draft} fill={smart.fill} onChange={smart.setDraft} onAccept={smart.onAccept} onCancel={() => smart.setDraft(null)} />
      )}
      <Timebox
        days={days}
        commitments={data.commitments}
        allDay={data.allDay}
        blocks={data.blocks}
        sleep={sleep}
        ghost={ghost}
        previews={[...previews, ...smartPreviews, ...draftPreviews]}
        workingHours={workingHours}
        now={now !== null && showsToday ? { day: dates.indexOf(today), minute: minuteOfDay(now) } : null}
        scrollKey={`${mode}:${dates.length}`}
        className={smart.draft ? "pb-[30rem]" : undefined}
        dayLayers={dates.map((date) => (
          <CalDrop key={date} date={date} />
        ))}
        zones={
          smartOn && (
            <SmartZones
              dates={dates}
              range={smartRange}
              draft={smart.draft}
              fill={smart.fill}
              actions={smartActions}
              onOpen={(occurrence) => smart.setDraft(draftOf(occurrence))}
              onResize={(start, end) => smart.draft && smart.setDraft({ ...smart.draft, start, end })}
            />
          )
        }
        onDraw={
          smartOn
            ? (day, start, end) => {
                const date = dates[day];
                if (date) smart.setDraft(newDraft(date, start, end));
              }
            : undefined
        }
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

const SpreadBar = ({
  spread,
  isToday,
  onApply,
  onCancel,
}: {
  spread: SpreadPreview;
  isToday: boolean;
  onApply: () => void;
  onCancel: () => void;
}) => {
  const placed = spread.picks.length;
  const unfit = spread.unfit.length;
  const day = `${weekdayShort(spread.date)} ${dayMonth(spread.date)}`;
  const headline =
    spread.spreadable === 0
      ? "Every Task already has a Work Block"
      : placed === 0
        ? `Nothing fits on ${day}`
        : `${placed} Work Block${placed === 1 ? "" : "s"} for ${day}`;
  return (
    <div
      role="region"
      aria-label="Spread across the day"
      className="mx-2 mb-2 shrink-0 animate-fade-in rounded-xl bg-popover px-3 py-2.5 shadow-float"
    >
      <p className="text-small font-medium" aria-live="polite">
        {headline}
      </p>
      {unfit > 0 && (
        <p className="mt-0.5 line-clamp-3 text-small text-muted-foreground">
          {unfit} Task{unfit === 1 ? "" : "s"} did not fit {isToday ? "today" : `on ${day}`} and stay{unfit === 1 ? "s" : ""} unscheduled:{" "}
          <span className="text-foreground/80">{spread.unfit.map((task) => task.title).join(", ")}</span>
        </p>
      )}
      <div className="mt-2 flex items-center justify-end gap-1.5">
        <Button variant="quiet" onClick={onCancel}>
          Cancel <KeyCombo keys="escape" className="ml-0.5" />
        </Button>
        {placed > 0 && (
          <Button variant="primary" onClick={onApply}>
            Place blocks <KeyCombo keys="enter" className="ml-0.5" />
          </Button>
        )}
      </div>
    </div>
  );
};
