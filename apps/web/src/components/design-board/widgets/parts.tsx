"use client";

import { Check, type Icon } from "@phosphor-icons/react";
import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { areaVar, type AreaColour } from "@/components/lifeos/area";
import { formatMinutes, round } from "@/components/lifeos/format";
import { cn } from "@/lib/utils";
import { ThemeContext, type Theme } from "../theme";
import { dotsOf, GLYPH_ROWS, SIZES, type Day, type Mode, type Size, type Slice, type Span } from "./model";

export const ModeContext = createContext<Mode>("colour");
export const useMode = () => useContext(ModeContext);

const single = (ink: string, onInk: string) =>
  ({
    "--w-ink": ink,
    "--w-dim": `color-mix(in oklab, ${ink} 68%, transparent)`,
    "--w-faint": `color-mix(in oklab, ${ink} 44%, transparent)`,
    "--w-track": `color-mix(in oklab, ${ink} 17%, transparent)`,
    "--w-alert": ink,
    "--w-deadline": ink,
    "--w-on-ink": onInk,
  }) as CSSProperties;

export const MODE_VARS: Record<Mode, CSSProperties> = {
  colour: {
    "--w-ink": "var(--foreground)",
    "--w-dim": "var(--muted-foreground)",
    "--w-faint": "var(--faint-foreground)",
    "--w-track": "color-mix(in oklab, var(--foreground) 12%, transparent)",
    "--w-alert": "var(--negative)",
    "--w-deadline": "var(--deadline)",
    "--w-on-ink": "var(--surface-inset)",
  } as CSSProperties,
  tinted: single("oklch(0.9 0.045 82)", "oklch(0.2 0.01 82)"),
  clear: single("oklch(0.985 0 0)", "oklch(0.25 0 0)"),
  vibrant: single("oklch(0.985 0 0)", "oklch(0.25 0 0)"),
  desktop: single("light-dark(oklch(0.34 0.008 70), oklch(0.86 0.004 264))", "light-dark(oklch(0.97 0 0), oklch(0.2 0 0))"),
  standby: single("oklch(0.97 0 0)", "oklch(0 0 0)"),
  night: single("oklch(0.6 0.2 27)", "oklch(0 0 0)"),
};

const SOLID = "[@media(prefers-reduced-transparency:reduce)]:backdrop-blur-none";

const SURFACE: Record<Mode, string> = {
  colour:
    "bg-[light-dark(oklch(0.992_0.004_85),oklch(0.215_0.005_264))] shadow-[0_1px_1px_rgb(0_0_0/0.05),0_14px_30px_-16px_rgb(0_0_0/0.4),inset_0_0_0_0.5px_light-dark(rgb(255_255_255/0.6),rgb(255_255_255/0.09))]",
  tinted: cn("bg-[rgb(16_16_18/0.6)] shadow-[inset_0_0_0_0.5px_rgb(255_255_255/0.1)] backdrop-blur-2xl [@media(prefers-reduced-transparency:reduce)]:bg-[rgb(16_16_18)]", SOLID),
  clear: cn(
    "bg-[rgb(255_255_255/0.1)] shadow-[inset_0_1px_0_rgb(255_255_255/0.38),inset_0_0_0_0.5px_rgb(255_255_255/0.2),0_10px_30px_-18px_rgb(0_0_0/0.5)] backdrop-blur-xl backdrop-saturate-150 [@media(prefers-reduced-transparency:reduce)]:bg-[rgb(70_70_74)]",
    SOLID,
  ),
  vibrant: "",
  desktop: cn(
    "bg-[light-dark(rgb(255_255_255/0.3),rgb(30_30_32/0.34))] shadow-[inset_0_0_0_0.5px_light-dark(rgb(255_255_255/0.4),rgb(255_255_255/0.08))] backdrop-blur-2xl [@media(prefers-reduced-transparency:reduce)]:bg-surface",
    SOLID,
  ),
  standby: "",
  night: "",
};

export const Tile = ({ size, label, children, className }: { size: Size; label: string; children: ReactNode; className?: string }) => {
  const mode = useMode();
  return (
    <div
      role="group"
      aria-label={label}
      data-mode={mode}
      className={cn(
        "relative shrink-0 overflow-hidden rounded-[1.625rem] p-3.5 text-left text-(--w-ink) transition-[background-color,color] duration-(--dur-base) ease-out",
        SURFACE[mode],
        className,
      )}
      style={{ ...SIZES[size], ...MODE_VARS[mode] }}
    >
      {children}
    </div>
  );
};

