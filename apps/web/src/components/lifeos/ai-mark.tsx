"use client";

import type { Icon, IconProps } from "@phosphor-icons/react";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const BAND = { d: "M76 196 196 76", width: 44 } as const;
const GLINT = { d: "M52 124 124 52", width: 18, heavy: 26 } as const;
const STAGGER_MS = 160;
const PULSE = "motion-safe:animate-pending";

const markOf = (working: boolean, name: string) => {
  const Mark = forwardRef<SVGSVGElement, IconProps>(({ weight, className, ...props }, ref) => (
    <svg ref={ref} viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeLinecap="round" className={cn("size-4 shrink-0", className)} {...props}>
      <path d={GLINT.d} strokeWidth={weight === "fill" || weight === "bold" ? GLINT.heavy : GLINT.width} className={working ? PULSE : undefined} />
      <path d={BAND.d} strokeWidth={BAND.width} className={working ? PULSE : undefined} style={working ? { animationDelay: `${STAGGER_MS}ms` } : undefined} />
    </svg>
  ));
  Mark.displayName = name;
  return Mark;
};

export const AiMark: Icon = markOf(false, "AiMark");
export const AiMarkWorking: Icon = markOf(true, "AiMarkWorking");
