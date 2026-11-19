"use client";

import { ArrowsOutLineVertical } from "@phosphor-icons/react";
import type { IsoDate } from "@lifeos/backend/date";
import { DayMeter } from "@/components/lifeos/capacity";
import { GoalEditor, LoadBreakdown } from "@/components/lifeos/day-goal";
import { formatMinutes } from "@/components/lifeos/format";
import { IconButton } from "@/components/ui/action-button";
import { Popover } from "@/components/ui/popover-panel";
import { RollingNumber } from "@/components/ui/rolling-number";
import { cn } from "@/lib/utils";
import { dayMonth, longDay, weekdayShort } from "../dates";
import type { PlanActions } from "./actions";
import type { PlanDay } from "./model";

const LoadLine = ({ day }: { day: PlanDay }) => {
  const load = day.planned + day.guessed;
  const free = Math.max(0, day.free);
  const approx = day.guessed > 0 ? "~" : "";
  const target = (
    <span className="font-mono text-foreground/80 underline decoration-foreground/25 decoration-dotted underline-offset-[3px] transition-[text-decoration-color] duration-(--dur-fast) group-hover/meter:decoration-foreground/60">
      {formatMinutes(day.goalSet ? day.goal : free)}
    </span>
  );
  const unestimated = day.unestimated > 0 && <span className="text-faint-foreground"> · {day.unestimated} not estimated</span>;
  if (load > free)
    return (
      <span className="text-negative">
        <RollingNumber value={`${approx}${formatMinutes(load - free)}`} className="font-mono font-medium" /> over your{" "}
        <span className="font-mono">{formatMinutes(free)}</span> free{unestimated}
      </span>
    );
  if (day.goalSet && load > day.goal)
    return (
      <span className="text-foreground">
        <RollingNumber value={`${approx}${formatMinutes(load - day.goal)}`} className="font-mono font-medium" /> past your {target} goal
        {unestimated}
      </span>
    );
  const left = (day.goalSet ? day.goal : free) - load;
  return (
    <span>
      <RollingNumber value={`${approx}${formatMinutes(left)}`} className="font-mono text-foreground" /> left of {target}{" "}
      {day.goalSet ? "goal" : "free"}
      {unestimated}
    </span>
  );
};

const summary = (day: PlanDay) => {
  const parts = [
    `${formatMinutes(day.planned)} planned`,
    day.guessed > 0 ? `about ${formatMinutes(day.guessed)} more guessed` : null,
    day.unestimated > 0 ? `${day.unestimated} not estimated` : null,
    `goal ${formatMinutes(day.goal)}${day.goalSet ? "" : ", your free time"}`,
    `${formatMinutes(Math.max(0, day.free))} free`,
  ];
  return `${parts.filter(Boolean).join(", ")}. Change the goal`;
};

export const DayHeader = ({
  day,
  isToday,
  actions,
  onSpread,
}: {
  day: PlanDay;
  isToday: boolean;
  actions: PlanActions;
  onSpread: (date: IsoDate) => void;
}) => {
  const spreadable = day.tasks.some((task) => task.status.kind === "open" && !day.boxed.has(task._id));
  const breakdown = (
    <LoadBreakdown areas={day.areas} planned={day.planned} guessed={day.guessed} unestimated={day.unestimated} goal={day.goal} free={day.free} />
  );
  return (
    <>
      <h2 className="flex h-8 items-center gap-2 pr-1 pl-3 text-heading">
        <span className="font-semibold">{weekdayShort(day.date)}</span>
        <span className="text-muted-foreground">{dayMonth(day.date)}</span>
        {isToday && <span className="text-small font-medium text-brand">Today</span>}
        {spreadable && (
          <IconButton
            icon={ArrowsOutLineVertical}
            iconWeight="bold"
            label={`Spread ${isToday ? "today" : longDay(day.date)} across the day`}
            onClick={() => onSpread(day.date)}
            className="ml-auto text-muted-foreground"
          />
        )}
      </h2>
      <Popover
        side="bottom"
        align="start"
        className="w-80 space-y-4"
        trigger={
          <button
            type="button"
            aria-label={`${longDay(day.date)}: ${summary(day)}`}
            className="group/meter relative block w-full space-y-1.5 rounded-lg px-3 py-1 text-left transition-[background-color,scale] duration-(--dur-press) ease-out outline-none hover:bg-foreground/[0.035] focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
          >
            <DayMeter slices={day.slices} goal={day.goal} free={day.free} />
            <span className={cn("block text-micro text-muted-foreground")}>
              <LoadLine day={day} />
            </span>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-full left-1 z-30 mt-1 block w-64 origin-top-left scale-[0.97] rounded-xl bg-popover p-3 opacity-0 shadow-float transition-[opacity,scale] duration-[125ms] ease-out group-hover/meter:scale-100 group-hover/meter:opacity-100 group-hover/meter:delay-300 group-data-[state=open]/meter:hidden motion-reduce:scale-100"
            >
              {breakdown}
            </span>
          </button>
        }
        title={`${longDay(day.date)}`}
      >
        {breakdown}
        <div className="space-y-2 pt-3 shadow-[0_-1px_0] shadow-foreground/[0.07]">
          <p className="px-1 text-small font-medium">Goal for the day</p>
          <GoalEditor
            goal={day.goal}
            free={day.free}
            goalSet={day.goalSet}
            onChange={(minutes) => actions.setGoal(day.date, minutes, { goal: day.goal, goalSet: day.goalSet, free: day.free })}
          />
        </div>
      </Popover>
    </>
  );
};
