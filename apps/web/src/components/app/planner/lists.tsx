"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus, Repeat } from "@phosphor-icons/react";
import { AnimatePresence } from "motion/react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { IsoDate } from "@lifeos/backend/date";
import type { PlanGhost, PlannerTask } from "@lifeos/backend/types";
import { AreaDot } from "@/components/lifeos/area";
import { formatMinutes } from "@/components/lifeos/format";
import { repeatLabel } from "@lifeos/backend/client/repeat";
import { EstimateChip } from "@/components/lifeos/task-row";
import { RollingNumber } from "@/components/ui/rolling-number";
import { cn } from "@/lib/utils";
import { longDay } from "../dates";
import { placeAttr } from "../new-task-place";
import { RowGap, useRowWindow } from "../row-window";
import { useShell } from "../shell-context";
import { TaskItem, useCardHost, useHostedRows } from "../task-item";
import type { PlanActions } from "./actions";
import { DayHeader } from "./day-header";
import { usePlacedRows } from "./drag";
import { INBOX, dayContainer, type PlanDay } from "./model";

export const PLANNER_SLOT = "/planner";
const COLUMN_PX = 280;
const BESIDE_DAYS_PX = 600;
const DAY_MS = 86_400_000;

const useDrawnNearView = (column: RefObject<HTMLElement | null>, first: boolean) => {
  const [drawn, setDrawn] = useState(first);
  useEffect(() => {
    const element = column.current;
    if (drawn || !element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setDrawn(true);
      },
      { root: element.closest("[data-plan-strip]"), rootMargin: "0px 50% 0px 50%" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [column, drawn]);
  return drawn;
};

const inFirstView = (date: IsoDate, today: IsoDate) =>
  (Date.parse(date) - Date.parse(today)) / DAY_MS < Math.max(1, Math.floor((window.innerWidth - BESIDE_DAYS_PX) / COLUMN_PX));

const daySlot = (date: string) => `${PLANNER_SLOT}:${date}`;

const AddTask = ({ label, onAdd, aside }: { label: string; onAdd: (title: string) => void; aside?: ReactNode }) => {
  const [title, setTitle] = useState("");
  return (
    <form
      className="group/add flex h-9 items-center gap-2 rounded-xl pr-2 pl-3 transition-[background-color] duration-(--dur-fast) ease-out focus-within:bg-foreground/[0.05] hover:bg-foreground/[0.04]"
      onSubmit={(event) => {
        event.preventDefault();
        const next = title.trim();
        if (!next) return;
        onAdd(next);
        setTitle("");
      }}
    >
      <Plus weight="bold" className="size-[18px] shrink-0 p-[3px] text-faint-foreground group-focus-within/add:text-brand" aria-hidden="true" />
      <input
        aria-label={label}
        name="title"
        value={title}
        placeholder="Add task…"
        autoComplete="off"
        enterKeyHint="done"
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") event.currentTarget.blur();
        }}
        className="min-w-0 flex-1 bg-transparent outline-none select-text placeholder:text-faint-foreground"
      />
      {aside}
    </form>
  );
};

const TotalChip = ({ minutes, over = false, title }: { minutes: number; over?: boolean; title: string }) => (
  <span
    title={title}
    className={cn(
      "inline-flex h-6 shrink-0 items-center rounded-md px-1.5 font-mono text-small transition-colors duration-(--dur-fast) ease-out",
      over ? "bg-negative/[0.12] text-negative" : "bg-foreground/[0.06] text-foreground/80",
    )}
  >
    <RollingNumber value={formatMinutes(minutes)} />
  </span>
);

const GhostRow = ({ ghost }: { ghost: PlanGhost }) => (
  <li
    data-plan-ghost={ghost.key}
    title="Repeats. This one is made on its day."
    className="flex items-start gap-3 rounded-xl px-3 py-2 opacity-80"
  >
    <span aria-hidden="true" className="mt-[3px] size-[18px] shrink-0 rounded-[6px] border-[1.5px] border-dashed border-foreground/25" />
    <span className="min-w-0 flex-1">
      <span className="block text-muted-foreground [overflow-wrap:anywhere]">
        <span className="sr-only">Repeats, not made yet: </span>
        {ghost.title}
      </span>
      <span className="flex items-center gap-1.5 text-small text-faint-foreground">
        <Repeat className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{repeatLabel(ghost.schedule, ghost.end)}</span>
        {ghost.area && <AreaDot colour={ghost.area.colour} className="ml-1" />}
      </span>
    </span>
    {ghost.estimateMinutes !== undefined && <EstimateChip minutes={ghost.estimateMinutes} className="mt-px opacity-60" />}
  </li>
);

const NO_GHOSTS: readonly PlanGhost[] = [];

const LONG_TITLE = 26;

const tileShape = (task: PlannerTask) =>
  `${task.context || task.notes || task.checklist.length > 0 || task.deadline ? "meta" : ""}${task.title.length > LONG_TITLE ? "long" : ""}`;

