"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MorphText } from "@/components/ui/morph-text";
import { haptic } from "@/lib/haptics";
import { EASE_OUT, exit, instant, springSettle } from "@/lib/motion-tokens";
import { cn } from "@/lib/utils";
import { Car } from "@phosphor-icons/react";
import type { CSSProperties } from "react";
import { areaVar, type AreaColour } from "./area";
import { calendarInk } from "./commitments";
import { EnergyLane, energyHint, type EnergyCurve, type EnergyMode } from "./energy-curve";
import { formatClock, formatMinutes, formatRange } from "./format";

export const HOUR_PX = 56;
export const SNAP_MINUTES = 15;
const DAY_MINUTES = 24 * 60;
const DRAG_START_PX = 4;
const GUTTER_PX = 84;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export const toPx = (minutes: number) => (minutes / 60) * HOUR_PX;
const snapTo = (minutes: number) => Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const rubber = (overshoot: number) => (overshoot * 120 * 0.55) / (120 + 0.55 * Math.abs(overshoot));

export const minuteAtPointer = (clientY: number, top: number) => ((clientY - top) / HOUR_PX) * 60;

export type TimeboxDay = { key: string; weekday: string; day: string; today: boolean };

export type TimeboxCommitment = {
  id: string;
  day: number;
  start: number;
  end: number;
  title: string;
  source: string;
  colour: string;
  quiet: boolean;
  past: boolean;
};

export type TimeboxAllDay = { id: string; day: number; title: string; colour: string; quiet: boolean };

export type TimeboxBlock = {
  id: string;
  day: number;
  start: number;
  minutes: number;
  title: string;
  colour: AreaColour | undefined;
  done: boolean;
  inert: boolean;
  past: boolean;
  trip: TimeboxTrip | null;
  taskId: string;
};

export type TimeboxTrip = { place: string; minutes: number };

export type TimeboxPrediction = {
  id: string;
  taskId: string;
  day: number;
  start: number;
  minutes: number;
  title: string;
  colour: AreaColour | undefined;
  area: string | undefined;
  guess: boolean;
  fit: "peak" | "dip" | null;
  trip: TimeboxTrip | null;
};

export type TimeboxEnergy = { curve: EnergyCurve; mode: EnergyMode };

export type SleepEdge = { label: string; short: string; time: string };

export type TimeboxSleep = {
  id: string;
  day: number;
  start: number;
  end: number;
  kind: "slept" | "planned";
  windowEnd: number | null;
  top: SleepEdge | null;
  bottom: SleepEdge | null;
  title: string;
};

export type TimeboxGhost = { day: number; start: number; minutes: number; title: string; colour: AreaColour | undefined };

export type TimeboxPreview = TimeboxGhost & { id: string };

type Span = { id: string; start: number; end: number };
type Lane = { lane: number; lanes: number };

const lanesOf = (spans: readonly Span[]) => {
  const placed = new Map<string, Lane>();
  const ordered = spans.toSorted((a, b) => a.start - b.start || b.end - a.end);
  let cluster: { id: string; lane: number }[] = [];
  let ends: number[] = [];
  const close = () => {
    for (const member of cluster) placed.set(member.id, { lane: member.lane, lanes: ends.length });
    cluster = [];
    ends = [];
  };
  for (const span of ordered) {
    if (ends.every((end) => end <= span.start)) close();
    const free = ends.findIndex((end) => end <= span.start);
    const lane = free === -1 ? ends.length : free;
    ends[lane] = Math.max(span.end, span.start + SNAP_MINUTES);
    cluster.push({ id: span.id, lane });
  }
  close();
  return placed;
};

const tintOf = (colour: AreaColour | undefined) => (colour ? areaVar(colour) : "var(--muted-foreground)");

const slotStyle = (day: number, days: number, place: Lane) => ({
  left: `calc(${((day + place.lane / place.lanes) * 100) / days}% + 2px)`,
  width: `calc(${100 / (days * place.lanes)}% - 4px)`,
});

const WHOLE: Lane = { lane: 0, lanes: 1 };

const sleepTint = (kind: TimeboxSleep["kind"]) =>
  kind === "slept"
    ? { fill: 11, hatch: 26 }
    : { fill: 5, hatch: 20 };

const SleepLabel = ({ edge, tight }: { edge: SleepEdge; tight: boolean }) => (
  <span className="flex min-w-0 items-baseline gap-1.5 text-micro leading-4">
    <span className="truncate font-medium text-sleep-ink">{tight ? edge.short : edge.label}</span>
    <span className="shrink-0 font-mono text-sleep-ink/75">{edge.time}</span>
  </span>
);

