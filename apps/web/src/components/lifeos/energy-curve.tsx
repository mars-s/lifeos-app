"use client";

import { useId } from "react";
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

const extreme = (curve: EnergyCurve, span: { start: number; end: number }, higher: boolean) =>
  curve.points
    .filter((point) => point.minute >= span.start && point.minute <= span.end)
    .reduce<{ minute: number; level: number } | null>((best, point) => (!best || (higher ? point.level > best.level : point.level < best.level) ? point : best), null)?.minute;

export const EnergyLane = ({
  curve,
  from,
  to,
  scale,
  now,
  width,
  mode,
  className,
}: {
  curve: EnergyCurve;
  from: number;
  to: number;
  scale: number;
  now: number;
  width: number;
  mode: EnergyMode;
  className?: string;
}) => {
  const id = useId();
  const shown = curve.points.filter((point) => point.minute >= from && point.minute <= to);
  const first = shown[0];
  const last = shown.at(-1);
  if (!first || !last) return null;
  const x = (level: number) => 1 + leanOf(level) * (width - 2);
  const y = (minute: number) => (minute - from) * scale;
  const height = (to - from) * scale;
  const points = shown.map((point) => `${x(point.level).toFixed(1)} ${y(point.minute).toFixed(1)}`);
  const line = `M${points.join("L")}`;
  const area = `M0 ${y(first.minute).toFixed(1)}L${points.join("L")}L0 ${y(last.minute).toFixed(1)}Z`;
  const live = mode === "today" && now > first.minute && now < last.minute;
  const peak = extreme(curve, curve.peak, true);
  const dip = extreme(curve, curve.dip, false);
  const marks = [peak, dip].flatMap((minute) => (minute !== undefined && minute > from && minute < to ? [minute] : []));
  const windDown = curve.bedtime - 30;
  return (
    <svg aria-hidden="true" width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn("pointer-events-none absolute top-0 overflow-visible text-foreground", className)}>
      <defs>
        <pattern id={`${id}hatch`} patternUnits="userSpaceOnUse" width={5} height={5} patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={5} stroke="currentColor" strokeWidth={1} opacity={0.42} />
        </pattern>
        <clipPath id={`${id}clip`}>
          <rect x={0} y={0} width={width + 2} height={Math.max(0, y(Math.min(now, to)))} className="tl-now" />
        </clipPath>
      </defs>
      {windDown < to && windDown > from && <rect x={0} y={y(windDown)} width={width} height={45 * scale} rx={3} fill="var(--sleep)" opacity={0.22} />}
      {mode === "past" && <path d={area} fill="currentColor" opacity={0.11} />}
      {mode === "today" && <path d={area} fill="currentColor" opacity={0.15} clipPath={`url(#${id}clip)`} />}
      {mode === "usual" && <path d={area} fill={`url(#${id}hatch)`} />}
      <path d={line} fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth={mode === "today" ? 1.5 : 1} opacity={mode === "today" ? 0.72 : mode === "usual" ? 0.5 : 0.3} />
      {mode !== "past" &&
        marks.map((minute) => (
          <circle
            key={minute}
            cx={x(levelAt(curve, minute))}
            cy={y(minute)}
            r={2.25}
            fill={minute === peak ? "currentColor" : "var(--tl-ground)"}
            stroke="currentColor"
            strokeWidth={1}
            opacity={mode === "today" ? 0.85 : 0.6}
          />
        ))}
      {live && <circle className="tl-bead" cx={x(levelAt(curve, now))} cy={y(now)} r={4.5} fill="var(--brand)" stroke="var(--tl-ground)" strokeWidth={2} />}
    </svg>
  );
};

const SPARK = { width: 100, height: 12 } as const;

export const EnergySpark = ({ curve, mode, now, className }: { curve: EnergyCurve; mode: EnergyMode; now: number; className?: string }) => {
  const id = useId();
  const first = curve.points[0];
  const last = curve.points.at(-1);
  if (!first || !last) return null;
  const x = (minute: number) => ((minute - first.minute) / Math.max(1, last.minute - first.minute)) * SPARK.width;
  const points = curve.points.map((point) => `${x(point.minute).toFixed(1)} ${(SPARK.height - 1 - leanOf(point.level) * (SPARK.height - 2)).toFixed(1)}`);
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${SPARK.width} ${SPARK.height}`} preserveAspectRatio="none" className={cn("block h-3 w-full text-foreground", className)}>
      <defs>
        <clipPath id={`${id}clip`}>
          <rect x={0} y={0} width={mode === "today" ? Math.max(0, x(now)) : SPARK.width} height={SPARK.height} />
        </clipPath>
      </defs>
      {mode !== "usual" && <path d={`M0 ${SPARK.height}L${points.join("L")}L${SPARK.width} ${SPARK.height}Z`} fill="currentColor" opacity={mode === "past" ? 0.13 : 0.18} clipPath={`url(#${id}clip)`} />}
      <path
        d={`M${points.join("L")}`}
        fill="none"
        stroke="currentColor"
        vectorEffect="non-scaling-stroke"
        strokeWidth={mode === "today" ? 1.5 : 1}
        strokeDasharray={mode === "usual" ? "2 2" : undefined}
        opacity={mode === "today" ? 0.75 : mode === "usual" ? 0.55 : 0.3}
      />
    </svg>
  );
};

export const energyHint = (curve: EnergyCurve | null, minute: number) => {
  if (!curve) return undefined;
  if (minute >= curve.peak.start && minute < curve.peak.end) return "peak, good for deep work";
  if (minute >= curve.dip.start && minute < curve.dip.end) return "dip, good for admin or a walk";
  return undefined;
};
