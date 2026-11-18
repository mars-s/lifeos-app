"use client";

import { Check, Coffee, Pause, Play, SkipForward, Stop, Trash, type Icon } from "@phosphor-icons/react";
import { useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { parseEstimateText } from "@lifeos/backend/estimate";
import { MorphText } from "@/components/ui/morph-text";
import { Popover, PopoverClose } from "@/components/ui/popover-panel";
import { RollingNumber } from "@/components/ui/rolling-number";
import { Segmented } from "@/components/ui/segmented-control";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { formatCountdown, formatMinutes, round } from "./format";

const RING_DOTS = 24;
const SWEEP_STEP_MS = 22;

export const DotRing = ({
  remaining,
  size = 30,
  dot = 1.6,
  litClassName = "fill-brand",
  fills = false,
  sweep = false,
  className,
}: {
  litClassName?: string;
  remaining: number;
  size?: number;
  dot?: number;
  fills?: boolean;
  sweep?: boolean;
  className?: string;
}) => {
  const lit = Math.ceil(Math.min(1, Math.max(0, remaining)) * RING_DOTS);
  const radius = size / 2 - dot - 0.5;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className={cn("shrink-0", className)} style={{ width: size, height: size }}>
      {Array.from({ length: RING_DOTS }, (_, index) => {
        const angle = (index / RING_DOTS) * Math.PI * 2 - Math.PI / 2;
        const on = fills ? index < lit : index >= RING_DOTS - lit;
        return (
          <circle
            key={index}
            cx={round(size / 2 + Math.cos(angle) * radius)}
            cy={round(size / 2 + Math.sin(angle) * radius)}
            r={dot}
            style={sweep ? { transitionDelay: `${index * SWEEP_STEP_MS}ms` } : undefined}
            className={cn(
              "transition-[fill,opacity] duration-(--dur-slow) ease-out motion-reduce:delay-0",
              on ? litClassName : "fill-current opacity-20",
            )}
          />
        );
      })}
    </svg>
  );
};

export type FocusPillView = {
  title: string;
  phase: "focus" | "break";
  status: "running" | "paused" | "done";
  seconds: number;
  ring: number;
  timed: boolean;
};

type PillAction = "pause" | "resume" | "advance";

const primaryFor: (view: FocusPillView) => { label: string; icon: Icon; action: PillAction } = (view) => {
  if (view.status === "paused") return { label: "Resume", icon: Play, action: "resume" };
  if (view.status === "done") return view.phase === "focus" ? { label: "Break", icon: Coffee, action: "advance" } : { label: "Focus", icon: Play, action: "advance" };
  return view.phase === "break" ? { label: "Skip", icon: SkipForward, action: "advance" } : { label: "Pause", icon: Pause, action: "pause" };
};

const PRIMARY_NAMES = {
  Pause: "Pause the Focus Session",
  Resume: "Resume the Focus Session",
  Break: "Start the break",
  Focus: "Start the next Focus Session",
  Skip: "Skip the break",
} as const satisfies Record<string, string>;

const labelFor = (view: FocusPillView) => {
  if (view.status === "done") return view.phase === "focus" ? "Session complete" : "Break over";
  return view.phase === "break" ? "Break" : view.title;
};

export const PillButton = ({ label, className, ...props }: React.ComponentProps<"button"> & { label: string }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    className={cn(
      "grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground max-md:size-10 transition-[background-color,color,scale] duration-(--dur-press) ease-out hover:bg-foreground/[0.07] hover:text-foreground active:scale-[0.92] aria-expanded:bg-foreground/[0.07] aria-expanded:text-foreground",
      className,
    )}
    {...props}
  />
);

