"use client";

import { RollingNumber } from "@/components/ui/rolling-number";
import { cn } from "@/lib/utils";
import { areaVar, type AreaColour } from "./area";
import { formatMinutes } from "./format";

const DOT_MINUTES = 15;

export type PlannedSlice = { id: string; colour: AreaColour; minutes: number };

export const CapacityMeter = ({
  capacity,
  planned,
  className,
}: {
  capacity: number;
  planned: PlannedSlice[];
  className?: string;
}) => {
  const total = planned.reduce((sum, slice) => sum + slice.minutes, 0);
  const colours = planned.flatMap((slice) =>
    Array.from({ length: Math.round(slice.minutes / DOT_MINUTES) }, () => areaVar(slice.colour)),
  );
  const freeDots = Math.round(capacity / DOT_MINUTES);
  const dotCount = Math.max(freeDots, colours.length);
  return (
    <div
      role="meter"
      aria-label="Capacity"
      aria-valuemin={0}
      aria-valuemax={capacity}
      aria-valuenow={total}
      aria-valuetext={`${formatMinutes(total)} planned of ${formatMinutes(capacity)} free`}
      className={cn("flex max-w-md gap-1 @sm:gap-1.5", className)}
    >
      {Array.from({ length: dotCount }, (_, index) => {
        const over = index >= freeDots;
        const colour = colours[index];
        return (
          <span
            key={index}
            className={cn(
              "aspect-square max-w-2.5 min-w-0 flex-1 rounded-full transition-[background-color,scale] duration-(--dur-base) ease-out",
              !colour && "bg-foreground/[0.11]",
              over && "shadow-[inset_0_0_0_2px_var(--negative)]",
              index === freeDots && "ml-2",
            )}
            style={{
              backgroundColor: over ? "transparent" : colour,
              transitionDelay: `${Math.min(index, 28) * 12}ms`,
            }}
          />
        );
      })}
    </div>
  );
};

export const DayColumnHeader = ({
  weekday,
  date,
  today = false,
  capacity,
  commitments,
  planned,
}: {
  weekday: string;
  date: string;
  today?: boolean;
  capacity: number;
  commitments: number;
  planned: PlannedSlice[];
}) => {
  const total = planned.reduce((sum, slice) => sum + slice.minutes, 0);
  const over = total - capacity;
  return (
    <header className="@container space-y-3">
      <div className="flex items-baseline gap-2">
        <h3 className="text-title font-semibold">
          {weekday} <span className="font-normal text-muted-foreground">{date}</span>
        </h3>
        {today && <span className="text-small font-medium text-brand">Today</span>}
        <p className="ml-auto text-small text-muted-foreground">
          <RollingNumber
            value={formatMinutes(total)}
            className={cn("font-mono text-body font-medium", over > 0 ? "text-negative" : "text-foreground")}
          />{" "}
          of <span className="font-mono">{formatMinutes(capacity)}</span> free
        </p>
      </div>
      <CapacityMeter capacity={capacity} planned={planned} />
      <p className={cn("text-small", over > 0 ? "text-negative" : "text-muted-foreground")}>
        {over > 0
          ? `${formatMinutes(over)} over. Move something to tomorrow.`
          : `One dot is 15 minutes. Free after ${commitments} Commitments.`}
      </p>
    </header>
  );
};
