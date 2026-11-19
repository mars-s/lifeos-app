"use client";

import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { parseEstimateText } from "@lifeos/backend/estimate";
import { RollingNumber } from "@/components/ui/rolling-number";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import type { AreaColour } from "./area";
import { meterTint } from "./capacity";
import { formatMinutes } from "./format";

const STEP = 15;
const HOUR = 60;
const GOAL_PRESETS = [4 * HOUR, 6 * HOUR, 8 * HOUR] as const;
const MIN_SPAN = 12 * HOUR;
const MAX_SPAN = 24 * HOUR;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

const snap = (minutes: number) => Math.round(minutes / STEP) * STEP;

export const scrubberSpan = (goal: number, free: number) =>
  clamp(Math.ceil(Math.max(MIN_SPAN, goal, free) / HOUR) * HOUR, MIN_SPAN, MAX_SPAN);

export const GoalScrubber = ({
  value,
  free,
  onScrub,
  onCommit,
}: {
  value: number;
  free: number;
  onScrub: (minutes: number) => void;
  onCommit: (minutes: number) => void;
}) => {
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const span = scrubberSpan(value, free);
  const hours = span / HOUR;

  const valueAt = (clientX: number) => {
    const box = track.current?.getBoundingClientRect();
    if (!box || box.width === 0) return value;
    return clamp(snap(((clientX - box.left) / box.width) * span), 0, span);
  };

  const move = (next: number) => {
    if (next === value) return;
    haptic("snap");
    onScrub(next);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
    move(valueAt(event.clientX));
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) move(valueAt(event.clientX));
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    onCommit(valueAt(event.clientX));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const by: Record<string, number> = { ArrowLeft: -STEP, ArrowDown: -STEP, ArrowRight: STEP, ArrowUp: STEP, PageDown: -HOUR, PageUp: HOUR };
    const next =
      event.key === "Home" ? 0 : event.key === "End" ? span : by[event.key] === undefined ? null : clamp(value + (by[event.key] ?? 0), 0, MAX_SPAN);
    if (next === null) return;
    event.preventDefault();
    if (next !== value) onCommit(next);
  };

  const filled = value / STEP;
  const freeAt = Math.round(Math.max(0, free) / STEP);

  return (
    <div className="space-y-1.5">
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="Goal for the day"
        aria-valuemin={0}
        aria-valuemax={span}
        aria-valuenow={value}
        aria-valuetext={`${formatMinutes(value)} planned work`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        className="relative flex h-9 cursor-ew-resize touch-none items-center select-none gap-[5px] rounded-lg px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {Array.from({ length: hours }, (_, hour) => (
          <span key={hour} className="flex flex-1 items-center justify-between">
            {Array.from({ length: HOUR / STEP }, (_unused, quarter) => {
              const index = hour * (HOUR / STEP) + quarter;
              return (
                <span
                  key={quarter}
                  className={cn(
                    "rounded-full transition-[background-color] duration-(--dur-fast) ease-out",
                    quarter === 0 ? "h-3 w-[3px]" : "h-1.5 w-[3px]",
                    index < filled ? "bg-brand" : index >= freeAt ? "bg-negative/25" : "bg-foreground/15",
                  )}
                />
              );
            })}
          </span>
        ))}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-popover shadow-[0_0_0_1.5px_var(--brand),0_1px_3px_rgb(0_0_0/0.18)]"
          style={{ left: `calc(0.25rem + (100% - 0.5rem) * ${value / span})` }}
        />
      </div>
      <div aria-hidden="true" className="flex justify-between px-1 font-mono text-micro text-faint-foreground">
        <span>0:00</span>
        <span>{formatMinutes(span / 2)}</span>
        <span>{formatMinutes(span)}</span>
      </div>
    </div>
  );
};

const CHIP =
  "h-7 rounded-md px-2 font-mono text-small transition-[background-color,color,scale] duration-(--dur-press) ease-out active:scale-[0.96] aria-pressed:bg-brand aria-pressed:text-brand-foreground";