const SleepBand = ({ band, days, tight }: { band: TimeboxSleep; days: number; tight: boolean }) => {
  const height = toPx(band.end - band.start);
  const opens = band.start > 0;
  const closes = band.end < DAY_MINUTES;
  const tint = sleepTint(band.kind);
  const roomy = height >= (band.top && band.bottom ? 44 : 22);
  return (
    <div
      title={band.title}
      data-sleep={band.kind}
      className={cn("absolute flex flex-col justify-between overflow-hidden px-2 py-0.5", opens && "rounded-t-lg", closes && "rounded-b-lg")}
      style={{
        left: `calc(${(band.day * 100) / days}% + 2px)`,
        width: `calc(${100 / days}% - 4px)`,
        top: toPx(band.start),
        height,
        backgroundColor: `color-mix(in oklab, var(--sleep) ${tint.fill}%, var(--surface-inset))`,
        backgroundImage: `repeating-linear-gradient(-45deg, transparent 0 5px, color-mix(in oklab, var(--sleep) ${tint.hatch}%, transparent) 5px 6px)`,
      }}
    >
      {band.windowEnd !== null && band.windowEnd > band.start && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 bg-sleep/[0.07]"
          style={{ height: toPx(Math.min(band.windowEnd, band.end) - band.start) }}
        />
      )}
      <span className="sr-only">{band.title}</span>
      <span aria-hidden="true" className="relative">{roomy && band.top && <SleepLabel edge={band.top} tight={tight} />}</span>
      <span aria-hidden="true" className="relative">{roomy && band.bottom && <SleepLabel edge={band.bottom} tight={tight} />}</span>
    </div>
  );
};

const Readout = ({ day, days, start, minutes, note }: { day: number; days: number; start: number; minutes: number; note?: string | undefined }) => (
  <div
    aria-hidden="true"
    className="pointer-events-none absolute z-30 flex h-6 max-w-none items-center gap-2 rounded-full bg-foreground px-2.5 font-mono text-micro whitespace-nowrap text-background shadow-float"
    style={{
      top: start < 45 ? toPx(start + minutes) + 6 : toPx(start) - 30,
      ...(day >= days - 1 && days > 1 ? { right: 2 } : { left: `calc(${(day * 100) / days}% + 2px)` }),
    }}
  >
    <MorphText>{formatRange(start, start + minutes)}</MorphText>
    <MorphText className="opacity-60">{formatMinutes(minutes)}</MorphText>
    {note && <span className="font-sans text-background/70">{note}</span>}
  </div>
);