export const FocusTimerPill = ({
  view,
  celebrate = false,
  onPause,
  onResume,
  onAdvance,
  onStop,
  onExtend,
  more,
  className,
}: {
  view: FocusPillView;
  celebrate?: boolean;
  onPause: () => void;
  onResume: () => void;
  onAdvance?: () => void;
  onStop?: () => void;
  onExtend?: () => void;
  more?: ReactNode;
  className?: string;
}) => {
  const primary = primaryFor(view);
  const done = view.status === "done";
  const run = { pause: onPause, resume: onResume, advance: onAdvance } satisfies Record<PillAction, (() => void) | undefined>;
  const PrimaryIcon = primary.icon;
  const StopIcon = done ? Check : Stop;
  return (
    <div
      role="timer"
      aria-label={view.phase === "break" ? `Break from ${view.title}` : `Focus Session on ${view.title}`}
      data-focus-pill={view.status}
      data-phase={view.phase}
      className={cn(
        "inline-flex h-12 max-w-full items-center gap-1 rounded-full bg-popover pr-1.5 pl-3 shadow-float",
        celebrate && "animate-focus-done motion-reduce:animate-none",
        className,
      )}
    >
      <span className="relative mr-1.5 grid shrink-0 place-items-center">
        {celebrate && (
          <span aria-hidden="true" className="absolute inset-0 animate-focus-bloom rounded-full bg-positive motion-reduce:hidden" />
        )}
        <DotRing
          remaining={done ? 1 : view.ring}
          fills={!view.timed && !done}
          sweep={celebrate}
          litClassName={done || view.phase === "break" ? "fill-positive" : "fill-brand"}
          className={cn("relative transition-opacity duration-(--dur-fast) ease-out", view.status === "paused" && "opacity-50")}
        />
      </span>
      <span role="status" className="sr-only">
        {done ? labelFor(view) : ""}
      </span>
      <MorphText
        className={cn(
          "mr-1.5 min-w-0 truncate text-small transition-colors duration-(--dur-fast) ease-out",
          done ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {labelFor(view)}
      </MorphText>
      <RollingNumber
        value={formatCountdown(Math.max(0, view.seconds))}
        stagger={0}
        className={cn(
          "mr-1 font-mono font-medium transition-colors duration-(--dur-fast) ease-out",
          view.status === "paused" && "text-muted-foreground",
        )}
      />
      {done && view.phase === "focus" && onExtend && (
        <PillButton
          label="Add 5 Minutes"
          onClick={() => {
            haptic("toggle");
            onExtend();
          }}
          className="font-mono text-small font-medium"
        >
          +5
        </PillButton>
      )}
      {onStop && (
        <PillButton
          label={done ? "Finish" : view.phase === "break" ? "End the break" : "Stop the Focus Session"}
          onClick={() => {
            haptic("toggle");
            onStop();
          }}
        >
          <StopIcon weight={done ? "bold" : "fill"} className="size-4" aria-hidden="true" />
        </PillButton>
      )}
      {more && <span className={cn("contents", done && "max-sm:hidden")}>{more}</span>}
      <button
        type="button"
        aria-label={PRIMARY_NAMES[primary.label as keyof typeof PRIMARY_NAMES]}
        disabled={!run[primary.action]}
        onClick={() => {
          haptic("toggle");
          run[primary.action]?.();
        }}
        className="ml-0.5 flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-foreground pr-3.5 pl-3 text-small font-medium text-background transition-[scale,opacity] duration-(--dur-press) ease-out active:scale-[0.96] disabled:opacity-40 max-sm:size-10 max-sm:justify-center max-sm:p-0"
      >
        <PrimaryIcon weight="fill" className="size-3.5" aria-hidden="true" />
        <span className="max-sm:hidden">
          <MorphText>{primary.label}</MorphText>
        </span>
      </button>
    </div>
  );
};

export type FocusPlanChoice = { mode: "open" | "pomodoro"; focusMinutes: number; breakMinutes: number };

const FOCUS_LENGTHS = [15, 25, 45, 50, 90] as const;
const BREAK_LENGTHS = [5, 10, 15] as const;

const LengthChips = ({
  label,
  lengths,
  value,
  onChange,
}: {
  label: string;
  lengths: readonly number[];
  value: number;
  onChange: (minutes: number) => void;
}) => (
  <div role="group" aria-label={`${label} length`} className="flex items-center gap-1">
    <span className="w-12 text-small text-muted-foreground">{label}</span>
    {lengths.map((minutes) => {
      const selected = minutes === value;
      return (
        <button
          key={minutes}
          type="button"
          aria-pressed={selected}
          onClick={(event) => {
            if (event.detail > 0) haptic("toggle");
            onChange(minutes);
          }}
          className={cn(
            "relative h-7 min-w-9 rounded-md px-2 font-mono text-small transition-[background-color,color,scale] duration-(--dur-press) ease-out before:absolute before:-inset-x-0.5 before:-inset-y-1.5 active:scale-[0.94]",
            selected ? "bg-brand text-brand-foreground" : "bg-foreground/[0.06] text-foreground/80 hover:bg-foreground/[0.1]",
          )}
        >
          {minutes}
        </button>
      );
    })}
  </div>
);

export const FocusPlanPanel = ({ plan, onChange }: { plan: FocusPlanChoice; onChange: (plan: FocusPlanChoice) => void }) => (
  <div className="space-y-3">
    <Segmented
      label="Focus mode"
      value={plan.mode}
      onValueChange={(mode) => onChange({ ...plan, mode })}
      className="w-full [&>button]:flex-1"
      options={[
        { value: "open", label: "Stopwatch" },
        { value: "pomodoro", label: "Pomodoro" },
      ]}
    />
    {plan.mode === "pomodoro" ? (
      <div className="space-y-1.5">
        <LengthChips label="Focus" lengths={FOCUS_LENGTHS} value={plan.focusMinutes} onChange={(focusMinutes) => onChange({ ...plan, focusMinutes })} />
        <LengthChips label="Break" lengths={BREAK_LENGTHS} value={plan.breakMinutes} onChange={(breakMinutes) => onChange({ ...plan, breakMinutes })} />
        <p className="pt-1 text-small text-muted-foreground">Minutes of focus, then a break. Only the focus counts as Actual Time.</p>
      </div>
    ) : (
      <p className="text-small text-muted-foreground">Counts up until you stop. Every minute counts as Actual Time.</p>
    )}
  </div>
);

const METER_UNITS = [15, 30, 60, 120, 240, 480, 1440];

const METER_SIZES = {
  sm: { max: 6, dot: "size-1", gap: "gap-0.5" },
  md: { max: 16, dot: "size-2", gap: "gap-[5px]" },
} as const;

export const ActualMeter = ({
  actual,
  estimate,
  colour = "var(--brand)",
  size = "md",
  className,
}: {
  actual: number;
  estimate?: number;
  colour?: string;
  size?: keyof typeof METER_SIZES;
  className?: string;
}) => {
  const { max, dot, gap } = METER_SIZES[size];
  const span = Math.max(actual, estimate ?? 0, 1);
  const unit = METER_UNITS.find((minutes) => Math.ceil(span / minutes) <= max) ?? 1440;
  const planned = estimate === undefined ? 0 : Math.max(1, Math.round(estimate / unit));
  const filled = actual <= 0 ? 0 : Math.max(1, Math.round(actual / unit));
  const dots = Math.min(max, Math.max(planned, filled));
  return (
    <span
      role="meter"
      aria-label="Actual Time"
      aria-valuemin={0}
      aria-valuemax={estimate ?? actual}
      aria-valuenow={actual}
      aria-valuetext={
        estimate === undefined ? `${formatMinutes(actual)} of focus` : `${formatMinutes(actual)} of focus against an Estimate of ${formatMinutes(estimate)}`
      }
      title={`One dot is ${unit < 60 ? `${unit} minutes` : unit === 60 ? "an hour" : `${unit / 60} hours`}`}
      className={cn("inline-flex shrink-0 items-center", gap, className)}
    >
      {Array.from({ length: dots }, (_, index) => {
        const on = index < filled;
        const over = on && estimate !== undefined && index >= planned;
        return (
          <span
            key={index}
            className={cn("rounded-full transition-[background-color] duration-(--dur-base) ease-out", dot, !on && "bg-foreground/[0.14]")}
            style={on ? { backgroundColor: over ? "var(--negative)" : colour } : undefined}
          />
        );
      })}
    </span>
  );
};

export type FocusHistoryEntry = { id: string; at: string; range: string; minutes: number };

const HistoryChip = ({
  entry,
  onEdit,
  onRemove,
}: {
  entry: FocusHistoryEntry;
  onEdit: (minutes: number) => void;
  onRemove: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  const commit = () => {
    if (draft === null) return true;
    const parsed = parseEstimateText(draft.trim());
    if (parsed.isErr()) {
      setRefused(true);
      haptic("error");
      return false;
    }
    setDraft(null);
    if (parsed.value !== entry.minutes) onEdit(parsed.value);
    return true;
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) commit();
        setDraft(null);
        setRefused(false);
        setOpen(next);
      }}
      side="top"
      align="start"
      title="Focus Session"
      className="w-64"
      trigger={
        <button
          type="button"
          aria-label={`Focus Session at ${entry.at}, ${formatMinutes(entry.minutes)}. Edit`}
          className="relative inline-flex h-7 items-center gap-1.5 rounded-md bg-foreground/[0.06] px-2 text-small transition-[background-color,scale] duration-(--dur-press) ease-out before:absolute before:-inset-y-1.5 before:inset-x-0 hover:bg-foreground/[0.1] active:scale-[0.96] aria-expanded:bg-foreground/[0.1]"
        >
          <span className="text-muted-foreground">{entry.at}</span>
          <span className="font-mono">{formatMinutes(entry.minutes)}</span>
        </button>
      }
    >
      <div className="space-y-3 px-1 pb-1">
        <p className="text-small text-muted-foreground">{entry.range}</p>
        <label className="flex items-center gap-2 text-small">
          <span className="w-12 text-muted-foreground">Length</span>
          <input
            aria-invalid={refused}
            name="focus-length"
            inputMode="text"
            enterKeyHint="done"
            autoComplete="off"
            spellCheck={false}
            value={draft ?? formatMinutes(entry.minutes)}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => {
              setDraft(event.target.value);
              setRefused(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && commit()) setOpen(false);
            }}
            className={cn(
              "h-7 w-20 rounded-md bg-foreground/[0.06] px-2 text-center font-mono text-small outline-offset-2 transition-[background-color] duration-(--dur-press) ease-out hover:bg-foreground/[0.1]",
              refused && "animate-refuse text-negative",
            )}
          />
          <span role="status" className={cn("text-micro text-negative", !refused && "sr-only")}>
            {refused ? "Try 45 or 1:30" : ""}
          </span>
        </label>
        <PopoverClose asChild>
          <button
            type="button"
            onClick={onRemove}
            className="-mx-1 flex h-8 w-[calc(100%+0.5rem)] items-center gap-2.5 rounded-lg px-2 text-left text-small text-negative transition-[background-color] duration-(--dur-press) ease-out hover:bg-negative/10"
          >
            <Trash className="size-4" aria-hidden="true" />
            Remove Session
          </button>
        </PopoverClose>
      </div>
    </Popover>
  );
};