export const GoalEditor = ({
  goal,
  free,
  goalSet,
  onChange,
}: {
  goal: number;
  free: number;
  goalSet: boolean;
  onChange: (minutes: number | null) => void;
}) => {
  const [scrub, setScrub] = useState<number | null>(null);
  const [typed, setTyped] = useState("");
  const [refused, setRefused] = useState(false);
  const typedId = useId();
  const shown = scrub ?? goal;
  const freeTime = Math.max(0, free);

  const choose = (minutes: number | null) => {
    setScrub(null);
    if (minutes === null ? goalSet : minutes !== goal || !goalSet) onChange(minutes);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2 px-1">
        <RollingNumber value={formatMinutes(shown)} className="font-mono text-title font-semibold" />
        <span className="text-small text-muted-foreground">
          {scrub === null && !goalSet ? "your free time" : shown > freeTime ? `${formatMinutes(shown - freeTime)} more than you have free` : "planned work"}
        </span>
      </div>
      <GoalScrubber
        value={shown}
        free={freeTime}
        onScrub={setScrub}
        onCommit={choose}
      />
      <div role="group" aria-label="Goal presets" className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          aria-pressed={!goalSet}
          onClick={(event) => {
            if (event.detail > 0) haptic("toggle");
            choose(null);
          }}
          className={cn(CHIP, "font-sans", goalSet && "bg-foreground/[0.06] hover:bg-foreground/[0.1]")}
        >
          Free time <span className="font-mono">{formatMinutes(freeTime)}</span>
        </button>
        {GOAL_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            aria-pressed={goalSet && goal === preset}
            onClick={(event) => {
              if (event.detail > 0) haptic("toggle");
              choose(preset);
            }}
            className={cn(CHIP, !(goalSet && goal === preset) && "bg-foreground/[0.06] hover:bg-foreground/[0.1]")}
          >
            {formatMinutes(preset)}
          </button>
        ))}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = parseEstimateText(typed);
          if (parsed.isErr() || parsed.value > MAX_SPAN) {
            setRefused(true);
            haptic("error");
            return;
          }
          setTyped("");
          setRefused(false);
          choose(parsed.value);
        }}
      >
        <label className="sr-only" htmlFor={typedId}>
          Type a goal
        </label>
        <input
          id={typedId}
          name="goal"
          value={typed}
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="Or type one, like 5:30 or 5h…"
          aria-invalid={refused || undefined}
          aria-describedby={refused ? `${typedId}-hint` : undefined}
          onChange={(event) => {
            setTyped(event.target.value);
            setRefused(false);
          }}
          className={cn(
            "h-8 w-full rounded-md bg-foreground/[0.05] px-2.5 font-mono text-small outline-none placeholder:font-sans placeholder:text-faint-foreground focus-visible:ring-2 focus-visible:ring-ring",
            refused && "ring-2 ring-negative/60",
          )}
        />
        {refused && (
          <p id={`${typedId}-hint`} role="status" className="mt-1 px-1 text-micro text-negative">
            Try a time within a day, such as 5:30, 5h or 330.
          </p>
        )}
      </form>
    </div>
  );
};

export type LoadArea = { key: string; title: string; colour: AreaColour | undefined; minutes: number; guessed: number };

export const LoadBreakdown = ({
  areas,
  planned,
  guessed,
  unestimated,
  goal,
  free,
}: {
  areas: readonly LoadArea[];
  planned: number;
  guessed: number;
  unestimated: number;
  goal: number;
  free: number;
}) => (
  <div className="space-y-1.5 text-small">
    {areas.length === 0 ? (
      <p className="text-muted-foreground">Nothing planned yet.</p>
    ) : (
      <ul className="space-y-1">
        {areas.map((area) => (
          <li key={area.key} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={area.minutes > 0 ? { backgroundColor: meterTint(area.colour) } : { boxShadow: `inset 0 0 0 1.5px ${meterTint(area.colour)}` }}
            />
            <span className="min-w-0 flex-1 truncate">{area.title}</span>
            <span className="font-mono tabular-nums">
              {formatMinutes(area.minutes + area.guessed)}
              {area.guessed > 0 && <span className="text-faint-foreground"> ~</span>}
            </span>
          </li>
        ))}
      </ul>
    )}
    <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 pt-1.5 text-muted-foreground shadow-[0_-1px_0] shadow-foreground/[0.07]">
      <dt>Planned</dt>
      <dd className="text-right font-mono text-foreground">{formatMinutes(planned)}</dd>
      {guessed > 0 && (
        <>
          <dt>Guessed by Smart Estimates</dt>
          <dd className="text-right font-mono">~{formatMinutes(guessed)}</dd>
        </>
      )}
      {unestimated > 0 && (
        <>
          <dt>Not estimated</dt>
          <dd className="text-right font-mono">{unestimated}</dd>
        </>
      )}
      <dt>Goal</dt>
      <dd className="text-right font-mono">{formatMinutes(goal)}</dd>
      <dt>Free</dt>
      <dd className="text-right font-mono">{formatMinutes(Math.max(0, free))}</dd>
    </dl>
  </div>
);
