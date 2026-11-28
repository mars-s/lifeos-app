"use client";

import { Car, Check } from "@phosphor-icons/react";
import { createContext, use, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { areaVar } from "@/components/lifeos/area";
import { cn } from "@/lib/utils";
import {
  capacityOf,
  clock,
  clockRange,
  gapsOf,
  hourLabel,
  loadOf,
  lookOf,
  outerOf,
  span,
  visibleAt,
  WORKING,
  type BlockEntry,
  type Day,
  type Density,
  type Entry,
  type Load,
  type Look,
} from "./model";
import { AREAS } from "./sample";

export const TIMELINE_CSS = `
@property --tl-hatch { syntax: "<length>"; inherits: false; initial-value: 7px; }
@property --tl-ink { syntax: "<color>"; inherits: false; initial-value: transparent; }
@property --tl-edge { syntax: "<color>"; inherits: false; initial-value: transparent; }
.tl-block {
  --tl-hatch: 7px;
  --tl-box: color-mix(in oklab, var(--a) 80%, transparent);
  background-color: var(--tl-ground);
  background-image: repeating-linear-gradient(135deg, var(--tl-ink) 0, var(--tl-ink) var(--tl-hatch), transparent var(--tl-hatch), transparent 7px);
  box-shadow: inset 0 0 0 1px var(--tl-edge);
  transition: --tl-hatch 360ms var(--ease-out), --tl-ink 360ms var(--ease-out), --tl-edge 360ms var(--ease-out), color 360ms var(--ease-out), scale var(--dur-press) var(--ease-out);
}
.tl-block[data-look="predicted"] {
  --tl-hatch: 1px;
  --tl-ink: color-mix(in oklab, var(--a) 46%, transparent);
  --tl-edge: color-mix(in oklab, var(--a) 62%, transparent);
}
.tl-block[data-look="kept"] {
  --tl-ink: color-mix(in oklab, var(--a) 30%, transparent);
  --tl-edge: color-mix(in oklab, var(--a) 26%, transparent);
}
.tl-block[data-look="done"] {
  --tl-ink: color-mix(in oklab, var(--foreground) 9%, transparent);
  color: var(--muted-foreground);
}
.tl-block[data-look="missed"] {
  --tl-ink: color-mix(in oklab, var(--foreground) 3.5%, transparent);
  --tl-edge: color-mix(in oklab, var(--foreground) 34%, transparent);
  --tl-box: color-mix(in oklab, var(--foreground) 48%, transparent);
  color: var(--muted-foreground);
}
.tl-block[data-look^="commitment"] {
  --tl-edge: color-mix(in oklab, var(--foreground) 17%, transparent);
}
.tl-block[data-look="commitment-past"] { color: var(--muted-foreground); }
.tl-block[data-lifted="true"] { box-shadow: inset 0 0 0 1px var(--tl-edge), var(--shadow-float); scale: 1.015; z-index: 5; }
button.tl-block:active { scale: 0.985; }
.tl-rail {
  background-image: radial-gradient(circle at center, var(--tl-dot) 1.75px, transparent 2.25px), radial-gradient(circle at center, var(--tl-dot) 0.9px, transparent 1.4px);
  background-repeat: repeat-y;
}
.tl-now { transition: top 360ms var(--ease-out), height 360ms var(--ease-out); }
@media (prefers-reduced-motion: reduce) {
  .tl-block { transition: --tl-ink 160ms linear, --tl-edge 160ms linear, color 160ms linear; }
  .tl-block[data-lifted="true"], button.tl-block:active { scale: 1; }
  .tl-now { transition: none; }
}
`;

type World = {
  kept: ReadonlySet<string>;
  flipped: ReadonlySet<string>;
  keep: (ids: readonly string[]) => void;
  tick: (id: string) => void;
  reset: () => void;
};

const EMPTY: ReadonlySet<string> = new Set();
const WorldContext = createContext<World>({ kept: EMPTY, flipped: EMPTY, keep: () => undefined, tick: () => undefined, reset: () => undefined });

export const TimelineWorld = ({ children }: { children: ReactNode }) => {
  const [kept, setKept] = useState(EMPTY);
  const [flipped, setFlipped] = useState(EMPTY);
  const world = useMemo(
    () =>
      ({
        kept,
        flipped,
        keep: (ids) => setKept((current) => new Set([...current, ...ids])),
        tick: (id) => setFlipped((current) => new Set(current.has(id) ? [...current].filter((other) => other !== id) : [...current, id])),
        reset: () => {
          setKept(EMPTY);
          setFlipped(EMPTY);
        },
      }) satisfies World,
    [kept, flipped],
  );
  return <WorldContext value={world}>{children}</WorldContext>;
};

export const useWorld = () => use(WorldContext);

export const useEntries = (day: Day) => {
  const { kept, flipped } = useWorld();
  return useMemo(
    () => day.entries.map((entry) => (entry.kind === "block" ? { ...entry, kept: entry.kept || kept.has(entry.id), done: entry.done !== flipped.has(entry.id) } : entry)),
    [day, kept, flipped],
  );
};

export const predictedOf = (entries: readonly Entry[]) => entries.filter((entry) => entry.kind === "block" && !entry.kept);

const Tick = ({ done, small, onToggle, label }: { done: boolean; small: boolean; onToggle?: (() => void) | undefined; label: string }) => {
  const box = (
    <span
      className={cn(
        "grid shrink-0 place-items-center transition-[background-color,box-shadow] duration-(--dur-base) ease-out",
        small ? "size-3 rounded-[4px]" : "size-4 rounded-[5px]",
        done ? "bg-current" : "shadow-[inset_0_0_0_1.5px_var(--tl-box)]",
      )}
    >
      <Check weight="bold" aria-hidden="true" className={cn("text-(--tl-ground) transition-[opacity,scale] duration-(--dur-base) ease-out", small ? "size-2" : "size-2.5", done ? "opacity-100" : "scale-75 opacity-0")} />
    </span>
  );
  if (!onToggle) return box;
  return (
    <button
      type="button"
      aria-pressed={done}
      aria-label={label}
      onClick={onToggle}
      className="relative grid shrink-0 touch-manipulation place-items-center rounded-md outline-none transition-[scale] duration-(--dur-press) ease-out before:absolute before:-inset-2.5 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.86]"
    >
      {box}
    </button>
  );
};

const TripBand = ({ entry, height, back, ruled }: { entry: BlockEntry & { trip: NonNullable<BlockEntry["trip"]> }; height: number; back: boolean; ruled: boolean }) => (
  <div
    className={cn(
      "flex items-center gap-1.5 overflow-hidden px-2.5 text-[0.625rem] leading-none text-current/70",
      ruled && "border-dashed border-current/25 bg-[color-mix(in_oklab,var(--tl-ground)_50%,transparent)]",
      ruled && (back ? "border-t" : "border-b"),
    )}
    style={{ height }}
  >
    {ruled && (
      <>
        <Car weight="fill" aria-hidden="true" className="size-3 shrink-0" />
        <span className="truncate">
          {back ? `${entry.trip.minutes} min back` : `${entry.trip.minutes} min drive, leave by `}
          {!back && <span className="font-mono">{clock(entry.start - entry.trip.minutes)}</span>}
        </span>
      </>
    )}
  </div>
);

const GROUND_LABEL = "rounded-[4px] bg-(--tl-ground) box-decoration-clone px-1";

export const Block = ({
  entry,
  look,
  scale,
  density,
  className,
  style,
  lifted = false,
  children,
}: {
  entry: Entry;
  look: Look;
  scale: number;
  density: Density;
  className?: string;
  style?: CSSProperties;
  lifted?: boolean;
  children?: ReactNode;
}) => {
  const { keep, tick } = useWorld();
  const travel = entry.kind === "block" && entry.trip ? entry.trip.minutes * scale : 0;
  const main = Math.max(entry.minutes * scale - 2, density === "mini" ? 3 : 15);
  const slim = main < 26;
  const tall = main >= 44;
  const isBlock = entry.kind === "block";
  const colour = isBlock ? areaVar(AREAS[entry.area].colour) : areaVar(entry.colour);
  const predicted = look === "predicted";
  const past = look === "done" || look === "missed" || look === "commitment-past";
  const done = isBlock && entry.done;
  const range = clockRange(entry.start, entry.minutes);
  const vars = { "--a": colour, ...style } as CSSProperties;
  const shell = cn("tl-block block w-full overflow-hidden text-left text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring", density === "mini" ? "rounded-[4px]" : slim ? "rounded-md" : "rounded-[0.625rem]", className);

  if (density === "mini") {
    return (
      <div aria-hidden="true" data-look={look} className={cn(shell, "grid place-items-center")} style={{ ...vars, height: main + travel * 2 }}>
        {look === "done" && main >= 12 && <Check weight="bold" className="size-2.5 text-current/70" />}
        {look === "missed" && main >= 12 && <span className="size-2 rounded-[2.5px] shadow-[inset_0_0_0_1.25px_var(--tl-box)]" />}
      </div>
    );
  }

  const compact = density === "week";
  const trip = isBlock && entry.trip ? { ...entry, trip: entry.trip } : undefined;
  const meta = isBlock
    ? `${entry.guess ? "~" : ""}${span(entry.minutes)}${compact ? "" : ` · ${AREAS[entry.area].name}`}`
    : [entry.calendar, compact ? undefined : entry.place].filter(Boolean).join(" · ");
  const body = (
    <>
      {trip && <TripBand entry={trip} height={travel} back={false} ruled={!compact} />}
      <span className={cn("flex gap-2", compact ? "px-1.5" : predicted ? "px-1.5" : "px-2.5", slim ? "items-center" : compact ? "items-start pt-1" : "items-start pt-[0.4375rem]")} style={{ height: main }}>
        {isBlock && !predicted && (
          <span className={cn("flex", !slim && "mt-px")}>
            <Tick done={done} small={compact || slim} onToggle={past && compact ? undefined : () => tick(entry.id)} label={`${done ? "Reopen" : "Complete"} ${entry.title}`} />
          </span>
        )}
        {!isBlock && <span aria-hidden="true" className={cn("shrink-0 rounded-full", compact ? "size-1.5" : "size-2", slim ? "" : compact ? "mt-[0.3125rem]" : "mt-[0.3125rem]", past && "opacity-50")} style={{ backgroundColor: colour }} />}
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate font-medium", compact || slim ? "text-[0.71875rem] leading-4" : "text-[0.8125rem] leading-[1.125rem]", done && "line-through decoration-current/45")}>
            <span className={cn(predicted && GROUND_LABEL)}>{entry.title}</span>
          </span>
          {tall && (
            <span className={cn("mt-0.5 block truncate text-[0.6875rem] leading-4", past ? "text-current/80" : "text-foreground/65")}>
              <span className={cn(predicted && GROUND_LABEL)}>
                {look === "missed" && !compact && "Not done · "}
                <span className="font-mono">{compact ? clock(entry.start) : range}</span>
                {!compact && ` · ${meta}`}
              </span>
            </span>
          )}
        </span>
        {!compact && !tall && (
          <span className={cn("shrink-0 font-mono text-[0.6875rem] leading-[1.125rem]", slim && "leading-4", past ? "text-current/80" : "text-foreground/65")}>
            <span className={cn(predicted && GROUND_LABEL)}>{clock(entry.start)}</span>
          </span>
        )}
        {children}
      </span>
      {trip && <TripBand entry={trip} height={travel} back ruled={!compact} />}
    </>
  );

  if (predicted) {
    return (
      <button type="button" data-look={look} data-lifted={lifted} aria-label={`Keep ${entry.title}, ${range}, predicted`} onClick={() => keep([entry.id])} className={cn(shell, "touch-manipulation")} style={vars}>
        {body}
      </button>
    );
  }
  return (
    <div role="group" aria-label={`${entry.title}, ${range}${isBlock ? (look === "missed" ? ", not done" : done ? ", done" : "") : `, ${entry.calendar} calendar`}`} data-look={look} data-lifted={lifted} className={shell} style={vars}>
      {body}
    </div>
  );
};

const hoursBetween = (from: number, to: number) => Array.from({ length: Math.floor(to / 60) - Math.ceil(from / 60) + 1 }, (_, index) => (Math.ceil(from / 60) + index) * 60);

export const Rail = ({ from, to, scale, now, gutter, compact = false }: { from: number; to: number; scale: number; now: number; gutter: number; compact?: boolean }) => {
  const reached = Math.max(0, Math.min(now, to) - from) * scale;
  const live = now > from && now < to;
  return (
    <div aria-hidden="true" className="absolute inset-y-0 left-0" style={{ width: gutter }}>
      {hoursBetween(from, to).map((minute) => (
        <span
          key={minute}
          className={cn("absolute right-[1.125rem] -translate-y-1/2 font-mono whitespace-nowrap text-faint-foreground", compact ? "text-[0.5625rem]" : "text-[0.625rem]", live && Math.abs(minute - now) * scale < 13 && "opacity-0")}
          style={{ top: (minute - from) * scale }}
        >
          {hourLabel(minute)}
        </span>
      ))}
      <span
        className="tl-rail absolute inset-y-0 right-[0.3125rem] w-[5px] [--tl-dot:color-mix(in_oklab,var(--foreground)_38%,transparent)]"
        style={{ backgroundSize: `5px ${60 * scale}px, 5px ${15 * scale}px`, backgroundPosition: `0 ${-30 * scale - (from % 60) * scale}px, 0 ${-7.5 * scale - (from % 15) * scale}px` }}
      />
      <span className="tl-now absolute top-0 right-[0.4375rem] w-px rounded-full bg-foreground/55" style={{ height: reached }} />
      {live && (
        <>
          <span className="tl-now absolute right-[0.1875rem] size-[9px] -translate-y-1/2 rounded-full bg-brand shadow-[0_0_0_2px_var(--tl-ground)]" style={{ top: reached }} />
          <span className={cn("tl-now absolute right-[1rem] -translate-y-1/2 rounded-full bg-brand px-1.5 font-mono font-medium text-brand-foreground", compact ? "text-[0.5625rem] leading-[0.875rem]" : "text-[0.625rem] leading-4")} style={{ top: reached }}>
            {clock(now, true)}
          </span>
        </>
      )}
    </div>
  );
};

export const NowLine = ({ from, scale, now }: { from: number; scale: number; now: number }) => (
  <span aria-hidden="true" className="tl-now pointer-events-none absolute inset-x-0 z-[4] h-px bg-brand" style={{ top: (now - from) * scale }} />
);

export const DayTrack = ({
  entries,
  from,
  to,
  scale,
  density,
  now,
  className,
  children,
}: {
  entries: readonly Entry[];
  from: number;
  to: number;
  scale: number;
  density: Density;
  now: number;
  className?: string;
  children?: ReactNode;
}) => {
  const shown = entries.filter((entry) => visibleAt(entry, now) && outerOf(entry).end > from && outerOf(entry).start < to);
  const gaps = density === "full" ? gapsOf(shown, Math.max(from, now), WORKING.end) : [];
  return (
    <div className={cn("relative", className)} style={{ height: (to - from) * scale }}>
      {density !== "mini" &&
        hoursBetween(from, to).map((minute) => <span key={minute} aria-hidden="true" className="absolute inset-x-0 border-t border-dotted border-foreground/[0.09]" style={{ top: (minute - from) * scale }} />)}
      {gaps.map((gap) => (
        <span
          key={gap.start}
          className="absolute left-2.5 flex -translate-y-1/2 items-center gap-1.5 text-[0.625rem] leading-none text-faint-foreground"
          style={{ top: (gap.start + gap.minutes / 2 - from) * scale }}
        >
          {gap.minutes < 30 ? "Buffer" : "Free"} <span className="font-mono">{span(gap.minutes)}</span>
        </span>
      ))}
      {shown.map((entry) => {
        const outer = outerOf(entry);
        return (
          <Block
            key={entry.id}
            entry={entry}
            look={lookOf(entry, now)}
            scale={scale}
            density={density}
            className="absolute inset-x-0"
            style={{ top: (outer.start - from) * scale + 1 }}
          />
        );
      })}
      {children}
    </div>
  );
};

export const DayTimeline = ({
  day,
  from,
  to,
  scale,
  gutter,
  now,
  className,
}: {
  day: Day;
  from: number;
  to: number;
  scale: number;
  gutter: number;
  now: number;
  className?: string;
}) => {
  const entries = useEntries(day);
  return (
    <div className={cn("relative", className)} style={{ paddingLeft: gutter }}>
      <Rail from={from} to={to} scale={scale} now={now} gutter={gutter} />
      <DayTrack entries={entries} from={from} to={to} scale={scale} density="full" now={now}>
        {now > from && now < to && <NowLine from={from} scale={scale} now={now} />}
      </DayTrack>
    </div>
  );
};

const dotKinds = (load: Load, capacity: number, unit: number) => {
  const total = Math.max(1, Math.round(capacity / unit));
  const done = Math.round(load.done / unit);
  const kept = Math.round((load.done + load.kept) / unit) - done;
  const predicted = Math.round((load.done + load.kept + load.predicted) / unit) - done - kept;
  return Array.from({ length: Math.max(total, done + kept + predicted) }, (_, index) =>
    index >= total ? "over" : index < done ? "done" : index < done + kept ? "kept" : index < done + kept + predicted ? "predicted" : "free",
  );
};

const DOT_CLASS = {
  done: "bg-foreground/35",
  kept: "bg-foreground",
  predicted: "shadow-[inset_0_0_0_1px_var(--foreground)]",
  free: "bg-foreground/[0.13]",
  over: "shadow-[inset_0_0_0_1px_var(--negative)]",
} as const;

export const LoadDots = ({ load, capacity, unit, dot = 4, className }: { load: Load; capacity: number; unit: number; dot?: number; className?: string }) => (
  <span aria-hidden="true" className={cn("flex flex-wrap gap-[2px] overflow-hidden", className)}>
    {dotKinds(load, capacity, unit).map((kind, index) => (
      <span key={index} className={cn("rounded-full", DOT_CLASS[kind])} style={{ width: dot, height: dot }} />
    ))}
  </span>
);

export const CapacityRing = ({ load, capacity, size = 46 }: { load: Load; capacity: number; size?: number }) => {
  const kinds = dotKinds(load, capacity, 15).filter((kind) => kind !== "over");
  const left = capacity - load.done - load.kept - load.predicted;
  const radius = size / 2 - 2.5;
  return (
    <span role="img" aria-label={`Capacity: ${span(Math.abs(left))} ${left < 0 ? "over" : "left"} of ${span(capacity)}`} className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 text-foreground" aria-hidden="true">
        {kinds.map((kind, index) => {
          const angle = (index / kinds.length) * Math.PI * 2 - Math.PI / 2;
          const position = { cx: (size / 2 + Math.cos(angle) * radius).toFixed(2), cy: (size / 2 + Math.sin(angle) * radius).toFixed(2) };
          return kind === "predicted" ? (
            <circle key={index} {...position} r={1.25} fill="none" stroke="currentColor" strokeWidth={0.8} />
          ) : (
            <circle key={index} {...position} r={1.6} fill="currentColor" opacity={kind === "kept" ? 1 : kind === "done" ? 0.4 : 0.13} />
          );
        })}
      </svg>
      <span className={cn("font-mono text-[0.6875rem] leading-none font-medium", left < 0 && "text-negative")}>{span(Math.abs(left))}</span>
    </span>
  );
};

export const useDayFacts = (day: Day) => {
  const entries = useEntries(day);
  return { entries, load: loadOf(entries), capacity: capacityOf(day), predicted: predictedOf(entries) };
};

export const HatchSwatch = ({ className }: { className?: string }) => (
  <span aria-hidden="true" data-look="predicted" className={cn("tl-block inline-block size-3 shrink-0 rounded-[3px]", className)} style={{ "--a": "var(--foreground)" } as CSSProperties} />
);