export const FocusHistory = ({
  entries,
  earlier,
  empty,
  onEdit,
  onRemove,
  className,
}: {
  entries: FocusHistoryEntry[];
  earlier: number;
  empty: string;
  onEdit: (id: string, minutes: number) => void;
  onRemove: (id: string) => void;
  className?: string;
}) => (
  <div className={cn("flex flex-wrap items-center gap-1 @md:gap-1.5", className)}>
    <span className="hidden w-[3.75rem] text-small text-muted-foreground @md:inline">Today</span>
    <ul aria-label="Focus Sessions today" className="contents">
      {entries.map((entry) => (
        <li key={entry.id} className="contents">
          <HistoryChip entry={entry} onEdit={(minutes) => onEdit(entry.id, minutes)} onRemove={() => onRemove(entry.id)} />
        </li>
      ))}
    </ul>
    {entries.length === 0 && <span className="text-small text-faint-foreground">{empty}</span>}
    {earlier > 0 && (
      <span className="ml-1 text-small text-faint-foreground">
        <span className="font-mono">{earlier}</span> earlier
      </span>
    )}
  </div>
);

export const useFocusSession = (totalSeconds: number, startAt: number) => {
  const [remainingSeconds, setRemainingSeconds] = useState(startAt);
  const [running, setRunning] = useState(true);
  const [celebrate, setCelebrate] = useState(false);
  const done = remainingSeconds <= 0;
  const tick = useEffectEvent(() => {
    if (remainingSeconds === 1) {
      setCelebrate(true);
      haptic("complete");
    }
    setRemainingSeconds((current) => Math.max(0, current - 1));
  });
  useEffect(() => {
    if (!running || done) return;
    const timer = setInterval(() => tick(), 1000);
    return () => clearInterval(timer);
  }, [running, done]);
  const restart = () => {
    setRemainingSeconds(totalSeconds);
    setRunning(true);
    setCelebrate(false);
  };
  return {
    totalSeconds,
    remainingSeconds,
    skip: (seconds: number) => setRemainingSeconds((current) => Math.max(1, current - seconds)),
    restart,
    pill: {
      view: {
        title: "Draft the thesis outline",
        phase: "focus",
        status: done ? "done" : running ? "running" : "paused",
        seconds: remainingSeconds,
        ring: remainingSeconds / totalSeconds,
        timed: true,
      } satisfies FocusPillView,
      celebrate,
      onPause: () => setRunning(false),
      onResume: () => setRunning(true),
      onAdvance: restart,
      onStop: restart,
      onExtend: () => {
        setRemainingSeconds(5 * 60);
        setCelebrate(false);
      },
    },
  };
};
