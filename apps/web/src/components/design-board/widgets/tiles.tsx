"use client";

import { ArrowRight, CalendarDots, CheckCircle, FlagPennant, Hourglass, MapPin, Play, Timer, Tray } from "@phosphor-icons/react";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { formatClock, formatMinutes } from "@/components/lifeos/format";
import { cn } from "@/lib/utils";
import type { Size, Span, Task } from "./model";
import { Axis, CapacityDots, DayStrip, DotNumber, Figure, FocusStrip, Heading, Tile, TickBox, UnitBadge, useAreaInk, WeekColumns } from "./parts";
import { AREAS, BRAIN_DUMP, CAPACITY, DATE, DEADLINES, FOCUS, NEXT, NOW, PLANNED, SPANS, TASKS, TODAY_SLICES, WEEK, WEEK_FREE, WORKING } from "./sample";

type World = { done: ReadonlySet<string>; toggle: (id: string) => void };
const WorldContext = createContext<World>({ done: new Set(), toggle: () => undefined });

export const WorldProvider = ({ children }: { children: ReactNode }) => {
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const world = useMemo(
    () => ({
      done,
      toggle: (id: string) =>
        setDone((before) => {
          const next = new Set(before);
          if (!next.delete(id)) next.add(id);
          return next;
        }),
    }),
    [done],
  );
  return <WorldContext value={world}>{children}</WorldContext>;
};

const capacityState = (left: number, capacity: number) => {
  if (left < 0) return "over";
  if (left === 0) return "full";
  if (left < 60) return "tight";
  return left > capacity / 2 ? "roomy" : "steady";
};

const AreaMark = ({ area, className }: { area: Task["area"]; className?: string }) => {
  const ink = useAreaInk();
  return <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", className)} style={{ backgroundColor: ink(AREAS[area].colour) }} />;
};

const TaskRow = ({ task, tall = false }: { task: Task; tall?: boolean }) => {
  const { done, toggle } = useContext(WorldContext);
  const ticked = done.has(task.id);
  return (
    <li className={cn("flex items-center gap-2.5", tall ? "h-[2.125rem]" : "h-8")}>
      <TickBox done={ticked} onToggle={() => toggle(task.id)} label={`${ticked ? "Reopen" : "Complete"} ${task.title}`} />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-small transition-[color] duration-(--dur-base) ease-out",
          ticked && "text-(--w-faint) line-through decoration-(--w-faint)",
        )}
      >
        {task.title}
      </span>
      <span className="font-mono text-micro text-(--w-dim)">{formatMinutes(task.estimate)}</span>
      <AreaMark area={task.area} />
    </li>
  );
};

export const CapacityWidget = ({ planned = PLANNED, spans = SPANS }: { planned?: number; spans?: readonly Span[] }) => {
  const left = CAPACITY - planned;
  const state = capacityState(left, CAPACITY);
  return (
    <Tile size="small" label={`Capacity: ${formatMinutes(Math.abs(left))} ${left < 0 ? "over" : "left"} of ${formatMinutes(CAPACITY)} free`}>
      <div className="flex h-full flex-col">
        <Heading title="Capacity" state={state} />
        <div className={cn("mt-auto", left < 0 && "text-(--w-alert)")}>
          <Figure value={formatMinutes(Math.abs(left))} label={`${formatMinutes(Math.abs(left))} ${left < 0 ? "over" : "left"}`} icon={Hourglass} unit="h:m" />
        </div>
        <div className="mt-3.5">
          <DayStrip start={WORKING.start} end={WORKING.end} now={NOW} spans={spans} />
          <Axis left={left < 0 ? `of ${formatMinutes(CAPACITY)} free` : "9 am"} right="5:30 pm" />
        </div>
      </div>
    </Tile>
  );
};

const CapacityFoot = () => (
  <div>
    <CapacityDots slices={TODAY_SLICES} capacity={CAPACITY} />
    <Axis left={`${formatMinutes(CAPACITY - PLANNED)} left`} right={`of ${formatMinutes(CAPACITY)} free`} />
  </div>
);

