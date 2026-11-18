import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const ProgressRing = ({
  value,
  size = 96,
  stroke = 8,
  colour = "var(--brand)",
  label,
  children,
  className,
}: {
  value: number;
  size?: number;
  stroke?: number;
  colour?: string;
  label: string;
  children?: ReactNode;
  className?: string;
}) => {
  const clamped = Math.min(1, Math.max(0, value));
  const radius = (size - stroke) / 2;
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      className={cn("relative inline-grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="absolute inset-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className="stroke-foreground/[0.08]" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colour}
          strokeWidth={stroke}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - clamped}
          className="transition-[stroke-dashoffset,opacity] duration-(--dur-roll) ease-out motion-reduce:transition-none"
          style={{ opacity: clamped === 0 ? 0 : 1 }}
        />
      </svg>
      {children && <span className="relative">{children}</span>}
    </span>
  );
};

export const ProgressPie = ({
  value,
  colour = "currentColor",
  className,
}: {
  value: number;
  colour?: string;
  className?: string;
}) => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className={cn("size-4 shrink-0 -rotate-90", className)}>
    <circle cx="8" cy="8" r="6.75" fill="none" stroke={colour} strokeWidth="1.5" />
    <circle
      cx="8"
      cy="8"
      r="2.25"
      fill="none"
      stroke={colour}
      strokeWidth="4.5"
      pathLength={1}
      strokeDasharray={1}
      strokeDashoffset={1 - Math.min(1, Math.max(0, value))}
      className="transition-[stroke-dashoffset] duration-(--dur-roll) ease-out motion-reduce:transition-none"
    />
  </svg>
);