const Tick = () => (
  <svg viewBox="0 0 18 18" aria-hidden="true" className="size-full">
    <path d="M5 9.5l2.7 2.7L13 6.7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const GROUND_LABEL = "rounded-[4px] bg-(--tl-ground) box-decoration-clone px-1";

const formatSpan = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

const outerOf = (start: number, minutes: number, trip: TimeboxTrip | null) => ({ start: start - (trip?.minutes ?? 0), end: start + minutes + (trip?.minutes ?? 0) });

export const gapsBetween = (spans: readonly { start: number; end: number }[], from: number, until: number) => {
  const edges = [{ start: from, end: from }, ...spans.filter((span) => span.end > from && span.start < until).toSorted((a, b) => a.start - b.start), { start: until, end: until }];
  const gaps: { start: number; minutes: number }[] = [];
  let reach = from;
  for (const span of edges) {
    if (span.start - reach >= SNAP_MINUTES) gaps.push({ start: reach, minutes: span.start - reach });
    reach = Math.max(reach, span.end);
  }
  return gaps;
};

const TripBand = ({ trip, start, height, back, ruled }: { trip: TimeboxTrip; start: number; height: number; back: boolean; ruled: boolean }) => (
  <span
    className={cn(
      "flex w-full shrink-0 items-center gap-1.5 overflow-hidden px-2.5 text-[0.625rem] leading-none text-current/70",
      ruled && "border-dashed border-current/25 bg-[color-mix(in_oklab,var(--tl-ground)_50%,transparent)]",
      ruled && (back ? "border-t" : "border-b"),
    )}
    style={{ height }}
  >
    {ruled && height >= 12 && (
      <>
        <Car weight="fill" aria-hidden="true" className="size-3 shrink-0" />
        <span className="truncate">
          {back ? `${trip.minutes} min back` : `${trip.minutes} min drive, leave by `}
          {!back && <span className="font-mono">{formatClock(start - trip.minutes)}</span>}
        </span>
      </>
    )}
  </span>
);

type Movable = { id: string; day: number; start: number; minutes: number; inert: boolean; done: boolean };

type Gesture = {
  id: string;
  mode: "move" | "resize";
  pointerId: number;
  grabMinute: number;
  originX: number;
  originY: number;
  start: number;
  minutes: number;
  notch: number;
  moved: boolean;
};

type Live = { id: string; mode: Gesture["mode"]; day: number; start: number; minutes: number };

type Draw = { pointerId: number; day: number; from: number; to: number };

const MIN_DRAW_MINUTES = 15;

export const Timebox = ({
  days,
  commitments,
  allDay,
  blocks,
  sleep = [],
  ghost,
  previews = [],
  predictions = [],
  energy = null,
  reached = 0,
  workingHours,
  now,
  scrollKey,
  dayLayers,
  zones,
  onDraw,
  onMove,
  onResize,
  onToggle,
  onOpen,
  onRemove,
  onKeep,
  heads,
  className,
}: {
  days: readonly TimeboxDay[];
  commitments: readonly TimeboxCommitment[];
  allDay: readonly TimeboxAllDay[];
  blocks: readonly TimeboxBlock[];
  sleep?: readonly TimeboxSleep[];
  ghost: TimeboxGhost | null;
  previews?: readonly TimeboxPreview[];
  predictions?: readonly TimeboxPrediction[];
  energy?: TimeboxEnergy | null;
  reached?: number;
  workingHours: { startMinute: number; endMinute: number };
  now: { day: number; minute: number } | null;
  scrollKey: string;
  dayLayers?: readonly ReactNode[];
  zones?: ReactNode;
  onDraw?: (day: number, start: number, end: number) => void;
  onMove: (id: string, day: number, start: number) => void;
  onResize: (id: string, minutes: number) => void;
  onToggle: (id: string, done: boolean) => void;
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
  onKeep?: (id: string, day: number, start: number) => void;
  heads?: readonly ReactNode[];
  className?: string;
}) => {
  const reduce = useReducedMotion();
  const scroller = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [byKey, setByKey] = useState(false);
  const [live, setLive] = useState<Live | null>(null);
  const [drawn, setDrawn] = useState<Draw | null>(null);
  const count = days.length;
  const tight = count > 1;
  const clockSpan = (start: number, end: number) => (tight ? formatClock(start) : formatRange(start, end));

  const opens = workingHours.startMinute - 45;
  const anchorMinute = now && now.minute > workingHours.startMinute ? Math.max(opens, Math.min(now.minute - 120, workingHours.endMinute - 360)) : opens;
  const settle = useEffectEvent(() => scroller.current?.scrollTo({ top: toPx(clamp(anchorMinute, 0, DAY_MINUTES)) }));
  const settledFor = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (settledFor.current === scrollKey) return;
    settledFor.current = scrollKey;
    settle();
  });
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    let hidden = element.clientHeight === 0;
    const observer = new ResizeObserver(() => {
      const nowHidden = element.clientHeight === 0;
      if (hidden && !nowHidden) settle();
      hidden = nowHidden;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const places = useMemo(() => {
    const perDay = new Map<number, Span[]>();
    const push = (day: number, span: Span) => perDay.set(day, [...(perDay.get(day) ?? []), span]);
    for (const commitment of commitments) push(commitment.day, { id: commitment.id, start: commitment.start, end: commitment.end });
    for (const block of blocks) push(block.day, { id: block.id, start: block.start, end: block.start + block.minutes });
    return new Map([...perDay.values()].flatMap((spans) => [...lanesOf(spans)]));
  }, [commitments, blocks]);

  const predictionIds = useMemo(() => new Set(predictions.map((prediction) => prediction.id)), [predictions]);
  const keep = (id: string, day: number, start: number) => {
    haptic("drop");
    onKeep?.(id, day, start);
  };

  const dayAt = (clientX: number) => {
    const box = grid.current?.getBoundingClientRect();
    return box ? clamp(Math.floor(((clientX - box.left) / box.width) * count), 0, count - 1) : 0;
  };

  const begin = (block: Movable, mode: Gesture["mode"]) => (event: React.PointerEvent<HTMLElement>) => {
    if (gesture.current || block.inert || event.button !== 0) return;
    const box = grid.current?.getBoundingClientRect();
    if (!box) return;
    event.stopPropagation();
    setByKey(false);
    event.currentTarget.setPointerCapture(event.pointerId);
    const pointerMinute = minuteAtPointer(event.clientY, box.top);
    gesture.current = {
      id: block.id,
      mode,
      pointerId: event.pointerId,
      grabMinute: mode === "move" ? pointerMinute - block.start : pointerMinute - (block.start + block.minutes),
      originX: event.clientX,
      originY: event.clientY,
      start: block.start,
      minutes: block.minutes,
      notch: mode === "move" ? block.start : block.minutes,
      moved: false,
    };
  };

  const track = (block: Movable) => (event: React.PointerEvent<HTMLElement>) => {
    const active = gesture.current;
    const box = grid.current?.getBoundingClientRect();
    if (!active || !box || active.pointerId !== event.pointerId) return;
    if (!active.moved && Math.hypot(event.clientX - active.originX, event.clientY - active.originY) < DRAG_START_PX) return;
    active.moved = true;
    const click = (bounded: number) => {
      const notch = snapTo(bounded);
      if (notch === active.notch) return;
      active.notch = notch;
      haptic("snap");
    };
    const pointerMinute = minuteAtPointer(event.clientY, box.top) - active.grabMinute;
    if (active.mode === "move") {
      const bounded = clamp(pointerMinute, 0, DAY_MINUTES - active.minutes);
      click(bounded);
      const day = dayAt(event.clientX);
      if (day !== (live?.day ?? block.day)) haptic("snap");
      setLive({ id: active.id, mode: "move", day, start: bounded + rubber(pointerMinute - bounded), minutes: active.minutes });
      return;
    }
    const raw = pointerMinute - active.start;
    const bounded = clamp(raw, SNAP_MINUTES, DAY_MINUTES - active.start);
    click(bounded);
    setLive({ id: active.id, mode: "resize", day: block.day, start: active.start, minutes: bounded + rubber(raw - bounded) });
  };

  const finish = (block: Movable) => (event: React.PointerEvent<HTMLElement>) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    gesture.current = null;
    setLive(null);
    const predicted = predictionIds.has(block.id);
    if (!active.moved || !live) {
      if (predicted && event.type === "pointerup") keep(block.id, block.day, block.start);
      return;
    }
    haptic("drop");
    if (active.mode === "move") {
      const start = clamp(snapTo(live.start), 0, DAY_MINUTES - active.minutes);
      if (predicted) keep(block.id, live.day, start);
      else if (start !== block.start || live.day !== block.day) onMove(block.id, live.day, start);
      return;
    }
    const minutes = clamp(snapTo(live.minutes), SNAP_MINUTES, DAY_MINUTES - active.start);
    if (minutes !== block.minutes) onResize(block.id, minutes);
  };

  const nudge = (block: Movable) => (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || event.metaKey || event.ctrlKey || event.altKey || block.inert) return;
    const vertical = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    const sideways = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
      setByKey(true);
    };
    if (predictionIds.has(block.id)) {
      if (vertical !== 0 && !event.shiftKey) {
        handled();
        keep(block.id, block.day, clamp(block.start + vertical * SNAP_MINUTES, 0, DAY_MINUTES - block.minutes));
      } else if (event.key === "Enter" || event.key === " ") {
        handled();
        keep(block.id, block.day, block.start);
      }
      return;
    }
    if (vertical !== 0 && event.shiftKey) {
      handled();
      const minutes = clamp(block.minutes + vertical * SNAP_MINUTES, SNAP_MINUTES, DAY_MINUTES - block.start);
      if (minutes !== block.minutes) onResize(block.id, minutes);
    } else if (vertical !== 0) {
      handled();
      const start = clamp(block.start + vertical * SNAP_MINUTES, 0, DAY_MINUTES - block.minutes);
      if (start !== block.start) onMove(block.id, block.day, start);
    } else if (sideways !== 0 && !event.shiftKey) {
      handled();
      const day = clamp(block.day + sideways, 0, count - 1);
      if (day !== block.day) onMove(block.id, day, block.start);
    } else if (event.key === "Backspace" || event.key === "Delete") {
      handled();
      onRemove(block.id);
    } else if (event.key === "Enter") {
      handled();
      onOpen(block.id);
    } else if (event.key === " ") {
      handled();
      onToggle(block.id, !block.done);
    }
  };

  const drawFrom = (day: number) => (event: React.PointerEvent<HTMLDivElement>) => {
    const box = grid.current?.getBoundingClientRect();
    if (!onDraw || !box || event.button !== 0 || event.pointerType === "touch" || gesture.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const minute = clamp(snapTo(minuteAtPointer(event.clientY, box.top)), 0, DAY_MINUTES);
    setDrawn({ pointerId: event.pointerId, day, from: minute, to: minute });
  };
  const drawTo = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = grid.current?.getBoundingClientRect();
    if (!drawn || !box || drawn.pointerId !== event.pointerId) return;
    const to = clamp(snapTo(minuteAtPointer(event.clientY, box.top)), 0, DAY_MINUTES);
    if (to === drawn.to) return;
    haptic("snap");
    setDrawn({ ...drawn, to });
  };
  const drawEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drawn || drawn.pointerId !== event.pointerId) return;
    setDrawn(null);
    const start = Math.min(drawn.from, drawn.to);
    const end = Math.max(drawn.from, drawn.to);
    if (event.type === "pointerup" && end - start >= MIN_DRAW_MINUTES) {
      haptic("drop");
      onDraw?.(drawn.day, start, end);
    }
  };
  const drawing = drawn && Math.abs(drawn.to - drawn.from) >= MIN_DRAW_MINUTES ? { day: drawn.day, start: Math.min(drawn.from, drawn.to), minutes: Math.abs(drawn.to - drawn.from) } : null;

  const liveBlock = live && (blocks.find((block) => block.id === live.id) ?? predictions.find((prediction) => prediction.id === live.id));
  const shown = live && {
    day: live.day,
    start: clamp(snapTo(live.start), 0, DAY_MINUTES - SNAP_MINUTES),
    minutes: clamp(snapTo(live.minutes), SNAP_MINUTES, DAY_MINUTES),
  };
  const readout = shown ?? ghost ?? drawing;
  const clash =
    readout &&
    commitments.find(
      (commitment) => !commitment.quiet && commitment.day === readout.day && readout.start < commitment.end && readout.start + readout.minutes > commitment.start,
    );
  const columns = { gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` };
  const scale = HOUR_PX / 60;

  const perTaskDay = new Map<string, number>();
  for (const block of blocks) perTaskDay.set(`${block.taskId}:${block.day}`, (perTaskDay.get(`${block.taskId}:${block.day}`) ?? 0) + 1);
  const keyOf = (taskId: string, day: number, fallback: string) => ((perTaskDay.get(`${taskId}:${day}`) ?? 0) <= 1 ? `t:${taskId}:${day}` : fallback);
  const items = [
    ...blocks.map((block) => ({ kind: "block" as const, key: keyOf(block.taskId, block.day, block.id), block })),
    ...predictions.map((prediction) => ({ kind: "prediction" as const, key: keyOf(prediction.taskId, prediction.day, prediction.id), prediction })),
  ];

  const gapFrom = Math.max(workingHours.startMinute, reached);
  const gaps =
    count === 1 && gapFrom < workingHours.endMinute
      ? gapsBetween(
          [
            ...blocks.map((block) => outerOf(block.start, block.minutes, block.trip)),
            ...predictions.map((prediction) => outerOf(prediction.start, prediction.minutes, prediction.trip)),
            ...commitments.filter((commitment) => !commitment.quiet).map((commitment) => ({ start: commitment.start, end: commitment.end })),
          ],
          gapFrom,
          workingHours.endMinute,
        )
      : [];

  return (
    <div
      ref={scroller}
      data-plan-scroll="timebox"
      className={cn("relative min-h-0 flex-1 overflow-y-auto overscroll-contain select-none [--tl-ground:var(--surface-inset)]", className)}
    >
      <div className="sticky top-0 z-20 bg-surface-inset/90 pb-1.5 backdrop-blur-md" style={{ paddingLeft: GUTTER_PX }}>
        <div className={cn("grid", count === 1 && "sr-only")} style={columns}>
          {days.map((day, index) => (
            <div key={day.key} className="min-w-0 px-1">
              <div className="flex h-8 items-center justify-center gap-1.5 text-small">
                <span className={cn(day.today ? "font-medium text-foreground" : "text-muted-foreground")}>{day.weekday}</span>
                <span
                  className={cn(
                    "grid h-5 min-w-5 place-items-center rounded-full px-1 font-mono text-micro",
                    day.today ? "bg-brand font-medium text-brand-foreground" : "text-muted-foreground",
                  )}
                >
                  {day.day}
                </span>
              </div>
              {heads?.[index]}
            </div>
          ))}
        </div>
        {allDay.length > 0 && (
          <div className="grid gap-y-0.5" style={columns}>
            {allDay.map((item) => (
              <div
                key={item.id}
                title={item.title}
                className={cn("mx-0.5 flex h-5 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-micro", item.quiet && "opacity-60")}
                style={{ gridColumnStart: item.day + 1, backgroundColor: `color-mix(in oklab, ${item.colour} 14%, var(--surface-inset))` }}
              >
                <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: item.colour }} />
                <span className="truncate" style={{ color: calendarInk(item.colour) }}>
                  <span className="sr-only">All day: </span>
                  {item.title}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="relative mt-2 mb-6" style={{ height: toPx(DAY_MINUTES) }}>
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0" style={{ width: GUTTER_PX }}>
          {HOURS.map((hour) =>
            hour === 0 ? null : (
              <span
                key={hour}
                className={cn(
                  "absolute z-[1] -translate-y-1/2 rounded-[3px] bg-(--tl-ground) px-0.5 font-mono text-[0.625rem] leading-3.5 whitespace-nowrap text-muted-foreground transition-opacity duration-(--dur-fast)",
                  now && Math.abs(hour * 60 - now.minute) * scale < 13 && "opacity-0",
                )}
                style={{ top: toPx(hour * 60), right: 10 }}
              >
                {formatClock(hour * 60).replace(":00", "")}
              </span>
            ),
          )}
          <span
            className="tl-rail absolute inset-y-0 w-[5px] [--tl-dot:color-mix(in_oklab,var(--foreground)_38%,transparent)]"
            style={{ right: 5, backgroundSize: `5px ${HOUR_PX}px, 5px ${15 * scale}px`, backgroundPosition: `0 ${-HOUR_PX / 2}px, 0 ${-7.5 * scale}px` }}
          />
          {energy && <EnergyLane curve={energy.curve} from={0} to={DAY_MINUTES} scale={scale} now={now?.minute ?? 0} mode={energy.mode} className="right-[7.5px]" />}
          {now && (
            <>
              <span className="tl-now absolute z-[2] size-[9px] -translate-y-1/2 rounded-full bg-brand shadow-[0_0_0_2px_var(--tl-ground)]" style={{ top: toPx(now.minute), right: 3 }} />
              <span
                className="tl-now absolute z-[2] -translate-y-1/2 rounded-full bg-brand px-1.5 font-mono text-[0.625rem] leading-4 font-medium text-brand-foreground"
                style={{ top: toPx(now.minute), right: 14 }}
              >
                {formatClock(now.minute).replace(/ (am|pm)$/, "")}
              </span>
            </>
          )}
        </div>
        {HOURS.map((hour) => (
          <span
            key={hour}
            aria-hidden="true"
            className="absolute right-0 border-t border-dotted border-foreground/[0.09]"
            style={{ top: toPx(hour * 60), left: GUTTER_PX }}
          />
        ))}
        <div ref={grid} className="absolute inset-y-0 right-0" style={{ left: GUTTER_PX }}>
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 bg-foreground/[0.028]" style={{ height: toPx(workingHours.startMinute) }} />
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 bg-foreground/[0.028]" style={{ top: toPx(workingHours.endMinute) }} />
          <div className="absolute inset-0 grid" style={columns}>
            {days.map((day, index) => (
              <div
                key={day.key}
                onPointerDown={onDraw ? drawFrom(index) : undefined}
                onPointerMove={onDraw ? drawTo : undefined}
                onPointerUp={onDraw ? drawEnd : undefined}
                onPointerCancel={onDraw ? drawEnd : undefined}
                data-no-select={onDraw ? "" : undefined}
                className={cn(
                  "relative",
                  onDraw && "cursor-crosshair",
                  day.today && count > 1 && "bg-foreground/[0.03]",
                  index > 0 && "shadow-[inset_1px_0_0_color-mix(in_oklab,var(--foreground)_6%,transparent)]",
                )}
              >
                {dayLayers?.[index]}
              </div>
            ))}
          </div>
          {sleep.map((band) => (
            <SleepBand key={band.id} band={band} days={count} tight={tight} />
          ))}
          {zones}
          {gaps.map((gap) => {
            const hint = energyHint(energy?.curve ?? null, gap.start + gap.minutes / 2);
            return (
              <span
                key={gap.start}
                data-gap={gap.minutes < 30 ? "buffer" : "free"}
                className="pointer-events-none absolute left-2.5 flex -translate-y-1/2 items-center gap-1.5 text-[0.625rem] leading-none whitespace-nowrap text-muted-foreground"
                style={{ top: toPx(gap.start + gap.minutes / 2) }}
              >
                {gap.minutes < 30 ? "Buffer" : "Free"} <span className="font-mono">{formatSpan(gap.minutes)}</span>
                {gap.minutes >= 30 && hint && <span>· {hint}</span>}
              </span>
            );
          })}
          {drawing && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute rounded-lg bg-brand/[0.06] outline-[1.5px] -outline-offset-[1.5px] outline-dashed outline-brand/60"
              style={{ ...slotStyle(drawing.day, count, WHOLE), top: toPx(drawing.start) + 1, height: toPx(drawing.minutes) - 2 }}
            />
          )}
          {commitments.map((commitment) => {
            const height = toPx(commitment.end - commitment.start) - 2;
            return (
              <div
                key={commitment.id}
                title={`${commitment.title}, ${formatRange(commitment.start, commitment.end)}, ${commitment.source}`}
                data-look={commitment.past ? "commitment-past" : "commitment"}
                className={cn(
                  "tl-block absolute flex flex-col overflow-hidden px-2.5 text-small",
                  height < 26 ? "rounded-md" : "rounded-[0.625rem]",
                  height < 40 ? "justify-center" : "py-1.5",
                  commitment.quiet && "opacity-60",
                )}
                style={{
                  ...slotStyle(commitment.day, count, places.get(commitment.id) ?? WHOLE),
                  top: toPx(commitment.start) + 1,
                  height: Math.max(height, 12),
                  ["--a" as string]: commitment.colour,
                }}
              >
                <span className={cn("flex min-w-0 items-center gap-2", height < 26 && "text-micro")}>
                  <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", commitment.past && "opacity-50")} style={{ backgroundColor: commitment.colour }} />
                  <span className="truncate font-medium">{commitment.title}</span>
                  {height < 40 && <span className="sr-only">, {formatRange(commitment.start, commitment.end)}, {commitment.source}</span>}
                </span>
                {height >= 40 && (
                  <span className="flex min-w-0 gap-1.5 pl-4 text-micro text-current/65">
                    <span className="shrink-0 font-mono">{clockSpan(commitment.start, commitment.end)}</span>
                    {!tight && <span className="truncate">{commitment.source}</span>}
                  </span>
                )}
              </div>
            );
          })}
          <AnimatePresence initial={false}>
            {items.map((item) => {
              const thing = item.kind === "block" ? item.block : item.prediction;
              const predicted = item.kind === "prediction";
              const block = item.kind === "block" ? item.block : null;
              const done = block?.done === true;
              const look = predicted ? "predicted" : block?.past ? (done ? "done" : "missed") : "kept";
              const moving = live?.id === thing.id ? live : null;
              const travel = thing.trip?.minutes ?? 0;
              const start = moving?.start ?? thing.start;
              const minutes = moving?.minutes ?? thing.minutes;
              const main = Math.max(toPx(minutes) - 2, 12);
              const slim = main < 26;
              const tall = main >= 44;
              const outer = main + toPx(travel) * 2;
              const range = formatRange(thing.start, thing.start + thing.minutes);
              const liveRange = moving && shown ? clockSpan(shown.start, shown.start + shown.minutes) : clockSpan(thing.start, thing.start + thing.minutes);
              const movable: Movable = block ?? { ...thing, inert: false, done: false };
              const meta = item.kind === "prediction" ? `${item.prediction.guess ? "~" : ""}${formatSpan(item.prediction.minutes)}${item.prediction.fit ? ` · at your ${item.prediction.fit}` : ""}` : "";
              const drive = thing.trip ? `, ${thing.trip.minutes} min drive each way, leave by ${formatClock(thing.start - thing.trip.minutes)}` : "";
              const label = predicted
                ? `, predicted, ${range}${drive}${item.kind === "prediction" && item.prediction.fit ? `, at your ${item.prediction.fit}` : ""}. Click or press Enter to keep it, drag or use the arrow keys to keep it at another time.`
                : `Work Block, ${thing.title}, ${range}${drive}${done ? ", done" : look === "missed" ? ", not done" : ""}. Arrow keys move it, Shift and arrow keys resize it, Backspace removes it.`;
              return (
                <motion.div
                  key={item.key}
                  role={predicted ? "button" : "group"}
                  tabIndex={0}
                  data-block-id={block ? block.id : undefined}
                  data-prediction-id={predicted ? thing.id : undefined}
                  data-look={look}
                  data-no-select=""
                  aria-label={predicted ? undefined : label}
                  onPointerDown={begin(movable, "move")}
                  onPointerMove={track(movable)}
                  onPointerUp={finish(movable)}
                  onPointerCancel={finish(movable)}
                  onKeyDown={nudge(movable)}
                  onDoubleClick={block ? () => onOpen(block.id) : undefined}
                  initial={{ opacity: 0.6, y: toPx(start - travel) + 1, height: outer }}
                  animate={{ opacity: 1, y: toPx(start - travel) + 1, height: outer, scale: moving?.mode === "move" ? 1.02 : 1 }}
                  exit={{ opacity: 0, transition: exit }}
                  transition={moving || reduce || byKey ? instant : springSettle}
                  className={cn(
                    "tl-block group/block absolute top-0 flex flex-col touch-none overflow-hidden text-small",
                    slim ? "rounded-md" : "rounded-[0.625rem]",
                    moving ? "z-20 cursor-grabbing shadow-lift" : block?.inert ? "cursor-default" : predicted ? "cursor-pointer" : "cursor-grab",
                  )}
                  style={{
                    ...slotStyle(moving?.day ?? thing.day, count, moving || predicted ? WHOLE : (places.get(thing.id) ?? WHOLE)),
                    ["--a" as string]: tintOf(thing.colour),
                  } as CSSProperties}
                >
                  {thing.trip && <TripBand trip={thing.trip} start={thing.start} height={toPx(travel)} back={false} ruled={!tight} />}
                  <span className={cn("flex w-full shrink-0 gap-2", predicted ? "px-1.5" : "px-2.5", slim ? "items-center" : "items-start pt-1.5")} style={{ height: main }}>
                    {block && (
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={done}
                        aria-label={`Complete ${thing.title}`}
                        onPointerDown={(event) => event.stopPropagation()}
                        onDoubleClick={(event) => event.stopPropagation()}
                        onClick={() => onToggle(block.id, !done)}
                        className={cn(
                          "relative grid shrink-0 place-items-center text-(--tl-ground) transition-[background-color,box-shadow,scale] duration-(--dur-press) ease-out before:absolute before:-inset-3.5 active:scale-[0.85]",
                          slim ? "size-3 rounded-[4px]" : "mt-px size-3.5 rounded-[5px]",
                          done ? "bg-current text-current" : "shadow-[inset_0_0_0_1.5px_var(--tl-box)]",
                        )}
                      >
                        {done && (
                          <span className="size-full text-(--tl-ground)">
                            <Tick />
                          </span>
                        )}
                      </button>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate font-medium", slim ? "text-micro leading-4" : "leading-[1.125rem]", done && "line-through decoration-current/45")}>
                        <span className={cn(predicted && GROUND_LABEL)}>{thing.title}</span>
                      </span>
                      {tall && (
                        <span className="mt-0.5 block truncate text-micro text-current/65">
                          <span className={cn(predicted && GROUND_LABEL)}>
                            {look === "missed" && !tight && "Not done · "}
                            <MorphText className="font-mono">{liveRange}</MorphText>
                            {predicted && !tight && ` · ${meta}`}
                          </span>
                        </span>
                      )}
                    </span>
                    {!tall && !tight && (
                      <span className={cn("shrink-0 font-mono text-micro text-current/65", slim ? "leading-4" : "leading-[1.125rem]")}>
                        <span className={cn(predicted && GROUND_LABEL)}>{formatClock(thing.start)}</span>
                      </span>
                    )}
                  </span>
                  {thing.trip && <TripBand trip={thing.trip} start={thing.start} height={toPx(travel)} back ruled={!tight} />}
                  {predicted && <span className="sr-only">{label}</span>}
                  {block && !block.inert && (
                    <span
                      aria-hidden="true"
                      onPointerDown={begin(block, "resize")}
                      onPointerMove={track(block)}
                      onPointerUp={finish(block)}
                      onPointerCancel={finish(block)}
                      className="absolute inset-x-0 bottom-0 grid h-2.5 cursor-ns-resize touch-none place-items-center"
                    >
                      <span className="h-[3px] w-6 rounded-full bg-foreground/25 opacity-0 transition-opacity duration-(--dur-fast) group-hover/block:opacity-100 group-focus-visible/block:opacity-100" />
                    </span>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
          <AnimatePresence>
            {previews.map((preview, index) => (
              <motion.div
                key={preview.id}
                aria-hidden="true"
                data-spread-preview=""
                data-look="predicted"
                initial={reduce ? { opacity: 0 } : { opacity: 0, transform: "translateY(4px)" }}
                animate={{ opacity: 1, transform: "translateY(0px)" }}
                exit={{ opacity: 0, transition: exit }}
                transition={{ duration: reduce ? 0.12 : 0.22, ease: EASE_OUT, delay: reduce ? 0 : Math.min(index, 12) * 0.035 }}
                className={cn(
                  "tl-block pointer-events-none absolute z-20 overflow-hidden rounded-[0.625rem] px-1.5 text-small",
                  toPx(preview.minutes) < 26 ? "flex items-center py-0 leading-none" : "py-1.5",
                )}
                style={{
                  ...slotStyle(preview.day, count, WHOLE),
                  top: toPx(preview.start) + 1,
                  height: Math.max(toPx(preview.minutes) - 2, 12),
                  ["--a" as string]: tintOf(preview.colour),
                } as CSSProperties}
              >
                <span className={cn("block truncate font-medium", toPx(preview.minutes) < 26 && "text-micro")}>
                  <span className={GROUND_LABEL}>{preview.title}</span>
                </span>
                {toPx(preview.minutes) >= 40 && (
                  <span className="block truncate font-mono text-micro text-foreground/65">
                    <span className={GROUND_LABEL}>{clockSpan(preview.start, preview.start + preview.minutes)}</span>
                  </span>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
          {ghost && (
            <div
              aria-hidden="true"
              data-look="kept"
              className="tl-block pointer-events-none absolute z-20 overflow-hidden rounded-[0.625rem] px-2.5 py-1.5 text-small font-medium shadow-lift"
              style={{
                ...slotStyle(ghost.day, count, WHOLE),
                top: toPx(ghost.start) + 1,
                height: Math.max(toPx(ghost.minutes) - 2, 12),
                ["--a" as string]: tintOf(ghost.colour),
              } as CSSProperties}
            >
              <span className="block truncate">{ghost.title}</span>
            </div>
          )}
          {readout && (
            <Readout
              day={readout.day}
              days={count}
              start={readout.start}
              minutes={readout.minutes}
              note={clash && (liveBlock || ghost) ? `over ${clash.title}` : undefined}
            />
          )}
          {now && (
            <div
              aria-hidden="true"
              className="tl-now pointer-events-none absolute z-10 h-px bg-brand"
              style={{ top: toPx(now.minute), left: `${(now.day * 100) / count}%`, width: `${100 / count}%` }}
            />
          )}
        </div>
      </div>
    </div>
  );
};
