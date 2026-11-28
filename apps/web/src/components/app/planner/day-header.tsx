"use client";

import { ArrowsOutLineVertical, Notebook } from "@phosphor-icons/react";
import type { IsoDate } from "@lifeos/backend/date";
import { useEffect, useState, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DayMeter } from "@/components/lifeos/capacity";
import { GoalEditor, LoadBreakdown } from "@/components/lifeos/day-goal";
import { formatMinutes } from "@/components/lifeos/format";
import { IconButton } from "@/components/ui/action-button";
import { Popover } from "@/components/ui/popover-panel";
import { RollingNumber } from "@/components/ui/rolling-number";
import { cn } from "@/lib/utils";
import { dailyDocId } from "../../notes/library";
import { openBeside } from "../../notes/note-beside";
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

type CardSpot = { top: number; left: number };

const CARD_GAP = 4;

const HoverCard = ({ spot, shown, children }: { spot: CardSpot | null; shown: boolean; children: ReactNode }) =>
  spot &&
  createPortal(
    <div
      aria-hidden="true"
      data-day-breakdown=""
      data-shown={shown || undefined}
      style={spot}
      className="pointer-events-none fixed z-[100] w-64 origin-top-left scale-[0.97] rounded-xl bg-popover p-3 text-foreground opacity-0 shadow-float transition-[opacity,scale] duration-[125ms] ease-out starting:scale-[0.97] starting:opacity-0 data-shown:scale-100 data-shown:opacity-100 data-shown:delay-300 motion-reduce:scale-100 motion-reduce:starting:scale-100"
    >
      {children}
    </div>,
    document.body,
  );

const useHoverCard = () => {
  const [spot, setSpot] = useState<CardSpot | null>(null);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (!hovered) return;
    const hide = () => setHovered(false);
    window.addEventListener("scroll", hide, { capture: true, passive: true });
    window.addEventListener("resize", hide, { passive: true });
    return () => {
      window.removeEventListener("scroll", hide, { capture: true });
      window.removeEventListener("resize", hide);
    };
  }, [hovered]);

  return {
    spot,
    shown: hovered,
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === "touch") return;
      const box = event.currentTarget.getBoundingClientRect();
      setSpot({ top: box.bottom + CARD_GAP, left: box.left + CARD_GAP });
      setHovered(true);
    },
    onPointerLeave: () => setHovered(false),
  };
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
  const [editing, setEditing] = useState(false);
  const { spot, shown, onPointerEnter, onPointerLeave } = useHoverCard();
  const breakdown = (
    <LoadBreakdown areas={day.areas} planned={day.planned} guessed={day.guessed} unestimated={day.unestimated} goal={day.goal} free={day.free} />
  );
  return (
    <>
      <h2 className="flex h-8 items-center gap-2 pr-1 pl-3 text-heading">
        <span className="font-semibold">{weekdayShort(day.date)}</span>
        <span className="text-muted-foreground">{dayMonth(day.date)}</span>
        {isToday && <span className="text-small font-medium text-brand">Today</span>}
        <span className="ml-auto flex items-center">
          <IconButton
            icon={Notebook}
            label={`Open the note for ${isToday ? "today" : longDay(day.date)}`}
            tooltip="The day’s note"
            data-day-note={day.date}
            onClick={() => openBeside(dailyDocId(day.date))}
            className="text-muted-foreground"
          />
          {spreadable && (
            <IconButton
              icon={ArrowsOutLineVertical}
              iconWeight="bold"
              label={`Spread ${isToday ? "today" : longDay(day.date)} across the day`}
              onClick={() => onSpread(day.date)}
              className="text-muted-foreground"
            />
          )}
        </span>
      </h2>
      <Popover
        side="bottom"
        align="start"
        className="w-80 space-y-4"
        onOpenChange={setEditing}
        trigger={
          <button
            type="button"
            aria-label={`${longDay(day.date)}: ${summary(day)}`}
            onPointerEnter={onPointerEnter}
            onPointerLeave={onPointerLeave}
            className="group/meter block w-full space-y-1.5 rounded-lg px-3 py-1 text-left transition-[background-color,scale] duration-(--dur-press) ease-out outline-none hover:bg-foreground/[0.035] focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
          >
            <DayMeter slices={day.slices} goal={day.goal} free={day.free} />
            <span className={cn("block text-micro text-muted-foreground")}>
              <LoadLine day={day} />
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
      <HoverCard spot={editing ? null : spot} shown={shown}>
        {breakdown}
      </HoverCard>
    </>
  );
};