export const useAreaInk = () => {
  const mode = useMode();
  return (colour: AreaColour | undefined) => (mode === "colour" && colour ? areaVar(colour) : "var(--w-ink)");
};

export const DotNumber = ({ value, pitch = 5.5, label, className }: { value: string; pitch?: number; label?: string; className?: string }) => {
  const { dots, columns } = dotsOf(value);
  const radius = pitch * 0.37;
  const width = round((columns - 1) * pitch + radius * 2);
  const height = round((GLYPH_ROWS - 1) * pitch + radius * 2);
  return (
    <svg role="img" aria-label={label ?? value} width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn("shrink-0 fill-current", className)}>
      {dots.map((dot) => (
        <circle key={`${dot.x}-${dot.y}`} cx={round(dot.x * pitch + radius)} cy={round(dot.y * pitch + radius)} r={round(radius)} />
      ))}
    </svg>
  );
};

export const Heading = ({ title, state, className }: { title: string; state: string; className?: string }) => (
  <div className={cn("min-w-0", className)}>
    <p className="truncate text-[0.9375rem] leading-5 font-medium tracking-[-0.01em]">{title}</p>
    <p className="truncate text-micro text-(--w-dim)">{state}</p>
  </div>
);

export const UnitBadge = ({ icon: IconComponent, unit }: { icon: Icon; unit: string }) => (
  <span className="flex w-[1.625rem] shrink-0 flex-col items-center gap-px rounded-lg bg-(--w-track) pt-1 pb-0.5 text-[0.625rem] leading-3 font-medium">
    <IconComponent weight="fill" className="size-3" aria-hidden="true" />
    {unit}
  </span>
);

export const Figure = ({ value, label, icon, unit, pitch }: { value: string; label: string; icon: Icon; unit: string; pitch?: number }) => (
  <div className="flex items-center justify-between gap-2">
    <DotNumber value={value} label={label} pitch={pitch} />
    <UnitBadge icon={icon} unit={unit} />
  </div>
);

export const Axis = ({ left, right }: { left: string; right: string }) => (
  <div className="mt-1 flex justify-between gap-2 font-mono text-[0.625rem] leading-3 [word-spacing:-0.3em] whitespace-nowrap text-(--w-dim)">
    <span>{left}</span>
    <span>{right}</span>
  </div>
);

export const DayStrip = ({ start, end, now, spans, step = 30 }: { start: number; end: number; now?: number; spans: readonly Span[]; step?: number }) => {
  const ink = useAreaInk();
  const share = (minutes: number) => `${round((minutes / (end - start)) * 100)}%`;
  const shown = spans.flatMap((span) => (span.end <= start || span.start >= end ? [] : [{ ...span, start: Math.max(start, span.start), end: Math.min(end, span.end) }]));
  const first = Math.ceil(start / step) * step;
  const ticks = Array.from({ length: Math.floor((end - first) / step) + 1 }, (_, index) => first + index * step).filter(
    (minute) => !shown.some((span) => minute >= span.start && minute <= span.end),
  );
  return (
    <div aria-hidden="true" className="relative h-3">
      {ticks.map((minute) => (
        <span
          key={minute}
          className="absolute bottom-0 w-px -translate-x-1/2 rounded-full bg-(--w-faint)"
          style={{ left: share(minute - start), height: minute % 60 === 0 ? 8 : 5, opacity: now !== undefined && minute < now ? 0.45 : 1 }}
        />
      ))}
      {shown.map((span) => (
        <span
          key={span.id}
          className={cn("absolute rounded-[2px]", span.kind === "trip" ? "bottom-0.5 h-0.5" : "bottom-0 h-1.5")}
          style={{
            left: share(span.start - start),
            width: share(span.end - span.start),
            opacity: now !== undefined && span.end <= now ? 0.4 : 1,
            ...(span.kind === "block"
              ? { backgroundColor: ink(span.colour) }
              : span.kind === "commitment"
                ? { boxShadow: "inset 0 0 0 1px var(--w-dim)" }
                : { backgroundImage: "repeating-linear-gradient(90deg, var(--w-dim) 0 2px, transparent 2px 4px)" }),
          }}
        />
      ))}
      {now !== undefined && now >= start && now <= end && (
        <span className="absolute -top-0.5 bottom-0 w-[1.5px] -translate-x-1/2 rounded-full bg-(--w-ink)" style={{ left: share(now - start) }} />
      )}
    </div>
  );
};

