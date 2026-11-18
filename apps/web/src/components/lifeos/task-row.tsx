"use client";

import { Flag, ListChecks } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { AreaDot, type AreaColour } from "./area";
import { formatMinutes } from "./format";

export type DeadlineMark = { label: string; countdown?: string; overdue?: boolean };

export type TaskSummary = {
  id: string;
  title: string;
  area: { name: string; colour: AreaColour };
  project?: string;
  estimate?: number;
  plannedAt?: string;
  deadline?: DeadlineMark;
  checklist?: { done: number; total: number };
  someday?: boolean;
};

export const TaskCheckbox = ({
  checked,
  onCheckedChange,
  label,
  someday = false,
  size = "md",
  className,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  someday?: boolean;
  size?: "sm" | "md";
  className?: string;
}) => (
  <button
    type="button"
    role="checkbox"
    aria-checked={checked}
    aria-label={label}
    onClick={() => {
      haptic(checked ? "toggle" : "complete");
      onCheckedChange(!checked);
    }}
    className={cn(
      "group/check relative grid shrink-0 place-items-center outline-offset-4 transition-transform duration-(--dur-press) ease-out before:absolute before:-inset-2.5 active:scale-[0.86]",
      size === "md" ? "size-[18px] rounded-[6px]" : "size-4 rounded-full",
      className,
    )}
  >
    <span
      className={cn(
        "absolute inset-0 rounded-[inherit] border-[1.5px] transition-colors duration-(--dur-fast)",
        someday && "border-dashed",
        checked ? "border-transparent" : "border-foreground/30 group-hover/check:border-foreground/55",
      )}
    />
    <span
      className={cn(
        "absolute inset-0 rounded-[inherit] bg-brand transition-[transform,opacity] duration-(--dur-base) ease-out motion-reduce:transition-opacity",
        checked ? "scale-100 opacity-100" : "scale-50 opacity-0 motion-reduce:scale-100",
      )}
    />
    <svg viewBox="0 0 18 18" aria-hidden="true" className="relative size-full text-brand-foreground">
      <path
        d="M5 9.5l2.7 2.7L13 6.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={checked ? 0 : 1}
        className={cn(
          "transition-[stroke-dashoffset] ease-out motion-reduce:transition-none",
          checked ? "delay-75 duration-(--dur-slow)" : "duration-0",
        )}
      />
    </svg>
  </button>
);

export const StrikeTitle = ({ struck, children, className }: { struck: boolean; children: ReactNode; className?: string }) => (
  <span
    className={cn(
      "relative inline-block max-w-full truncate align-top transition-colors duration-(--dur-slow) ease-out",
      "after:absolute after:inset-x-0 after:top-[52%] after:h-px after:origin-left after:bg-current after:transition-transform after:duration-(--dur-slow) after:ease-out motion-reduce:after:transition-none",
      struck ? "text-faint-foreground after:scale-x-100" : "after:scale-x-0",
      className,
    )}
  >
    {children}
  </span>
);

export const EstimateChip = ({ minutes, className }: { minutes: number; className?: string }) => (
  <span
    title="Estimate"
    className={cn(
      "inline-flex h-6 shrink-0 items-center rounded-md bg-foreground/[0.06] px-1.5 font-mono text-small text-foreground/80",
      className,
    )}
  >
    <span className="sr-only">Estimate </span>
    {formatMinutes(minutes)}
  </span>
);

export const ActualChip = ({
  actual,
  estimate,
  meter,
  className,
}: {
  actual: number;
  estimate?: number;
  meter: ReactNode;
  className?: string;
}) => (
  <span
    title={estimate === undefined ? "Actual Time" : "Actual Time against the Estimate"}
    className={cn(
      "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-foreground/[0.06] px-1.5 font-mono text-small text-foreground/80",
      className,
    )}
  >
    {meter}
    <span className={cn(estimate !== undefined && actual > estimate && "text-negative")}>
      <span className="sr-only">Actual Time </span>
      {formatMinutes(actual)}
    </span>
    {estimate !== undefined && (
      <span className="text-faint-foreground">
        <span aria-hidden="true">/ </span>
        <span className="sr-only">Estimate </span>
        {formatMinutes(estimate)}
      </span>
    )}
  </span>
);

export const DeadlineMarker = ({ deadline, className }: { deadline: DeadlineMark; className?: string }) => (
  <span
    className={cn(
      "inline-flex shrink-0 items-center gap-1 text-small font-medium",
      deadline.overdue ? "text-negative" : "text-deadline",
      className,
    )}
  >
    <Flag weight="fill" className="size-3.5" aria-hidden="true" />
    <span className="sr-only">Deadline </span>
    {deadline.label}
    {deadline.countdown && <span className="hidden font-normal opacity-70 @lg:inline">{deadline.countdown}</span>}
  </span>
);

export const TaskRow = ({
  task,
  completed,
  onCompletedChange,
  onOpen,
  status,
  className,
}: {
  task: TaskSummary;
  completed: boolean;
  onCompletedChange: (completed: boolean) => void;
  onOpen?: () => void;
  status?: ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      "group/row @container flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors duration-(--dur-fast) hover:bg-foreground/[0.04]",
      className,
    )}
  >
    <TaskCheckbox
      checked={completed}
      onCheckedChange={onCompletedChange}
      someday={task.someday}
      label={`Complete ${task.title}`}
      className="mt-[3px]"
    />
    <button
      type="button"
      onClick={onOpen}
      disabled={!onOpen}
      className="min-w-0 flex-1 rounded-md text-left outline-offset-4 disabled:cursor-default"
    >
      <StrikeTitle struck={completed} className={cn(task.someday && !completed && "text-muted-foreground")}>
        {task.title}
      </StrikeTitle>
      <span
        className={cn(
          "flex items-center gap-1.5 text-small text-muted-foreground transition-opacity duration-(--dur-slow)",
          completed && "opacity-50",
        )}
      >
        {status ?? (
          <>
            <AreaDot colour={task.area.colour} />
            <span className="shrink-0">{task.area.name}</span>
            {task.project && <span className="hidden truncate text-faint-foreground @sm:inline">{task.project}</span>}
            {task.checklist && (
              <span className="ml-1 inline-flex items-center gap-1 font-mono text-micro text-faint-foreground">
                <ListChecks className="size-3.5" aria-hidden="true" />
                {task.checklist.done}/{task.checklist.total}
              </span>
            )}
          </>
        )}
      </span>
    </button>
    <span
      className={cn(
        "flex shrink-0 items-center gap-3 transition-opacity duration-(--dur-slow)",
        completed && "opacity-40",
      )}
    >
      {task.deadline && <DeadlineMarker deadline={task.deadline} />}
      {task.plannedAt && (
        <span title="Planned start" className="hidden font-mono text-small text-muted-foreground @sm:inline">
          {task.plannedAt}
        </span>
      )}
      {task.estimate !== undefined && <EstimateChip minutes={task.estimate} />}
    </span>
  </div>
);
