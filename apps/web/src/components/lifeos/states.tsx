"use client";

import { Check } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { round } from "./format";

const HORIZON_DOTS = 13;

const Horizon = () => (
  <svg viewBox="0 0 120 64" aria-hidden="true" className="h-16 w-[7.5rem]">
    {Array.from({ length: HORIZON_DOTS }, (_, index) => {
      const angle = Math.PI - (index / (HORIZON_DOTS - 1)) * Math.PI;
      return (
        <circle
          key={index}
          cx={round(60 + Math.cos(angle) * 46)}
          cy={round(58 - Math.sin(angle) * 46)}
          r={index === Math.floor(HORIZON_DOTS / 2) ? 3 : 2}
          className={index === Math.floor(HORIZON_DOTS / 2) ? "fill-brand" : "fill-foreground opacity-20"}
        />
      );
    })}
    {Array.from({ length: 21 }, (_, index) => (
      <circle key={index} cx={10 + index * 5} cy={61} r={0.75} className="fill-foreground opacity-25" />
    ))}
  </svg>
);

export const EmptyState = ({
  title,
  hint,
  action,
  className,
}: {
  title: string;
  hint: ReactNode;
  action?: ReactNode;
  className?: string;
}) => (
  <div className={cn("flex flex-col items-center gap-3 px-6 py-8 text-center", className)}>
    <Horizon />
    <div className="space-y-1">
      <p className="font-medium">{title}</p>
      <p className="text-small text-pretty text-muted-foreground">{hint}</p>
    </div>
    {action}
  </div>
);

export const ThingsStatus = ({ state }: { state: "waiting" | "confirmed" }) => (
  <span role="status" className="inline-flex items-center gap-1.5">
    {state === "waiting" ? (
      <>
        <span aria-hidden="true" className="flex gap-[3px]">
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className="size-1 animate-pending rounded-full bg-brand"
              style={{ animationDelay: `${index * 160}ms` }}
            />
          ))}
        </span>
        Waiting for Things
      </>
    ) : (
      <>
        <Check weight="bold" className="size-3 text-positive" aria-hidden="true" />
        Confirmed by Things
      </>
    )}
  </span>
);