const QUARTER = 15;

export const CapacityDots = ({ slices, capacity, dot = 5, className }: { slices: readonly Slice[]; capacity: number; dot?: number; className?: string }) => {
  const ink = useAreaInk();
  const planned = slices.reduce((sum, slice) => sum + slice.minutes, 0);
  const filled = slices.flatMap((slice) => Array.from({ length: Math.round(slice.minutes / QUARTER) }, () => slice.colour));
  const free = Math.round(capacity / QUARTER);
  const cells = Array.from({ length: Math.max(free, filled.length) }, (_, index) => ({ index, colour: filled[index], over: index >= free }));
  const hours = Array.from({ length: Math.ceil(cells.length / 4) }, (_, hour) => cells.slice(hour * 4, hour * 4 + 4));
  return (
    <div role="img" aria-label={`${formatMinutes(planned)} planned of ${formatMinutes(capacity)} free`} className={cn("flex", className)} style={{ gap: dot * 1.2 }}>
      {hours.map((hour) => (
        <span key={hour[0]?.index} className="flex" style={{ gap: dot * 0.5 }}>
          {hour.map((cell) => (
            <span
              key={cell.index}
              className="shrink-0 rounded-full"
              style={{
                width: dot,
                height: dot,
                ...(cell.over
                  ? { boxShadow: "inset 0 0 0 1.25px var(--w-alert)" }
                  : { backgroundColor: cell.colour ? ink(cell.colour) : "var(--w-track)" }),
              }}
            />
          ))}
        </span>
      ))}
    </div>
  );
};

export const WeekColumns = ({
  days,
  perRow = 1,
  dot = 6,
  gap = 3,
  detail = false,
  className,
}: {
  days: readonly Day[];
  perRow?: number;
  dot?: number;
  gap?: number;
  detail?: boolean;
  className?: string;
}) => {
  const ink = useAreaInk();
  const unit = 60 / perRow;
  return (
    <div className={cn("flex items-end justify-between", className)}>
      {days.map((day) => {
        const filled = day.slices.flatMap((slice) => Array.from({ length: Math.round(slice.minutes / unit) }, () => slice.colour));
        const planned = day.slices.reduce((sum, slice) => sum + slice.minutes, 0);
        const cells = Array.from({ length: Math.max(filled.length, Math.round(day.capacity / unit)) }, (_, index) => filled[index]);
        const name = `${day.weekday} ${day.date}`;
        return (
          <div
            key={day.id}
            role="img"
            aria-label={`${name}, ${formatMinutes(planned)} planned of ${formatMinutes(day.capacity)} free${day.deadline ? ", a Deadline" : ""}`}
            className="flex flex-col items-center"
          >
            <span className="grid h-3 place-items-center">
              {day.deadline && <span className="size-[5px] rotate-45 rounded-[1px] bg-(--w-deadline)" />}
            </span>
            <span className="flex flex-wrap-reverse content-start" style={{ width: perRow * dot + (perRow - 1) * gap, gap }}>
              {cells.length === 0 && <span className="rounded-full bg-(--w-track)" style={{ width: perRow * dot + (perRow - 1) * gap, height: 1.5 }} />}
              {cells.map((colour, index) => (
                <span key={index} className="shrink-0 rounded-full" style={{ width: dot, height: dot, backgroundColor: colour ? ink(colour) : "var(--w-track)" }} />
              ))}
            </span>
            {detail ? (
              <span className="mt-2 flex flex-col items-center">
                <span className={cn("text-micro", day.today ? "font-medium text-(--w-ink)" : "text-(--w-dim)")}>{day.weekday}</span>
                <span className="font-mono text-[0.625rem] leading-3 text-(--w-dim)">{planned > 0 ? formatMinutes(planned) : "free"}</span>
              </span>
            ) : (
              <span className={cn("mt-1.5 font-mono text-[0.625rem] leading-3", day.today ? "font-semibold text-(--w-ink)" : "text-(--w-dim)")}>{day.letter}</span>
            )}
          </div>
        );
      })}
    </div>
  );
};

