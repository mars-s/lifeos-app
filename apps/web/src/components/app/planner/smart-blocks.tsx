"use client";

import { ArrowsClockwise, CaretDown, DotsThree, Plus, X } from "@phosphor-icons/react";
import type { OptimisticLocalStore } from "convex/browser";
import { motion, useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";
import { api } from "@lifeos/backend/api";
import type { Id } from "@lifeos/backend/dataModel";
import type { IsoDate } from "@lifeos/backend/date";
import { fillSmartBlock, type CalendarSchedule, type SmartFill } from "@lifeos/backend/smartBlocks";
import type { SmartBlockOccurrence, SmartBlockRange } from "@lifeos/backend/types";
import { AREA_COLOURS, AreaDot, areaVar, type AreaColour } from "@/components/lifeos/area";
import { formatClock, formatMinutes, formatRange } from "@/components/lifeos/format";
import { RankList } from "@/components/lifeos/rank-list";
import { HOUR_PX, toPx, type TimeboxPreview } from "@/components/lifeos/timebox";
import { Menu, type MenuGroup } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/action-button";
import { KeyCombo } from "@/components/ui/key-hint";
import { haptic } from "@/lib/haptics";
import { enter, exit } from "@/lib/motion-tokens";
import { cn } from "@/lib/utils";
import { useChange } from "../changes";
import { dayMonth, minuteOfDay, momentAt, weekdayShort } from "../dates";
import { useNow, useQuietView, valueOf } from "../hooks";
import { localZone } from "./model";

const MINUTE_MS = 60_000;
const DAY_MINUTES = 24 * 60;
const EDGE_STEP = 15;
const MIN_MINUTES = 15;
const SPARE_SHOWN = 4;
const TICK_MINUTES = 15;
const MAX_TICKS = 24;
const OPTIMISTIC = "optimistic:smart:";
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export type RepeatChoice = "none" | "daily" | "weekdays" | "weekly" | "fortnightly" | "monthly";
type Repeat = RepeatChoice | "custom";
type Filter = { areaIds: Id<"areas">[]; projectIds: Id<"projects">[]; labelIds: Id<"labels">[] };
type Fields = { start: number; end: number; title: string; colour: AreaColour; filter: Filter; repeat: Repeat };

export type SmartDraft = Fields & {
  blockId: Id<"smartBlocks"> | null;
  date: IsoDate;
  scope: "one" | "all";
  exclude: string[];
  prefer: string[];
  saved: Fields | null;
};

const NO_FILTER: Filter = { areaIds: [], projectIds: [], labelIds: [] };

const isoWeekday = (date: IsoDate) => ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
const dayOfMonth = (date: IsoDate) => Number(date.slice(8, 10));

const ordinal = (n: number) => {
  const tens = n % 100;
  return `${n}${tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;
};

const scheduleFor = (choice: RepeatChoice, date: IsoDate) => {
  const weekday = isoWeekday(date) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
  const schedules = {
    none: null,
    daily: { kind: "days", every: 1 },
    weekdays: { kind: "weekdays" },
    weekly: { kind: "weeks", every: 1, days: [weekday] },
    fortnightly: { kind: "weeks", every: 2, days: [weekday] },
    monthly: { kind: "months", every: 1, on: { kind: "day", day: dayOfMonth(date) } },
  } satisfies Record<RepeatChoice, CalendarSchedule | null>;
  return schedules[choice];
};

const choiceOf = (schedule: CalendarSchedule | null | undefined) => {
  const choice: Repeat = !schedule
    ? "none"
    : schedule.kind === "weekdays"
      ? "weekdays"
      : schedule.kind === "days" && schedule.every === 1
        ? "daily"
        : schedule.kind === "weeks" && schedule.days.length === 1 && schedule.every <= 2
          ? schedule.every === 1
            ? "weekly"
            : "fortnightly"
          : schedule.kind === "months" && schedule.every === 1 && schedule.on.kind === "day"
            ? "monthly"
            : "custom";
  return choice;
};

const repeatLabels = (date: IsoDate) => {
  const weekday = WEEKDAYS[isoWeekday(date) - 1] ?? "";
  return {
    none: "Does not repeat",
    daily: "Every day",
    weekdays: "Every weekday",
    weekly: `Every ${weekday}`,
    fortnightly: `Every other ${weekday}`,
    monthly: `Monthly on the ${ordinal(dayOfMonth(date))}`,
    custom: "Custom repeat",
  } satisfies Record<Repeat, string>;
};

export const newDraft = (date: IsoDate, start: number, end: number) =>
  ({
    blockId: null,
    date,
    start,
    end,
    title: "Focus",
    colour: "teal",
    filter: NO_FILTER,
    repeat: "none",
    scope: "one",
    exclude: [],
    prefer: [],
    saved: null,
  }) satisfies SmartDraft;

export const draftOf = (occurrence: SmartBlockOccurrence) => {
  const fields = {
    start: occurrence.startMinute,
    end: occurrence.endMinute,
    title: occurrence.title,
    colour: occurrence.colour,
    filter: occurrence.filter,
    repeat: choiceOf(occurrence.repeat?.schedule),
  } satisfies Fields;
  return {
    ...fields,
    blockId: occurrence.blockId,
    date: occurrence.date as IsoDate,
    scope: "one",
    exclude: [],
    prefer: [],
    saved: fields,
  } satisfies SmartDraft;
};

export const isOptimisticBlock = (blockId: string) => blockId.startsWith(OPTIMISTIC);

export const useSmartBlocks = (dates: readonly IsoDate[]) => {
  const from = dates[0];
  const range = valueOf(useQuietView(api.planner.smartBlocks.range, from ? { from, days: dates.length, timeZone: localZone() } : "skip"));
  return range ?? null;
};

export const useSmartFill = (draft: SmartDraft | null, prefetch: IsoDate | null) => {
  const date = draft?.date ?? prefetch;
  const snapshot = valueOf(useQuietView(api.planner.smartBlocks.fillInputs, date ? { date, timeZone: localZone() } : "skip"));
  const now = useNow();
  return useMemo(() => {
    if (!draft || !snapshot || now === null || snapshot.date !== draft.date) return null;
    return fillSmartBlock({
      snapshot,
      blockId: draft.blockId,
      window: { start: momentAt(draft.date, draft.start) / MINUTE_MS, end: momentAt(draft.date, draft.end) / MINUTE_MS },
      filter: draft.filter,
      now: Math.floor(now / MINUTE_MS),
      edits: { exclude: draft.exclude, prefer: draft.prefer },
    });
  }, [draft, snapshot, now]);
};

export const fillPreviews = (fill: SmartFill | null, day: number) =>
  (fill?.picks ?? []).map(
    (pick) =>
      ({
        id: `smart:${pick.task._id}`,
        day,
        start: minuteOfDay(pick.start * MINUTE_MS),
        minutes: pick.minutes,
        title: pick.task.title,
        colour: pick.task.colour,
      }) satisfies TimeboxPreview,
  );

export const smartBusy = (range: SmartBlockRange | null, date: IsoDate) =>
  (range?.occurrences ?? []).filter((each) => each.date === date).map((each) => ({ start: each.startMinute, end: each.endMinute }));

const sameFilter = (a: Filter, b: Filter) => JSON.stringify(a) === JSON.stringify(b);

const changedFields = (draft: SmartDraft) => {
  const saved = draft.saved;
  if (!saved) return null;
  const fields = {
    ...(draft.title.trim() !== saved.title ? { title: draft.title.trim() } : {}),
    ...(draft.colour !== saved.colour ? { colour: draft.colour } : {}),
    ...(draft.start !== saved.start ? { startMinute: draft.start } : {}),
    ...(draft.end !== saved.end ? { endMinute: draft.end } : {}),
    ...(sameFilter(draft.filter, saved.filter) ? {} : { filter: draft.filter }),
  };
  const repeat = draft.repeat !== saved.repeat && draft.repeat !== "custom" ? scheduleFor(draft.repeat, draft.date) : undefined;
  if (Object.keys(fields).length === 0 && repeat === undefined) return null;
  return { fields, repeat };
};

const rewriteRanges = (store: OptimisticLocalStore, rewrite: (occurrences: SmartBlockOccurrence[], from: string, days: number) => SmartBlockOccurrence[]) => {
  for (const { args, value } of store.getAllQueries(api.planner.smartBlocks.range)) {
    if (!value?.ok || !value.value.on) continue;
    store.setQuery(api.planner.smartBlocks.range, args, { ok: true, value: { on: true, occurrences: rewrite(value.value.occurrences, args.from, args.days) } });
  }
};

const inRange = (date: string, from: string, days: number) => {
  const last = new Date(Date.parse(`${from}T00:00:00Z`) + (days - 1) * 86_400_000).toISOString().slice(0, 10);
  return date >= from && date <= last;
};

let optimisticCount = 0;

const occurrenceOf = (draft: SmartDraft, blockId: Id<"smartBlocks">, filledMinutes: number) =>
  ({
    blockId,
    date: draft.date,
    title: draft.title.trim() || "Focus",
    colour: draft.colour,
    start: momentAt(draft.date, draft.start),
    end: momentAt(draft.date, draft.end),
    startMinute: draft.start,
    endMinute: draft.end,
    timeZone: localZone(),
    filter: draft.filter,
    repeat: draft.repeat === "none" || draft.repeat === "custom" ? null : { schedule: scheduleFor(draft.repeat, draft.date) as CalendarSchedule, until: null },
    detached: false,
    filled: 0,
    filledMinutes,
  }) satisfies SmartBlockOccurrence;

const putOccurrence = (occurrence: SmartBlockOccurrence) => (store: OptimisticLocalStore) =>
  rewriteRanges(store, (occurrences, from, days) => {
    const others = occurrences.filter((each) => !(each.blockId === occurrence.blockId && each.date === occurrence.date));
    return inRange(occurrence.date, from, days) ? [...others, occurrence].toSorted((a, b) => a.start - b.start) : others;
  });

const dropOccurrence = (blockId: string, date: string) => (store: OptimisticLocalStore) =>
  rewriteRanges(store, (occurrences) => occurrences.filter((each) => !(each.blockId === blockId && each.date === date)));

const dropSeries = (blockId: string) => (store: OptimisticLocalStore) =>
  rewriteRanges(store, (occurrences) => occurrences.filter((each) => each.blockId !== blockId));

export const useSmartActions = () => {
  const change = useChange();
  return useMemo(
    () => ({
      accept: (draft: SmartDraft, fill: SmartFill, onSaved: () => void) => {
        const blocks = fill.picks.map((pick) => ({ taskId: pick.task._id as Id<"tasks">, start: pick.start * MINUTE_MS, minutes: pick.minutes }));
        const title = draft.title.trim() || "Focus";
        if (draft.blockId === null) {
          optimisticCount += 1;
          const occurrence = occurrenceOf(draft, `${OPTIMISTIC}${optimisticCount}` as Id<"smartBlocks">, fill.filledMinutes);
          const schedule = draft.repeat === "none" || draft.repeat === "custom" ? null : scheduleFor(draft.repeat, draft.date);
          return change({
            title: `${title} added`,
            mutation: api.planner.smartBlocks.create,
            args: {
              title,
              colour: draft.colour,
              date: draft.date,
              startMinute: draft.start,
              endMinute: draft.end,
              timeZone: localZone(),
              filter: draft.filter,
              ...(schedule ? { repeat: { schedule } } : {}),
              fill: blocks,
            },
            apply: putOccurrence(occurrence),
            revert: dropOccurrence(occurrence.blockId, occurrence.date),
            onSaved,
          });
        }
        const edit = changedFields(draft);
        const scope = edit?.repeat !== undefined ? "all" : draft.scope;
        const freed = fill.released.length;
        return change({
          title: freed > 0 ? `${title} refilled` : `${title} filled`,
          mutation: api.planner.smartBlocks.fill,
          args: {
            blockId: draft.blockId,
            date: draft.date,
            blocks,
            release: fill.released.map((block) => block.blockId as Id<"workBlocks">),
            ...(edit ? { edit: { scope, ...edit.fields, ...(edit.repeat !== undefined ? { repeat: edit.repeat ? { schedule: edit.repeat } : null } : {}) } } : {}),
          },
          apply: putOccurrence(occurrenceOf(draft, draft.blockId, fill.filledMinutes)),
          revert: () => undefined,
          onSaved,
        });
      },
      skip: (occurrence: SmartBlockOccurrence) =>
        change({
          title: `${occurrence.title} skipped on ${weekdayShort(occurrence.date as IsoDate)} ${dayMonth(occurrence.date as IsoDate)}`,
          mutation: api.planner.smartBlocks.skip,
          args: { blockId: occurrence.blockId, date: occurrence.date },
          apply: dropOccurrence(occurrence.blockId, occurrence.date),
          revert: putOccurrence(occurrence),
        }),
      remove: (occurrence: SmartBlockOccurrence) =>
        change({
          title: `${occurrence.title} deleted`,
          mutation: api.planner.smartBlocks.remove,
          args: { blockId: occurrence.blockId },
          apply: dropSeries(occurrence.blockId),
          revert: putOccurrence(occurrence),
        }),
    }),
    [change],
  );
};

const Meter = ({ minutes, filled, colour }: { minutes: number; filled: number; colour: AreaColour }) => {
  const ticks = Math.min(MAX_TICKS, Math.max(1, Math.round(minutes / TICK_MINUTES)));
  const lit = Math.min(ticks, Math.round((filled / Math.max(minutes, 1)) * ticks));
  return (
    <span role="img" aria-label={`${formatMinutes(filled)} of ${formatMinutes(minutes)} filled`} className="flex h-2.5 shrink-0 items-end gap-[2px]">
      {Array.from({ length: ticks }, (_, index) => (
        <span
          key={index}
          className={cn("w-[2px] rounded-full transition-[background-color,height] duration-(--dur-fast) ease-out", index % 4 === 3 ? "h-2.5" : "h-2")}
          style={{ backgroundColor: index < lit ? areaVar(colour) : "color-mix(in oklab, var(--foreground) 16%, transparent)" }}
        />
      ))}
    </span>
  );
};

const zoneBand = (colour: AreaColour, drafting: boolean) => ({
  backgroundColor: `color-mix(in oklab, ${areaVar(colour)} ${drafting ? 9 : 6}%, transparent)`,
  boxShadow: `inset 2px 0 0 color-mix(in oklab, ${areaVar(colour)} 60%, transparent)`,
});

type Hold = { pointerId: number; originY: number; minute: number };

const Edge = ({
  side,
  minute,
  onDrag,
  label,
}: {
  side: "top" | "bottom";
  minute: number;
  onDrag: (minute: number, done: boolean) => void;
  label: string;
}) => {
  const [held, setHeld] = useState<Hold | null>(null);
  const minuteFor = (hold: Hold, clientY: number) => Math.round((hold.minute + ((clientY - hold.originY) / HOUR_PX) * 60) / EDGE_STEP) * EDGE_STEP;
  return (
    <span
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="horizontal"
      aria-valuenow={minute}
      aria-valuemin={0}
      aria-valuemax={DAY_MINUTES}
      aria-valuetext={formatClock(minute)}
      onKeyDown={(event) => {
        const step = event.key === "ArrowUp" ? -EDGE_STEP : event.key === "ArrowDown" ? EDGE_STEP : 0;
        if (step === 0) return;
        event.preventDefault();
        event.stopPropagation();
        onDrag(minute + step, true);
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        setHeld({ pointerId: event.pointerId, originY: event.clientY, minute });
      }}
      onPointerMove={(event) => {
        if (held?.pointerId === event.pointerId) onDrag(minuteFor(held, event.clientY), false);
      }}
      onPointerUp={(event) => {
        if (held?.pointerId !== event.pointerId) return;
        setHeld(null);
        onDrag(minuteFor(held, event.clientY), true);
      }}
      onPointerCancel={() => setHeld(null)}
      className={cn(
        "pointer-events-auto absolute inset-x-0 z-30 grid h-3 cursor-ns-resize touch-none place-items-center rounded-full outline-offset-1",
        side === "top" ? "-top-1.5" : "-bottom-1.5",
      )}
    >
      <span className="h-[3px] w-8 rounded-full bg-foreground/35" />
    </span>
  );
};

export const SmartZones = ({
  dates,
  range,
  draft,
  fill,
  onOpen,
  onResize,
  actions,
}: {
  dates: readonly IsoDate[];
  range: SmartBlockRange | null;
  draft: SmartDraft | null;
  fill: SmartFill | null;
  onOpen: (occurrence: SmartBlockOccurrence) => void;
  onResize: (start: number, end: number) => void;
  actions: ReturnType<typeof useSmartActions>;
}) => {
  const count = dates.length;
  const tight = count > 1;
  const shown = (range?.occurrences ?? []).filter(
    (occurrence) => dates.includes(occurrence.date as IsoDate) && !(draft && draft.blockId === occurrence.blockId && draft.date === occurrence.date),
  );
  const drafted = draft && dates.includes(draft.date) ? draft : null;
  const column = (day: number) => ({ left: `calc(${(day * 100) / count}% + 2px)`, width: `calc(${100 / count}% - 4px)` });

  const menuFor = (occurrence: SmartBlockOccurrence) =>
    [
      {
        items: [
          { id: "fill", label: occurrence.filled > 0 ? "Refill" : "Fill", icon: ArrowsClockwise, onSelect: () => onOpen(occurrence) },
          ...(occurrence.repeat
            ? [{ id: "skip", label: "Skip this day", onSelect: () => void actions.skip(occurrence) }]
            : []),
          {
            id: "delete",
            label: occurrence.repeat ? "Delete every one" : "Delete",
            destructive: true,
            onSelect: () => void actions.remove(occurrence),
          },
        ],
      },
    ] satisfies MenuGroup[];

  return (
    <div data-zone-layer="" data-no-select="" className="pointer-events-none absolute inset-0">
      {shown.map((occurrence) => {
        const day = dates.indexOf(occurrence.date as IsoDate);
        const minutes = occurrence.endMinute - occurrence.startMinute;
        const inert = isOptimisticBlock(occurrence.blockId);
        return (
          <div key={`${occurrence.blockId}:${occurrence.date}`}>
            <div
              aria-hidden="true"
              className="absolute rounded-lg"
              style={{ ...column(day), top: toPx(occurrence.startMinute) + 1, height: toPx(minutes) - 2, ...zoneBand(occurrence.colour, false) }}
            />
            <div
              className="pointer-events-auto absolute z-10 flex h-6 items-center gap-1"
              style={{ ...column(day), top: Math.max(0, toPx(occurrence.startMinute) - 25) }}
            >
              <button
                type="button"
                disabled={inert}
                onClick={() => {
                  haptic("toggle");
                  onOpen(occurrence);
                }}
                aria-label={`${occurrence.title}, ${formatRange(occurrence.startMinute, occurrence.endMinute)}. ${occurrence.filled > 0 ? "Refill" : "Fill"} it`}
                className="flex h-6 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-micro transition-[background-color,scale] duration-(--dur-press) ease-out hover:bg-foreground/[0.06] active:scale-[0.97]"
              >
                <AreaDot colour={occurrence.colour} />
                <span className="truncate font-medium">{occurrence.title}</span>
                {!tight && <span className="shrink-0 font-mono text-faint-foreground">{formatRange(occurrence.startMinute, occurrence.endMinute)}</span>}
                <Meter minutes={minutes} filled={occurrence.filledMinutes} colour={occurrence.colour} />
                {!tight && occurrence.filled === 0 && <span className="shrink-0 font-medium text-brand">Fill</span>}
              </button>
              {!inert && (
                <Menu
                  align="end"
                  groups={menuFor(occurrence)}
                  trigger={
                    <button
                      type="button"
                      aria-label={`More for ${occurrence.title}`}
                      className="ml-auto grid size-6 shrink-0 place-items-center rounded-md text-faint-foreground transition-colors duration-(--dur-press) hover:bg-foreground/[0.06] hover:text-foreground"
                    >
                      <DotsThree weight="bold" className="size-4" aria-hidden="true" />
                    </button>
                  }
                />
              )}
            </div>
          </div>
        );
      })}
      {drafted && (
        <div
          data-smart-draft=""
          className="absolute z-20 scroll-mt-20 rounded-lg outline-[1.5px] -outline-offset-[1.5px] outline-dashed"
          style={{
            ...column(dates.indexOf(drafted.date)),
            top: toPx(drafted.start) + 1,
            height: toPx(drafted.end - drafted.start) - 2,
            outlineColor: `color-mix(in oklab, ${areaVar(drafted.colour)} 70%, transparent)`,
            ...zoneBand(drafted.colour, true),
          }}
        >
          <span
            className="absolute flex h-6 items-center gap-1.5 px-1.5 text-micro"
            style={{ top: Math.max(-toPx(drafted.start), -25), left: 0, right: 0 }}
          >
            <AreaDot colour={drafted.colour} />
            <span className="truncate font-medium">{drafted.title.trim() || "Focus"}</span>
            {!tight && <span className="shrink-0 font-mono text-faint-foreground">{formatRange(drafted.start, drafted.end)}</span>}
            <Meter minutes={drafted.end - drafted.start} filled={fill?.filledMinutes ?? 0} colour={drafted.colour} />
          </span>
          <Edge
            side="top"
            minute={drafted.start}
            label="Move the start"
            onDrag={(minute, done) => {
              const start = Math.min(Math.max(0, minute), drafted.end - MIN_MINUTES);
              if (start !== drafted.start) haptic("snap");
              onResize(start, drafted.end);
              if (done) haptic("drop");
            }}
          />
          <Edge
            side="bottom"
            minute={drafted.end}
            label="Move the end"
            onDrag={(minute, done) => {
              const end = Math.max(Math.min(DAY_MINUTES, minute), drafted.start + MIN_MINUTES);
              if (end !== drafted.end) haptic("snap");
              onResize(drafted.start, end);
              if (done) haptic("drop");
            }}
          />
        </div>
      )}
    </div>
  );
};

const sizeText = (pick: { minutes: number; source: string }) => `${pick.source === "guess" ? "~" : ""}${formatMinutes(pick.minutes)}`;

export const SmartBlockBar = ({
  draft,
  fill,
  onChange,
  onAccept,
  onCancel,
}: {
  draft: SmartDraft;
  fill: SmartFill | null;
  onChange: (next: SmartDraft) => void;
  onAccept: () => void;
  onCancel: () => void;
}) => {
  const reduce = useReducedMotion();
  const areas = useQuietView(api.planner.smartBlocks.priority, {}) ?? [];
  const labels = useQuietView(api.planner.labels.list, {}) ?? [];
  const labelsFor = repeatLabels(draft.date);
  const windowMinutes = draft.end - draft.start;
  const picks = fill?.picks ?? [];
  const tooLong = (fill?.skipped ?? []).filter((skip) => skip.why === "too_long");
  const spare = (fill?.spare ?? []).slice(0, SPARE_SHOWN);
  const edited = changedFields(draft);
  const repeats = draft.saved !== null && draft.saved.repeat !== "none";
  const day = `${weekdayShort(draft.date)} ${dayMonth(draft.date)}`;
  const set = (patch: Partial<SmartDraft>) => onChange({ ...draft, ...patch });
  const filterCount = draft.filter.areaIds.length + draft.filter.projectIds.length + draft.filter.labelIds.length;
  const toggle = <K extends "areaIds" | "labelIds">(key: K, id: Filter[K][number], on: boolean) =>
    set({ filter: { ...draft.filter, [key]: on ? [...draft.filter[key], id] : draft.filter[key].filter((each) => each !== id) } });
  const order = (key: string, toIndex: number) => {
    const ids = picks.map((pick) => pick.task._id);
    const from = ids.indexOf(key);
    if (from === -1) return;
    const next = ids.toSpliced(from, 1).toSpliced(toIndex, 0, key);
    set({ prefer: next });
  };
  const verb = draft.blockId === null ? "Add block" : picks.length === 0 && (fill?.released.length ?? 0) === 0 && !edited ? "Done" : "Place";

  const filterGroups = [
    {
      label: "Areas",
      items: areas.map((area) => ({
        id: `area:${area._id}`,
        type: "checkbox" as const,
        label: area.title,
        leading: <AreaDot colour={area.colour} />,
        checked: draft.filter.areaIds.includes(area._id),
        onCheckedChange: (on: boolean) => toggle("areaIds", area._id, on),
      })),
    },
    {
      label: "Labels",
      items: labels.map((label) => ({
        id: `label:${label._id}`,
        type: "checkbox" as const,
        label: label.name,
        leading: <AreaDot colour={label.colour} />,
        checked: draft.filter.labelIds.includes(label._id),
        onCheckedChange: (on: boolean) => toggle("labelIds", label._id, on),
      })),
    },
  ] satisfies MenuGroup[];

  const repeatGroups = [
    {
      items: (["none", "daily", "weekdays", "weekly", "fortnightly", "monthly"] as const).map((choice) => ({
        id: choice,
        type: "checkbox" as const,
        label: labelsFor[choice],
        checked: draft.repeat === choice,
        onCheckedChange: () => set({ repeat: choice }),
      })),
    },
  ] satisfies MenuGroup[];

  const colourGroups = [
    {
      items: [
        {
          type: "grid" as const,
          id: "colour",
          label: "Colour",
          columns: 4,
          value: draft.colour,
          onValueChange: (value: string) => set({ colour: AREA_COLOURS.find((colour) => colour === value) ?? draft.colour }),
          options: AREA_COLOURS.map((colour) => ({ value: colour, label: colour, node: <AreaDot colour={colour} className="size-3" /> })),
        },
      ],
    },
  ] satisfies MenuGroup[];

  const chip =
    "inline-flex h-7 items-center gap-1 rounded-full bg-foreground/[0.05] pr-2 pl-2.5 text-small text-muted-foreground transition-[background-color,color,scale] duration-(--dur-press) ease-out hover:bg-foreground/[0.09] hover:text-foreground active:scale-[0.97]";

  return (
    <motion.div
      role="region"
      aria-label="Smart Block"
      data-no-select=""
      initial={reduce ? { opacity: 0 } : { opacity: 0, transform: "translateY(8px)" }}
      animate={{ opacity: 1, transform: "translateY(0px)", transition: enter }}
      exit={{ opacity: 0, transform: reduce ? "translateY(0px)" : "translateY(8px)", transition: exit }}
      className="absolute inset-x-2 bottom-2 z-40 flex max-h-[min(30rem,60%)] flex-col overflow-hidden rounded-xl bg-popover px-3 pt-2.5 pb-2 shadow-float"
    >
      <div className="flex items-center gap-2">
        <Menu
          groups={colourGroups}
          trigger={
            <button type="button" aria-label="Colour" className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-foreground/[0.06]">
              <AreaDot colour={draft.colour} className="size-2.5" />
            </button>
          }
        />
        <input
          aria-label="Smart Block title"
          name="smart-block-title"
          value={draft.title}
          onChange={(event) => set({ title: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onAccept();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-small font-medium outline-none placeholder:text-faint-foreground"
          placeholder="Focus…"
          autoComplete="off"
        />
        <span className="shrink-0 font-mono text-micro text-muted-foreground tabular-nums">
          {day} · {formatRange(draft.start, draft.end)}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <Menu
          groups={repeatGroups}
          trigger={
            <button type="button" className={chip}>
              {labelsFor[draft.repeat]}
              <CaretDown weight="bold" className="size-2.5 opacity-60" aria-hidden="true" />
            </button>
          }
        />
        <Menu
          groups={filterGroups}
          trigger={
            <button type="button" className={chip}>
              {filterCount === 0 ? "Every Task" : `${filterCount} filter${filterCount === 1 ? "" : "s"}`}
              <CaretDown weight="bold" className="size-2.5 opacity-60" aria-hidden="true" />
            </button>
          }
        />
        {repeats && edited && edited.repeat === undefined && (
          <span className="ml-auto inline-flex rounded-full bg-foreground/[0.05] p-0.5 text-micro" role="radiogroup" aria-label="Change">
            {(["one", "all"] as const).map((scope) => (
              <button
                key={scope}
                type="button"
                role="radio"
                aria-checked={draft.scope === scope}
                onClick={() => set({ scope })}
                className={cn(
                  "h-6 rounded-full px-2.5 transition-[background-color,color] duration-(--dur-fast) ease-out",
                  draft.scope === scope ? "bg-popover text-foreground shadow-float" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {scope === "one" ? "This day" : "Every one"}
              </button>
            ))}
          </span>
        )}
      </div>

      <div className="mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-foreground/[0.06] pt-1.5">
        {!fill ? (
          <p className="px-1 py-2 text-small text-muted-foreground">Finding Tasks that fit…</p>
        ) : picks.length === 0 && fill.kept.length === 0 ? (
          <p className="px-1 py-2 text-small text-pretty text-muted-foreground">
            {fill.freeMinutes === 0 ? "No free time left in this block." : "No open Task fits. Tasks need a When of Anytime or this day, and must match the filters."}
          </p>
        ) : (
          <>
            {fill.kept.length > 0 && (
              <p className="px-1 pt-1 text-micro text-muted-foreground">
                Keeps {fill.kept.length} Work Block{fill.kept.length === 1 ? "" : "s"} already here
                {fill.released.length > 0 ? `, frees ${fill.released.length} for Tasks that are done or no longer fit` : ""}
              </p>
            )}
            {picks.length > 0 && (
              <RankList
                label="Proposed Tasks"
                className="-mx-1"
                items={picks.map((pick) => ({
                  key: pick.task._id,
                  label: pick.task.title,
                  content: (
                    <>
                      {pick.task.colour ? <AreaDot colour={pick.task.colour} /> : <span className="size-2 shrink-0 rounded-full border border-foreground/25" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{pick.task.title}</span>
                        <span className="block truncate text-micro text-muted-foreground">{pick.reason}</span>
                      </span>
                      <span className="w-10 shrink-0 text-right font-mono text-micro text-muted-foreground tabular-nums" title={pick.source === "guess" ? "Smart Estimate, a guess" : pick.source === "default" ? "No Estimate, so 30 minutes" : "Estimate"}>
                        {sizeText(pick)}
                      </span>
                    </>
                  ),
                  trailing: (
                    <button
                      type="button"
                      aria-label={`Leave out ${pick.task.title}`}
                      onClick={() => set({ exclude: [...draft.exclude, pick.task._id], prefer: draft.prefer.filter((id) => id !== pick.task._id) })}
                      className="grid size-7 shrink-0 place-items-center rounded-md text-faint-foreground transition-[background-color,color,scale] duration-(--dur-press) ease-out hover:bg-foreground/[0.06] hover:text-foreground active:scale-[0.9]"
                    >
                      <X weight="bold" className="size-3" aria-hidden="true" />
                    </button>
                  ),
                }))}
                onMove={order}
              />
            )}
          </>
        )}
        {spare.length > 0 && (
          <div className="mt-1 px-1">
            <p className="text-micro text-faint-foreground">Also waiting</p>
            <ul className="mt-0.5">
              {spare.map((candidate) => (
                <li key={candidate.task._id} className="flex h-8 items-center gap-2 text-small text-muted-foreground">
                  <span className="min-w-0 flex-1 truncate">{candidate.task.title}</span>
                  <span className="shrink-0 font-mono text-micro tabular-nums">{sizeText(candidate)}</span>
                  <button
                    type="button"
                    aria-label={`Put ${candidate.task.title} in first`}
                    onClick={() => set({ prefer: [...draft.prefer.filter((id) => id !== candidate.task._id), candidate.task._id], exclude: draft.exclude.filter((id) => id !== candidate.task._id) })}
                    className="grid size-7 shrink-0 place-items-center rounded-md text-faint-foreground transition-[background-color,color,scale] duration-(--dur-press) ease-out hover:bg-foreground/[0.06] hover:text-foreground active:scale-[0.9]"
                  >
                    <Plus weight="bold" className="size-3" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {tooLong.length > 0 && (
          <p className="mt-1 px-1 text-micro text-pretty text-faint-foreground">
            Too long for {formatMinutes(windowMinutes)}: {tooLong.map((skip) => `${skip.task.title} (${sizeText(skip)})`).join(", ")}
          </p>
        )}
      </div>

      <div className="mt-2 flex items-center gap-2">
        {fill && (
          <span className="font-mono text-micro whitespace-nowrap text-muted-foreground tabular-nums" aria-label={`${formatMinutes(fill.filledMinutes)} of ${formatMinutes(windowMinutes)} filled`}>
            {formatMinutes(fill.filledMinutes)}
            <span className="text-faint-foreground"> / {formatMinutes(windowMinutes)}</span>
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          <Button variant="quiet" onClick={onCancel} aria-keyshortcuts="Escape">
            Cancel
          </Button>
          <Button variant="primary" onClick={onAccept} disabled={!fill || draft.title.trim() === ""} aria-keyshortcuts="Enter">
            {verb} <KeyCombo keys="enter" className="ml-0.5" />
          </Button>
        </span>
      </div>
    </motion.div>
  );
};
