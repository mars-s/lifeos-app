"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";
import { at, BEDTIME, DIP_AT, energyAt, PEAK_AT, type EnergyMode } from "./model";

const lean = (minute: number, quality: number) => Math.max(0.04, (energyAt(minute, quality) - 0.22) / 0.78);

const samples = (from: number, to: number) => Array.from({ length: Math.floor((to - from) / 5) + 1 }, (_, index) => from + index * 5);

export const EnergyLane = ({
  from,
  to,
  scale,
  now,
  width,
  quality,
  mode,
  className,
}: {
  from: number;
  to: number;
  scale: number;
  now: number;
  width: number;
  quality: number;
  mode: EnergyMode;
  className?: string;
}) => {
  const id = useId();
  const height = (to - from) * scale;
  const x = (minute: number) => 1 + lean(minute, quality) * (width - 2);
  const y = (minute: number) => (minute - from) * scale;
  const points = samples(from, to).map((minute) => `${x(minute).toFixed(1)} ${y(minute).toFixed(1)}`);
  const line = `M${points.join("L")}`;
  const area = `M0 0L${points.join("L")}L0 ${height}Z`;
  const live = mode === "today" && now > from && now < to;
  const marks = [PEAK_AT, DIP_AT].filter((minute) => minute > from && minute < to);
  return (
    <svg aria-hidden="true" width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn("absolute top-0 overflow-visible text-foreground", className)}>
      <defs>
        <pattern id={`${id}hatch`} patternUnits="userSpaceOnUse" width={5} height={5} patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={5} stroke="currentColor" strokeWidth={1} opacity={0.42} />
        </pattern>
        <clipPath id={`${id}clip`}>
          <rect x={0} y={0} width={width + 2} height={Math.max(0, y(Math.min(now, to)))} className="tl-now" />
        </clipPath>
      </defs>
      {BEDTIME - 30 < to && <rect x={0} y={y(BEDTIME - 30)} width={width} height={Math.min(to, BEDTIME + 15) * scale - (BEDTIME - 30) * scale} rx={3} fill="var(--sleep)" opacity={0.22} />}
      {mode === "past" && <path d={area} fill="currentColor" opacity={0.11} />}
      {mode === "today" && <path d={area} fill="currentColor" opacity={0.15} clipPath={`url(#${id}clip)`} />}
      {mode === "usual" && <path d={area} fill={`url(#${id}hatch)`} />}
      <path d={line} fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth={mode === "today" ? 1.5 : 1} opacity={mode === "today" ? 0.72 : mode === "usual" ? 0.5 : 0.3} />
      {mode !== "past" &&
        marks.map((minute) => (
          <circle key={minute} cx={x(minute)} cy={y(minute)} r={2.25} fill={minute === PEAK_AT ? "currentColor" : "var(--tl-ground)"} stroke="currentColor" strokeWidth={1} opacity={mode === "today" ? 0.85 : 0.6} />
        ))}
      {live && <circle cx={x(now)} cy={y(now)} r={4.5} fill="var(--brand)" stroke="var(--tl-ground)" strokeWidth={2} />}
    </svg>
  );
};

const SPARK = { from: at(7), to: at(22), width: 100, height: 12 } as const;

export const EnergySpark = ({ quality, mode, now, className }: { quality: number; mode: EnergyMode; now: number; className?: string }) => {
  const id = useId();
  const x = (minute: number) => ((minute - SPARK.from) / (SPARK.to - SPARK.from)) * SPARK.width;
  const points = samples(SPARK.from, SPARK.to).map((minute) => `${x(minute).toFixed(1)} ${(SPARK.height - 1 - lean(minute, quality) * (SPARK.height - 2)).toFixed(1)}`);
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${SPARK.width} ${SPARK.height}`} preserveAspectRatio="none" className={cn("block h-3 w-full text-foreground", className)}>
      <defs>
        <clipPath id={`${id}clip`}>
          <rect x={0} y={0} width={mode === "today" ? x(now) : SPARK.width} height={SPARK.height} />
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