export const FocusStrip = ({ total, elapsed, className }: { total: number; elapsed: number; className?: string }) => (
  <div
    role="img"
    aria-label={`${elapsed} of ${total} minutes done`}
    className={cn("flex h-2.5 items-end justify-between", className)}
  >
    {Array.from({ length: total }, (_, index) => (
      <span
        key={index}
        className={cn("w-[2px] rounded-full", index < elapsed ? "bg-(--w-ink)" : "bg-(--w-faint)")}
        style={{ height: index < elapsed || index % 5 === 0 ? "100%" : "60%", opacity: index < elapsed ? 1 : 0.7 }}
      />
    ))}
  </div>
);

export const DotRing = ({ total, filled, size, dot = 2 }: { total: number; filled: number; size: number; dot?: number }) => (
  <svg aria-hidden="true" width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0">
    {Array.from({ length: total }, (_, index) => {
      const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
      const reach = size / 2 - dot - 2;
      return (
        <circle
          key={index}
          cx={round(size / 2 + Math.cos(angle) * reach)}
          cy={round(size / 2 + Math.sin(angle) * reach)}
          r={dot}
          fill={index < filled ? "var(--w-ink)" : "var(--w-track)"}
        />
      );
    })}
  </svg>
);

export const TickBox = ({ done, onToggle, label }: { done: boolean; onToggle: () => void; label: string }) => (
  <button
    type="button"
    aria-pressed={done}
    aria-label={label}
    onClick={onToggle}
    className="-m-1.5 grid size-8 shrink-0 touch-manipulation place-items-center rounded-lg outline-none transition-[scale,background-color] duration-(--dur-press) ease-out hover:bg-(--w-track) focus-visible:shadow-[inset_0_0_0_2px_var(--w-dim)] active:scale-[0.88] motion-reduce:transition-none"
  >
    <span
      className={cn(
        "grid size-[1.125rem] place-items-center rounded-[6px] transition-[background-color,box-shadow] duration-(--dur-base) ease-out",
        done ? "bg-(--w-ink)" : "shadow-[inset_0_0_0_1.5px_var(--w-faint)]",
      )}
    >
      <Check
        weight="bold"
        aria-hidden="true"
        className={cn("size-3 text-(--w-on-ink) transition-[opacity,scale] duration-(--dur-base) ease-out motion-reduce:transition-none", done ? "opacity-100" : "scale-75 opacity-0")}
      />
    </span>
  </button>
);

export const Fit = ({ width, children, className }: { width: number; children: ReactNode; className?: string }) => {
  const frame = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const fit = () => setZoom(Math.min(1, node.clientWidth / width));
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    fit();
    return () => observer.disconnect();
  }, [width]);
  return (
    <div ref={frame} className={cn("mx-auto w-full overflow-hidden", className)} style={{ maxWidth: width }}>
      <div style={{ zoom, width }}>{children}</div>
    </div>
  );
};

export type Wallpaper = "morning" | "dusk" | "night";
const WALLPAPER_SRC: Record<Wallpaper, string> = {
  morning: "/art/backdrops/morning.webp",
  dusk: "/art/backdrops/dusk.webp",
  night: "/art/blur/night.webp",
};
export const wallpaperFor = (theme: Theme) => (theme === "dark" ? "dusk" : "morning") satisfies Wallpaper;

export const WallpaperImage = ({ wallpaper, dim = 0 }: { wallpaper: Wallpaper; dim?: number }) => (
  <>
    <img src={WALLPAPER_SRC[wallpaper]} alt="" width={1536} height={1024} loading="lazy" draggable={false} className="absolute inset-0 -z-10 size-full object-cover select-none" />
    {dim > 0 && <span aria-hidden="true" className="absolute inset-0 -z-10 bg-black" style={{ opacity: dim }} />}
  </>
);

export const Wall = ({
  width,
  tone,
  mode = "colour",
  children,
  className,
}: {
  width: number;
  tone?: Theme;
  mode?: Mode;
  children: ReactNode;
  className?: string;
}) => {
  const theme = useContext(ThemeContext);
  const glass = mode === "tinted" || mode === "clear";
  const shade = glass ? "dark" : (tone ?? theme);
  return (
    <div className={cn("relative isolate flex w-full flex-1 items-center justify-center overflow-hidden rounded-2xl p-4 sm:p-6", shade, className)}>
      <WallpaperImage wallpaper={glass ? "dusk" : wallpaperFor(shade)} dim={mode === "tinted" ? 0.42 : 0} />
      <ModeContext value={mode}>
        <Fit width={width}>{children}</Fit>
      </ModeContext>
    </div>
  );
};
