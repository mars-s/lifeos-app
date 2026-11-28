"use client";

import { cn } from "@/lib/utils";

export type EnergyMode = "past" | "today" | "usual";

export type EnergyCurve = {
  readonly points: readonly { readonly minute: number; readonly level: number }[];
  readonly peak: { readonly start: number; readonly end: number };
  readonly dip: { readonly start: number; readonly end: number };
  readonly bedtime: number;
};

const leanOf = (level: number) => Math.max(0.04, (level - 0.22) / 0.78);

const levelAt = (curve: EnergyCurve, minute: number) => {
  const after = curve.points.findIndex((point) => point.minute >= minute);
  const next = curve.points[after];
  const before = curve.points[after - 1];
  if (!next) return curve.points.at(-1)?.level ?? 0;
  if (!before || next.minute === minute) return next.level;
  return before.level + ((next.level - before.level) * (minute - before.minute)) / (next.minute - before.minute);
};

const MOST_DOTS = 6;
const DOT_PITCH = 5;
const ROW_MINUTES = 15;

export const ENERGY_LANE_PX = MOST_DOTS * DOT_PITCH + DOT_PITCH / 2;

export const dotsAt = (curve: EnergyCurve, minute: number, most = MOST_DOTS) => Math.round(leanOf(levelAt(curve, minute)) * most);

export const energyInk = (dots: number, most = MOST_DOTS) => `color-mix(in oklab, var(--energy-high) ${Math.round((Math.max(0, dots - 1) / Math.max(1, most - 1)) * 100)}%, var(--energy-low))`;

export const EnergyLane = ({
  curve,
  from,
  to,
  scale,
  now,
  mode,
  className,
}: {
  curve: EnergyCurve;
  from: number;
  to: number;
  scale: number;
  now: number;
  mode: EnergyMode;
  className?: string;
}) => {
  const first = curve.points[0];
  const last = curve.points.at(-1);
  if (!first || !last) return null;
  const step = ROW_MINUTES * Math.max(1, Math.ceil(6 / (ROW_MINUTES * scale)));
  const y = (minute: number) => (minute - from) * scale;
  const height = (to - from) * scale;
  const rows = Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, index) => Math.ceil(from / step) * step + index * step).filter(
    (minute) => minute > from && minute < to && minute >= first.minute && minute <= last.minute,
  );
  const windDown = curve.bedtime - 30;
  return (
    <svg
      aria-hidden="true"
      data-energy-lane={mode}
      width={ENERGY_LANE_PX}
      height={height}
      viewBox={`0 0 ${ENERGY_LANE_PX} ${height}`}
      className={cn("pointer-events-none absolute top-0 overflow-visible text-foreground", className)}
    >
      {windDown < to && windDown > from && <rect x={0} y={y(windDown)} width={ENERGY_LANE_PX} height={45 * scale} rx={3} fill="var(--sleep)" opacity={0.18} />}
      {rows.map((minute) => {
        const dots = dotsAt(curve, minute);
        const ink = energyInk(dots);
        const dim = mode === "today" && minute < now;
        return (
          <g key={minute} opacity={mode === "past" ? 0.34 : dim ? 0.4 : 1} style={mode === "past" ? undefined : mode === "usual" ? { stroke: ink } : { fill: ink }}>
            {Array.from({ length: dots }, (_, index) => (
              <circle
                key={index}
                cx={ENERGY_LANE_PX - (index + 1) * DOT_PITCH}
                cy={y(minute)}
                r={mode === "usual" ? 1.35 : 1.6}
                fill={mode === "past" ? "currentColor" : mode === "usual" ? "none" : undefined}
                strokeWidth={mode === "usual" ? 0.9 : undefined}
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
};

const SPARK_DOTS = 3;

export const EnergySpark = ({ curve, mode, now, className }: { curve: EnergyCurve; mode: EnergyMode; now: number; className?: string }) => {
  const first = curve.points[0];
  const last = curve.points.at(-1);
  if (!first || !last) return null;
  const hours = Array.from({ length: Math.floor((last.minute - first.minute) / 60) }, (_, index) => Math.floor(first.minute / 60) * 60 + index * 60 + 30).filter(
    (minute) => minute >= first.minute && minute <= last.minute,
  );
  return (
    <div aria-hidden="true" data-energy-dots={mode} className={cn("flex h-[11px] items-end justify-between px-0.5", className)}>
      {hours.map((minute) => {
        const dots = Math.max(1, dotsAt(curve, minute, SPARK_DOTS));
        const ink = energyInk(dots, SPARK_DOTS);
        return (
          <span key={minute} className={cn("flex flex-col-reverse gap-px", mode === "past" && "opacity-35", mode === "today" && minute < now && "opacity-40")}>
            {Array.from({ length: dots }, (_, index) => (
              <span
                key={index}
                className={cn("size-[3px] rounded-full", mode === "past" && "bg-foreground", mode === "usual" && "border-[0.75px]")}
                style={mode === "past" ? undefined : mode === "usual" ? { borderColor: ink } : { backgroundColor: ink }}
              />
            ))}
          </span>
        );
      })}
    </div>
  );
};

export const energyHint = (curve: EnergyCurve | null, minute: number) => {
  if (!curve) return undefined;
  if (minute >= curve.peak.start && minute < curve.peak.end) return "peak, good for deep work";
  if (minute >= curve.dip.start && minute < curve.dip.end) return "dip, good for admin or a walk";
  return undefined;
};