const PlanList = ({
  container,
  tasks,
  ghosts = NO_GHOSTS,
  left,
  slot,
  tileOn,
  label,
  empty,
  drawn = true,
}: {
  drawn?: boolean;
  container: string;
  tasks: readonly PlannerTask[];
  ghosts?: readonly PlanGhost[];
  left?: ReadonlyMap<string, number>;
  slot: string;
  tileOn: string;
  label: string;
  empty: string;
}) => {
  const rows = usePlacedRows(container, useHostedRows(tasks, slot, true));
  const { setNodeRef, isOver } = useDroppable({ id: container });
  const { today, onCard, cardOf } = useCardHost();
  const { openCard } = useShell();
  const list = useRef<HTMLUListElement>(null);
  const rowWindow = useRowWindow(list, rows, openCard?.key, tileShape);
  const [drawnFirst] = useState(drawn);
  const [drawnLater, setDrawnLater] = useState<ReadonlySet<string> | null>(null);
  if (drawn && !drawnFirst && drawnLater === null) setDrawnLater(new Set(rows.map((row) => row.key)));
  return (
    <SortableContext id={container} items={rows.map((row) => row.key)} strategy={verticalListSortingStrategy}>
      <ul
        ref={(node) => {
          setNodeRef(node);
          list.current = node;
        }}
        aria-label={label}
        data-sortable=""
        data-arrow-scope=""
        data-row-scroller=""
        data-plan-list={container}
        data-plan-scroll="lists"
        className="min-h-24 flex-1 overflow-y-auto overscroll-contain px-2 pt-1 pb-28 [scrollbar-width:thin]"
      >
        <AnimatePresence initial={false}>
          {rows.map((row, index) =>
            (drawn || row.key === openCard?.key) && rowWindow.shows(row, index) ? (
              <TaskItem
                key={row.key}
                itemKey={row.key}
                task={row.task}
                show={{ context: true, tileOn, tileLeft: left }}
                sortable
                today={today}
                card={cardOf(row.key)}
                onCard={onCard}
                settled={rowWindow.settled(row.key) || drawnLater?.has(row.key) === true}
              />
            ) : (
              <RowGap key={row.key} itemKey={row.key} task={row.task} height={rowWindow.gapHeight(row)} />
            ),
          )}
        </AnimatePresence>
        {ghosts.map((ghost) => (
          <GhostRow key={ghost.key} ghost={ghost} />
        ))}
        {rows.length === 0 && ghosts.length === 0 && (
          <li
            aria-hidden="true"
            className={cn(
              "grid h-16 place-items-center rounded-xl px-3 text-center text-small text-faint-foreground transition-[background-color] duration-(--dur-fast) ease-out",
              isOver && "bg-foreground/[0.04]",
            )}
          >
            {empty}
          </li>
        )}
      </ul>
    </SortableContext>
  );
};

export const BrainDump = ({ tasks, actions, className }: { tasks: readonly PlannerTask[]; actions: PlanActions; className?: string }) => {
  const total = tasks.reduce((sum, task) => sum + (task.estimateMinutes ?? 0), 0);
  return (
    <section aria-label="Brain Dump" {...placeAttr({ slot: PLANNER_SLOT, when: { kind: "inbox" } })} className={cn("min-h-0 flex-col", className)}>
      <header className="space-y-2 px-2 pb-2">
        <h2 className="flex h-8 items-center gap-2 px-3 text-heading font-semibold">
          Brain Dump
          <RollingNumber value={tasks.length} className="font-mono text-small font-normal text-faint-foreground" />
        </h2>
        <AddTask
          label="Add a Task to the Brain Dump"
          onAdd={(title) => actions.addTask(title, { kind: "inbox" }, PLANNER_SLOT)}
          aside={total > 0 && <TotalChip minutes={total} title="Estimated time waiting in the Brain Dump" />}
        />
      </header>
      <PlanList container={INBOX} tasks={tasks} slot={PLANNER_SLOT} tileOn="" label="Brain Dump Tasks" empty="Nothing waiting. Press N to capture a thought." />
    </section>
  );
};

export const DayColumn = ({
  day,
  today,
  actions,
  onSpread,
}: {
  day: PlanDay;
  today: IsoDate;
  actions: PlanActions;
  onSpread: (date: IsoDate) => void;
}) => {
  const over = day.planned + day.guessed - Math.max(0, day.free);
  const isToday = day.date === today;
  const column = useRef<HTMLElement>(null);
  const drawn = useDrawnNearView(column, inFirstView(day.date, today));
  return (
    <section
      ref={column}
      aria-label={longDay(day.date)}
      data-plan-day={day.date}
      {...placeAttr({ slot: daySlot(day.date), when: { kind: "scheduled", date: day.date, evening: false } })}
      className="flex min-h-0 w-[17.5rem] shrink-0 snap-start flex-col [content-visibility:auto] @max-4xl/planner:w-full">
      {drawn ? (
        <header className="space-y-2 px-2 pb-2">
          <DayHeader day={day} isToday={isToday} actions={actions} onSpread={onSpread} />
          <AddTask
            label={`Add a Task to ${longDay(day.date)}`}
            onAdd={(title) => actions.addTask(title, { kind: "scheduled", date: day.date, evening: false }, daySlot(day.date))}
            aside={day.planned + day.guessed > 0 && <TotalChip minutes={day.planned + day.guessed} over={over > 0} title="Planned time for this day" />}
          />
        </header>
      ) : (
        <header aria-hidden="true" className="h-[5.75rem] shrink-0" />
      )}
      <PlanList
        container={dayContainer(day.date)}
        tasks={day.tasks}
        ghosts={day.ghosts}
        left={day.left}
        slot={daySlot(day.date)}
        tileOn={day.date}
        label={`Day Plan for ${longDay(day.date)}`}
        empty={isToday ? "Drag a Task here to plan today." : "Nothing planned."}
        drawn={drawn}
      />
    </section>
  );
};
