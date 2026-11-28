"use client";

import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

export type InkLoad = { readonly done: number; readonly kept: number; readonly predicted: number };

const span = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

const dotKinds = (load: InkLoad, capacity: number, unit: number) => {
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

export const LoadDots = ({ load, capacity, unit, dot = 4, className }: { load: InkLoad; capacity: number; unit: number; dot?: number; className?: string }) => (
  <span aria-hidden="true" className={cn("flex flex-wrap gap-[2px] overflow-hidden", className)}>
    {dotKinds(load, capacity, unit).map((kind, index) => (
      <span key={index} className={cn("rounded-full", DOT_CLASS[kind])} style={{ width: dot, height: dot }} />
    ))}
  </span>
);

export const CapacityRing = ({ load, capacity, size = 46 }: { load: InkLoad; capacity: number; size?: number }) => {
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

export const HatchSwatch = ({ className }: { className?: string }) => (
  <span aria-hidden="true" data-look="predicted" className={cn("tl-block inline-block size-3 shrink-0 rounded-[3px]", className)} style={{ "--a": "var(--foreground)" } as CSSProperties} />
);
