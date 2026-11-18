"use client";

import { CalendarBlank } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { useRef, useState } from "react";
import { MorphText } from "@/components/ui/morph-text";
import { haptic } from "@/lib/haptics";
import { instant, springSettle } from "@/lib/motion-tokens";
import { cn } from "@/lib/utils";
import { areaVar, type AreaColour } from "./area";
import { formatClock, formatMinutes, formatRange } from "./format";

const HOUR_PX = 56;
const SNAP = 15;
const MIN_DURATION = 15;

const toPx = (minutes: number) => (minutes / 60) * HOUR_PX;
const snap = (minutes: number, step: number) => Math.round(minutes / step) * step;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const rubber = (overshoot: number) => (overshoot * 120 * 0.55) / (120 + 0.55 * Math.abs(overshoot));

export type Commitment = { title: string; source: string; start: number; end: number };
export type WorkBlock = { title: string; colour: AreaColour; start: number; duration: number };

type Gesture = { mode: "move" | "resize"; pointerY: number; start: number; duration: number; notch: number };

export const CalendarStrip = ({
  dayStart,
  dayEnd,
  commitments,
  block,
  onBlockChange,
  className,
}: {
  dayStart: number;
  dayEnd: number;
  commitments: Commitment[];
  block: WorkBlock;
  onBlockChange: (block: WorkBlock) => void;
  className?: string;
}) => {
  const reduce = useReducedMotion();
  const gesture = useRef<Gesture | null>(null);
  const [live, setLive] = useState<{ start: number; duration: number; mode: Gesture["mode"] } | null>(null);

  const start = live?.start ?? block.start;
  const duration = live?.duration ?? block.duration;
  const shownStart = clamp(snap(start, 5), dayStart, dayEnd - duration);
  const shownDuration = clamp(snap(duration, 5), MIN_DURATION, dayEnd - shownStart);
  const hours = Array.from({ length: (dayEnd - dayStart) / 60 + 1 }, (_, index) => dayStart + index * 60);

  const begin = (mode: Gesture["mode"]) => (event: React.PointerEvent<HTMLElement>) => {
    if (gesture.current) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      mode,
      pointerY: event.clientY,
      start: block.start,
      duration: block.duration,
      notch: mode === "move" ? block.start : block.duration,
    };
    setLive({ start: block.start, duration: block.duration, mode });
  };

  const track = (event: React.PointerEvent<HTMLElement>) => {
    const active = gesture.current;
    if (!active) return;
    const click = (bounded: number) => {
      const notch = snap(bounded, SNAP);
      if (notch === active.notch) return;
      active.notch = notch;
      haptic("snap");
    };
    const delta = ((event.clientY - active.pointerY) / HOUR_PX) * 60;
    if (active.mode === "move") {
      const raw = active.start + delta;
      const bounded = clamp(raw, dayStart, dayEnd - active.duration);
      click(bounded);
      setLive({ start: bounded + rubber(raw - bounded), duration: active.duration, mode: "move" });
      return;
    }
    const raw = active.duration + delta;
    const bounded = clamp(raw, MIN_DURATION, dayEnd - active.start);
    click(bounded);
    setLive({ start: active.start, duration: bounded + rubber(raw - bounded), mode: "resize" });
  };

  const finish = () => {
    if (!gesture.current) return;
    gesture.current = null;
    haptic("drop");
    const nextStart = clamp(snap(start, SNAP), dayStart, dayEnd - MIN_DURATION);
    const nextDuration = clamp(snap(duration, SNAP), MIN_DURATION, dayEnd - nextStart);
    setLive(null);
    onBlockChange({ ...block, start: clamp(nextStart, dayStart, dayEnd - nextDuration), duration: nextDuration });
  };

  const nudge = (event: React.KeyboardEvent) => {
    const direction = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (direction === 0) return;
    event.preventDefault();
    if (event.shiftKey) {
      onBlockChange({
        ...block,
        duration: clamp(block.duration + direction * SNAP, MIN_DURATION, dayEnd - block.start),
      });
      return;
    }
    onBlockChange({ ...block, start: clamp(block.start + direction * SNAP, dayStart, dayEnd - block.duration) });
  };

  const dragging = live !== null;
  const clash = commitments.find(
    (commitment) => shownStart < commitment.end && shownStart + shownDuration > commitment.start,
  );
  const tint = areaVar(block.colour);

  return (
    <div className={cn("relative select-none", className)} style={{ height: toPx(dayEnd - dayStart) + 16 }}>
      {hours.map((hour) => (
        <div
          key={hour}
          className="absolute inset-x-0 flex items-center gap-3"
          style={{ top: toPx(hour - dayStart) }}
        >
          <span className="w-12 shrink-0 text-right font-mono text-micro text-faint-foreground">
            {formatClock(hour).replace(":00", "")}
          </span>
          <span className="h-px flex-1 bg-[radial-gradient(circle,var(--foreground)_0.5px,transparent_0.75px)] bg-[length:6px_1px] opacity-30" />
        </div>
      ))}
      <div className="absolute inset-y-0 right-0 left-[3.75rem] mt-2">
        {commitments.map((commitment) => (
          <div
            key={commitment.title}
            className="absolute inset-x-0 flex flex-col justify-center overflow-hidden rounded-xl bg-surface-inset bg-[repeating-linear-gradient(-45deg,transparent_0_5px,color-mix(in_oklab,var(--foreground)_7%,transparent)_5px_6px)] px-3 text-small text-muted-foreground"
            style={{ top: toPx(commitment.start - dayStart) + 1, height: toPx(commitment.end - commitment.start) - 2 }}
          >
            <span className="flex items-center gap-1.5 truncate font-medium">
              <CalendarBlank weight="fill" className="size-3.5 shrink-0" aria-hidden="true" />
              {commitment.title}
            </span>
            <span className="flex gap-2 truncate text-micro text-faint-foreground">
              <span className="font-mono">{formatRange(commitment.start, commitment.end)}</span>
              {commitment.source}
            </span>
          </div>
        ))}
        <motion.div
          role="group"
          tabIndex={0}
          aria-label={`Work Block, ${block.title}, ${formatRange(block.start, block.start + block.duration)}. Arrow keys move it, Shift and arrow keys resize it.`}
          onPointerDown={begin("move")}
          onPointerMove={track}
          onPointerUp={finish}
          onPointerCancel={finish}
          onKeyDown={nudge}
          initial={false}
          animate={{
            y: toPx(start - dayStart) + 1,
            height: toPx(duration) - 2,
            scale: dragging && live.mode === "move" ? 1.015 : 1,
          }}
          transition={dragging || reduce ? instant : springSettle}
          className={cn(
            "absolute inset-x-0 top-0 flex touch-none flex-col overflow-hidden rounded-xl px-3 py-1.5 text-small transition-shadow duration-(--dur-base) ease-out",
            dragging ? "z-10 cursor-grabbing shadow-lift" : "cursor-grab",
          )}
          style={{ backgroundColor: `color-mix(in oklab, ${tint} 22%, var(--surface-inset))` }}
        >
          <span className="flex items-center gap-1.5 truncate font-medium">
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: tint }} />
            {block.title}
          </span>
          <span className="flex gap-2 truncate text-micro text-foreground/70">
            <MorphText className="font-mono">{formatRange(shownStart, shownStart + shownDuration)}</MorphText>
            {clash && <span className="truncate font-medium text-negative">Overlaps {clash.title}</span>}
          </span>
          <span
            aria-hidden="true"
            onPointerDown={begin("resize")}
            onPointerMove={track}
            onPointerUp={finish}
            onPointerCancel={finish}
            className="absolute inset-x-0 bottom-0 grid h-3.5 cursor-ns-resize touch-none place-items-center"
          >
            <span className="h-[3px] w-7 rounded-full bg-foreground/25" />
          </span>
        </motion.div>
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute right-2 z-20 flex h-6 items-center gap-2 rounded-full bg-foreground px-2.5 font-mono text-micro text-background shadow-float transition-[opacity,scale] duration-(--dur-fast) ease-out",
            dragging ? "scale-100 opacity-100" : "scale-95 opacity-0",
          )}
          style={{ top: toPx(shownStart - dayStart) - 28 }}
        >
          <MorphText>{formatRange(shownStart, shownStart + shownDuration)}</MorphText>
          <MorphText className="opacity-60">{formatMinutes(shownDuration)}</MorphText>
        </div>
      </div>
    </div>
  );
};