const useLeft = () => {
  const { done } = useContext(WorldContext);
  return TASKS.filter((task) => !done.has(task.id));
};

export const TodayWidget = ({ size = "medium" }: { size?: Extract<Size, "medium" | "large"> }) => {
  const left = useLeft();
  const count = String(left.length);
  const label = `Today: ${count} ${left.length === 1 ? "Task" : "Tasks"} left`;
  if (size === "large")
    return (
      <Tile size="large" label={label}>
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-3">
            <Heading title="Today" state={DATE} />
            <div className="flex items-center gap-2">
              <DotNumber value={count} label={`${count} left`} />
              <UnitBadge icon={CheckCircle} unit="left" />
            </div>
          </div>
          <ul className="mt-3 flex-1">
            {TASKS.map((task) => (
              <TaskRow key={task.id} task={task} tall />
            ))}
          </ul>
          <DayStrip start={WORKING.start} end={WORKING.end} now={NOW} spans={SPANS} />
          <Axis left="9 am" right="5:30 pm" />
          <div className="mt-3">
            <CapacityFoot />
          </div>
        </div>
      </Tile>
    );
  return (
    <Tile size="medium" label={label}>
      <div className="flex h-full flex-col">
        <div className="flex min-h-0 flex-1 gap-4">
          <div className="flex w-[4.75rem] shrink-0 flex-col">
            <Heading title="Today" state={DATE} />
            <div className="mt-auto">
              <Figure value={count} label={`${count} left`} icon={CheckCircle} unit="left" />
            </div>
          </div>
          <ul className="min-w-0 flex-1">
            {TASKS.slice(0, 3).map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </ul>
        </div>
        <div className="mt-2.5">
          <CapacityFoot />
        </div>
      </div>
    </Tile>
  );
};

export const NEXT_WINDOW = { start: 9 * 60 + 30, end: 12 * 60 };
const countdown = formatMinutes(NEXT.start - NOW);

export const NextUpWidget = ({ size = "small" }: { size?: Extract<Size, "small" | "medium"> }) => {
  const label = `Next up: ${NEXT.task.title} in ${NEXT.start - NOW} minutes`;
  if (size === "medium")
    return (
      <Tile size="medium" label={label}>
        <div className="flex h-full flex-col">
          <div className="flex min-h-0 flex-1 gap-4">
            <div className="flex w-[8.25rem] shrink-0 flex-col">
              <Heading title="Next up" state={`starts ${formatClock(NEXT.start)}`} />
              <div className="mt-auto">
                <Figure value={countdown} label={`in ${countdown}`} icon={ArrowRight} unit="h:m" />
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-micro text-(--w-dim)">
                <AreaMark area={NEXT.task.area} />
                {AREAS[NEXT.task.area].name}
              </p>
              <p className="mt-0.5 line-clamp-2 text-[0.9375rem] leading-5 font-medium tracking-[-0.01em]">{NEXT.task.title}</p>
              <p className="mt-1.5 flex items-center gap-1 text-micro text-(--w-dim)">
                <MapPin weight="fill" className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  {NEXT.place}, <span className="font-mono">{NEXT.trip}</span> min drive
                </span>
              </p>
              <p className="text-micro text-(--w-ink)">
                Leave by <span className="font-mono">{formatClock(NEXT.leave)}</span>
              </p>
            </div>
          </div>
          <div className="mt-2.5">
            <DayStrip start={NEXT_WINDOW.start} end={NEXT_WINDOW.end} now={NOW} spans={SPANS} step={15} />
            <Axis left={formatClock(NEXT_WINDOW.start)} right={formatClock(NEXT_WINDOW.end)} />
          </div>
        </div>
      </Tile>
    );
  return (
    <Tile size="small" label={label}>
      <div className="flex h-full flex-col">
        <Heading title="Next up" state={NEXT.task.title} />
        <div className="mt-auto">
          <Figure value={countdown} label={`in ${countdown}`} icon={ArrowRight} unit="h:m" />
        </div>
        <div className="mt-3.5">
          <DayStrip start={NEXT_WINDOW.start} end={NEXT_WINDOW.end} now={NOW} spans={SPANS} step={15} />
          <Axis left={`leave ${formatClock(NEXT.leave)}`} right={NEXT.place} />
        </div>
      </div>
    </Tile>
  );
};

export const FocusWidget = ({ state = "running" }: { state?: "running" | "paused" | "idle" }) => {
  if (state === "idle")
    return (
      <Tile size="small" label="Focus: start a Focus Session on Methods draft">
        <div className="flex h-full flex-col">
          <Heading title="Focus" state="ready" />
          <p className="mt-auto line-clamp-2 text-small text-(--w-dim)">{FOCUS.task}</p>
          <button
            type="button"
            className="mt-2 flex h-8 w-full touch-manipulation items-center justify-center gap-1.5 rounded-full bg-(--w-ink) text-small font-medium text-(--w-on-ink) outline-none transition-[scale,opacity] duration-(--dur-press) ease-out hover:opacity-90 focus-visible:shadow-[0_0_0_2px_var(--w-dim)] active:scale-[0.97] motion-reduce:transition-none"
          >
            <Play weight="fill" className="size-3" aria-hidden="true" />
            Start <span className="font-mono">25:00</span>
          </button>
        </div>
      </Tile>
    );
  const left = String(FOCUS.planned - FOCUS.elapsed);
  return (
    <Tile size="small" label={`Focus Session on ${FOCUS.task}: ${left} minutes left${state === "paused" ? ", paused" : ""}`}>
      <div className="flex h-full flex-col">
        <Heading title="Focus" state={state === "paused" ? "paused" : FOCUS.task} />
        <div className={cn("mt-auto", state === "paused" && "text-(--w-dim)")}>
          <Figure value={left} label={`${left} minutes left`} icon={Timer} unit="min" />
        </div>
        <div className="mt-3.5">
          <FocusStrip total={FOCUS.planned} elapsed={FOCUS.elapsed} />
          <Axis left={`${FOCUS.round} of ${FOCUS.rounds}`} right="25:00" />
        </div>
      </div>
    </Tile>
  );
};

const nextDeadline = DEADLINES[0];

export const UpcomingWidget = () => (
  <Tile size="medium" label={`Upcoming: the next Deadline is in ${nextDeadline?.days} days`}>
    <div className="flex h-full gap-5">
      <div className="flex w-[5.25rem] shrink-0 flex-col">
        <Heading title="Upcoming" state={`due ${nextDeadline?.day}`} />
        <div className="mt-auto">
          <Figure value={String(nextDeadline?.days)} label={`${nextDeadline?.days} days to the next Deadline`} icon={FlagPennant} unit="days" />
        </div>
        <p className="mt-3.5 truncate text-[0.625rem] leading-3 text-(--w-dim)">{nextDeadline?.title}</p>
      </div>
      <WeekColumns days={WEEK} className="min-w-0 flex-1" />
    </div>
  </Tile>
);

const DeadlineRow = ({ title, when, area }: { title: string; when: string; area: Task["area"] }) => (
  <li className="flex h-[2.125rem] items-center gap-2.5">
    <span aria-hidden="true" className="mx-0.5 size-[5px] shrink-0 rotate-45 rounded-[1px] bg-(--w-deadline)" />
    <span className="min-w-0 flex-1 truncate text-small">{title}</span>
    <span className="font-mono text-micro text-(--w-dim)">{when}</span>
    <AreaMark area={area} />
  </li>
);

export const WeekWidget = () => (
  <Tile size="xl" label={`This week: ${formatMinutes(WEEK_FREE)} still free`} className="p-4">
    <div className="flex h-full gap-8">
      <div className="flex min-w-0 flex-1 flex-col">
        <Heading title="This week" state="30 Nov to 6 Dec" />
        <div className="mt-4 flex items-center gap-2.5">
          <DotNumber value={formatMinutes(WEEK_FREE)} label={`${formatMinutes(WEEK_FREE)} still free`} pitch={6.5} />
          <UnitBadge icon={CalendarDots} unit="free" />
        </div>
        <WeekColumns days={WEEK} perRow={2} dot={11} gap={5} detail className="mt-auto pr-2" />
      </div>
      <div className="flex w-[15.5rem] shrink-0 flex-col">
        <p className="text-micro text-(--w-dim)">Deadlines</p>
        <ul className="mt-1">
          {DEADLINES.map((deadline) => (
            <DeadlineRow key={deadline.id} title={deadline.title} area={deadline.area} when={`${deadline.day}, ${deadline.days} d`} />
          ))}
        </ul>
        <p className="mt-4 text-micro text-(--w-dim)">Today</p>
        <ul className="mt-1">
          {TASKS.slice(0, 3).map((task) => (
            <TaskRow key={task.id} task={task} tall />
          ))}
        </ul>
        <p className="mt-auto flex items-center gap-1.5 text-micro text-(--w-dim)">
          <Tray weight="fill" className="size-3" aria-hidden="true" />
          Brain Dump
          <span className="ml-auto font-mono">{BRAIN_DUMP} to sort</span>
        </p>
      </div>
    </div>
  </Tile>
);

export const DoneWidget = () => (
  <Tile size="small" label="Today: nothing left">
    <div className="flex h-full flex-col">
      <Heading title="Today" state="clear" />
      <div className="mt-auto">
        <Figure value="0" label="0 left" icon={CheckCircle} unit="left" />
      </div>
      <div className="mt-3.5">
        <CapacityDots slices={[{ colour: "slate", minutes: 255 }]} capacity={255} dot={3.3} className="opacity-45" />
        <Axis left="all done" right="4:15" />
      </div>
    </div>
  </Tile>
);

export const StaleWidget = () => (
  <Tile size="small" label="Capacity as of Friday. Open LifeOS to refresh">
    <div className="flex h-full flex-col">
      <Heading title="Capacity" state="as of Fri" />
      <div className="mt-auto text-(--w-faint)">
        <Figure value="2:30" label="2:30 left on Friday" icon={Hourglass} unit="h:m" />
      </div>
      <p className="mt-3.5 text-micro text-(--w-dim)">Open LifeOS to refresh</p>
    </div>
  </Tile>
);

export const PlaceholderWidget = () => (
  <Tile size="small" label="A widget before its first snapshot">
    <div aria-hidden="true" className="flex h-full flex-col">
      <span className="h-3 w-16 rounded-full bg-(--w-track)" />
      <span className="mt-2 h-2 w-10 rounded-full bg-(--w-track)" />
      <div className="mt-auto flex items-center justify-between text-(--w-track)">
        <DotNumber value="8:88" />
        <span className="h-7 w-[1.625rem] rounded-lg bg-(--w-track)" />
      </div>
      <div className="mt-3.5">
        <DayStrip start={WORKING.start} end={WORKING.end} spans={[]} />
        <div className="mt-1 flex justify-between">
          <span className="h-2 w-6 rounded-full bg-(--w-track)" />
          <span className="h-2 w-8 rounded-full bg-(--w-track)" />
        </div>
      </div>
    </div>
  </Tile>
);

export const FreeWidget = () => (
  <Tile size="small" label="Next up: nothing else today">
    <div className="flex h-full flex-col">
      <Heading title="Next up" state="nothing booked" />
      <p className="mt-auto text-small text-(--w-dim)">Free until tomorrow, 9 am</p>
      <div className="mt-3.5">
        <DayStrip start={WORKING.start} end={WORKING.end} now={16 * 60 + 40} spans={SPANS} />
        <Axis left="9 am" right="5:30 pm" />
      </div>
    </div>
  </Tile>
);
