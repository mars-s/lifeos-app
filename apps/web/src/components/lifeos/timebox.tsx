"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MorphText } from "@/components/ui/morph-text";
import { haptic } from "@/lib/haptics";
import { exit, instant, springSettle } from "@/lib/motion-tokens";
import { cn } from "@/lib/utils";
import { areaVar, type AreaColour } from "./area";
import { calendarInk } from "./commitments";
import { formatClock, formatMinutes, formatRange } from "./format";

export const HOUR_PX = 56;
export const SNAP_MINUTES = 15;
const DAY_MINUTES = 24 * 60;
const DRAG_START_PX = 4;
const GUTTER_REM = 3;
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
};

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
  className,
}: {
  days: readonly TimeboxDay[];
  commitments: readonly TimeboxCommitment[];
  allDay: readonly TimeboxAllDay[];
  blocks: readonly TimeboxBlock[];
  sleep?: readonly TimeboxSleep[];
  ghost: TimeboxGhost | null;
  previews?: readonly TimeboxPreview[];
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

  const dayAt = (clientX: number) => {
    const box = grid.current?.getBoundingClientRect();
    return box ? clamp(Math.floor(((clientX - box.left) / box.width) * count), 0, count - 1) : 0;
  };

  const begin = (block: TimeboxBlock, mode: Gesture["mode"]) => (event: React.PointerEvent<HTMLElement>) => {
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

  const track = (block: TimeboxBlock) => (event: React.PointerEvent<HTMLElement>) => {
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

  const finish = (block: TimeboxBlock) => (event: React.PointerEvent<HTMLElement>) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    gesture.current = null;
    setLive(null);
    if (!active.moved || !live) return;
    haptic("drop");
    if (active.mode === "move") {
      const start = clamp(snapTo(live.start), 0, DAY_MINUTES - active.minutes);
      if (start !== block.start || live.day !== block.day) onMove(block.id, live.day, start);
      return;
    }
    const minutes = clamp(snapTo(live.minutes), SNAP_MINUTES, DAY_MINUTES - active.start);
    if (minutes !== block.minutes) onResize(block.id, minutes);
  };

  const nudge = (block: TimeboxBlock) => (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || event.metaKey || event.ctrlKey || event.altKey || block.inert) return;
    const vertical = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    const sideways = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
      setByKey(true);
    };
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

  const liveBlock = live && blocks.find((block) => block.id === live.id);
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

  return (
    <div ref={scroller} data-plan-scroll="timebox" className={cn("relative min-h-0 flex-1 overflow-y-auto overscroll-contain select-none", className)}>
      <div className="sticky top-0 z-20 bg-surface-inset/90 pb-1.5 backdrop-blur-md" style={{ paddingLeft: `${GUTTER_REM}rem` }}>
        <div className={cn("grid", count === 1 && "sr-only")} style={columns}>
          {days.map((day) => (
            <div key={day.key} className="flex h-8 items-center justify-center gap-1.5 text-small">
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
        {HOURS.map((hour) => (
          <div key={hour} className="absolute inset-x-0 flex -translate-y-1/2 items-center" style={{ top: toPx(hour * 60) }}>
            <span className="shrink-0 pr-2 text-right font-mono text-micro text-faint-foreground" style={{ width: `${GUTTER_REM}rem` }}>
              {hour === 0 ? "" : formatClock(hour * 60).replace(":00", "")}
            </span>
            <span className="h-px flex-1 bg-[radial-gradient(circle,var(--foreground)_0.5px,transparent_0.75px)] bg-[length:6px_1px] opacity-30" />
          </div>
        ))}
        <div ref={grid} className="absolute inset-y-0 right-0" style={{ left: `${GUTTER_REM}rem` }}>
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
                className={cn("relative", onDraw && "cursor-crosshair", index > 0 && "shadow-[inset_1px_0_0_color-mix(in_oklab,var(--foreground)_6%,transparent)]")}
              >
                {dayLayers?.[index]}
              </div>
            ))}
          </div>
          {sleep.map((band) => (
            <SleepBand key={band.id} band={band} days={count} tight={tight} />
          ))}
          {zones}
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
                className={cn(
                  "absolute flex flex-col overflow-hidden rounded-lg px-2 text-small",
                  height < 40 ? "justify-center" : "py-1",
                  commitment.quiet &&
                    "bg-[repeating-linear-gradient(-45deg,transparent_0_5px,color-mix(in_oklab,var(--foreground)_6%,transparent)_5px_6px)] opacity-70",
                )}
                style={{
                  ...slotStyle(commitment.day, count, places.get(commitment.id) ?? WHOLE),
                  top: toPx(commitment.start) + 1,
                  height: Math.max(height, 12),
                  backgroundColor: `color-mix(in oklab, ${commitment.colour} ${commitment.quiet ? 6 : 13}%, var(--surface-inset))`,
                }}
              >
                <span className={cn("flex min-w-0 items-center gap-1.5", height < 26 && "text-micro")}>
                  <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: commitment.colour }} />
                  <span className="truncate font-medium" style={{ color: calendarInk(commitment.colour) }}>
                    {commitment.title}
                  </span>
                </span>
                {height >= 40 && (
                  <span className="flex min-w-0 gap-1.5 text-micro text-muted-foreground">
                    <span className="shrink-0 font-mono">{clockSpan(commitment.start, commitment.end)}</span>
                    {!tight && <span className="truncate text-faint-foreground">{commitment.source}</span>}
                  </span>
                )}
              </div>
            );
          })}
          <AnimatePresence initial={false}>
            {blocks.map((block) => {
              const moving = live?.id === block.id ? live : null;
              const start = moving?.start ?? block.start;
              const minutes = moving?.minutes ?? block.minutes;
              const height = Math.max(toPx(minutes) - 2, 12);
              const tint = tintOf(block.colour);
              const range = formatRange(block.start, block.start + block.minutes);
              const liveRange = moving && shown ? clockSpan(shown.start, shown.start + shown.minutes) : clockSpan(block.start, block.start + block.minutes);
              return (
                <motion.div
                  key={block.id}
                  role="group"
                  tabIndex={0}
                  data-block-id={block.id}
                  data-no-select=""
                  aria-label={`Work Block, ${block.title}, ${range}${block.done ? ", done" : ""}. Arrow keys move it, Shift and arrow keys resize it, Backspace removes it.`}
                  onPointerDown={begin(block, "move")}
                  onPointerMove={track(block)}
                  onPointerUp={finish(block)}
                  onPointerCancel={finish(block)}
                  onKeyDown={nudge(block)}
                  onDoubleClick={() => onOpen(block.id)}
                  initial={{ opacity: 0.6, y: toPx(start) + 1, height }}
                  animate={{ opacity: block.done && !moving ? 0.5 : 1, y: toPx(start) + 1, height, scale: moving?.mode === "move" ? 1.02 : 1 }}
                  exit={{ opacity: 0, transition: exit }}
                  transition={moving || reduce || byKey ? instant : springSettle}
                  className={cn(
                    "group/block absolute top-0 flex touch-none overflow-hidden rounded-lg px-2 text-small outline-offset-2 transition-[left,width,box-shadow] duration-(--dur-fast) ease-out motion-reduce:transition-none",
                    height < 40 ? "items-center" : "items-start py-1",
                    moving ? "z-20 cursor-grabbing shadow-lift" : block.inert ? "cursor-default" : "cursor-grab",
                  )}
                  style={{
                    ...slotStyle(moving?.day ?? block.day, count, moving ? WHOLE : (places.get(block.id) ?? WHOLE)),
                    backgroundColor: `color-mix(in oklab, ${tint} 22%, var(--surface-inset))`,
                  }}
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={block.done}
                    aria-label={`Complete ${block.title}`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                    onClick={() => onToggle(block.id, !block.done)}
                    className={cn(
                      "relative mr-1.5 grid size-3.5 shrink-0 place-items-center rounded-[5px] text-background transition-[background-color,box-shadow,scale] duration-(--dur-press) ease-out before:absolute before:-inset-2 active:scale-[0.85]",
                      height >= 40 && "mt-[3px]",
                      block.done ? "bg-foreground/55" : "shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--foreground)_38%,transparent)] hover:shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--foreground)_62%,transparent)]",
                    )}
                  >
                    {block.done && <Tick />}
                  </button>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate font-medium", height < 26 && "text-micro", block.done && "line-through decoration-foreground/40")}>
                      {block.title}
                    </span>
                    {height >= 40 && <MorphText className="block truncate font-mono text-micro text-foreground/65">{liveRange}</MorphText>}
                  </span>
                  {!block.inert && (
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
          {previews.map((preview, index) => (
            <motion.div
              key={preview.id}
              aria-hidden="true"
              data-spread-preview=""
              initial={reduce ? { opacity: 0 } : { opacity: 0, transform: "translateY(4px)" }}
              animate={{ opacity: 1, transform: "translateY(0px)" }}
              transition={{ duration: reduce ? 0.12 : 0.22, ease: [0.23, 1, 0.32, 1], delay: reduce ? 0 : Math.min(index, 12) * 0.035 }}
              className={cn(
                "pointer-events-none absolute z-20 overflow-hidden rounded-lg px-2 text-small outline-[1.5px] -outline-offset-[1.5px] outline-dashed",
                toPx(preview.minutes) < 26 ? "flex items-center py-0 leading-none" : "py-1",
              )}
              style={{
                ...slotStyle(preview.day, count, WHOLE),
                top: toPx(preview.start) + 1,
                height: Math.max(toPx(preview.minutes) - 2, 12),
                outlineColor: `color-mix(in oklab, ${tintOf(preview.colour)} 70%, transparent)`,
                backgroundColor: `color-mix(in oklab, ${tintOf(preview.colour)} 10%, var(--surface-inset))`,
              }}
            >
              <span className={cn("block truncate font-medium", toPx(preview.minutes) < 26 && "text-micro")}>{preview.title}</span>
              {toPx(preview.minutes) >= 40 && (
                <span className="block truncate font-mono text-micro text-foreground/65">{clockSpan(preview.start, preview.start + preview.minutes)}</span>
              )}
            </motion.div>
          ))}
          {ghost && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute z-20 overflow-hidden rounded-lg px-2 py-1 text-small font-medium shadow-lift"
              style={{
                ...slotStyle(ghost.day, count, WHOLE),
                top: toPx(ghost.start) + 1,
                height: Math.max(toPx(ghost.minutes) - 2, 12),
                backgroundColor: `color-mix(in oklab, ${tintOf(ghost.colour)} 22%, var(--surface-inset))`,
              }}
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
              className="pointer-events-none absolute z-10 flex h-0 items-center"
              style={{ top: toPx(now.minute), left: `${(now.day * 100) / count}%`, width: `${100 / count}%` }}
            >
              <span className="-ml-1 size-2 shrink-0 rounded-full bg-brand" />
              <span className="h-[1.5px] flex-1 bg-brand" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
