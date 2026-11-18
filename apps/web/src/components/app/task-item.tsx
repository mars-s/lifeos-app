"use client";

import { Archive, CalendarDots, ListChecks, Moon, Note, Play, Stack, Star, Tray, X, type Icon } from "@phosphor-icons/react";
import { DndContext, KeyboardSensor, MouseSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { generateKeyBetween } from "fractional-indexing";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Result } from "neverthrow";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { PlannerTask } from "@lifeos/backend/types";
import { AreaDot, areaVar } from "@/components/lifeos/area";
import { ActualMeter } from "@/components/lifeos/focus-timer";
import { ActualChip, DeadlineMarker, EstimateChip, TaskCheckbox } from "@/components/lifeos/task-row";
import { haptic } from "@/lib/haptics";
import { instant, springLayout } from "@/lib/motion-tokens";
import { cn } from "@/lib/utils";
import { clockTime, deadlineMark, isToday, localDate, shortDay, whenLabel } from "./dates";
import { drafts, isDraftTask, useDraftCount, useRows } from "./drafts";
import { FocusBadge, useActualMs, useFocusActions, useFocusOn } from "./focus";
import { PanelBoundary } from "./panel-boundary";
import { routeHref } from "./route";
import { selection, useLingering, useSelected } from "./selection";
import { useSelectionActions } from "./selection-actions";
import { useShell } from "./shell-context";
import { Linkified, TitleLinks } from "./linkified";
import { TaskCardBody, TitleField } from "./task-card-body";
import { useTaskActions } from "./task-actions";

const WHEN_ICON = {
  inbox: Tray,
  anytime: Stack,
  someday: Archive,
} as const satisfies Record<Exclude<PlannerTask["when"]["kind"], "scheduled">, Icon>;

const WhenGlyph = ({ task, today }: { task: PlannerTask; today: string }) => {
  const className = cn("size-4", isToday(task.when, today) ? "text-brand" : "text-muted-foreground");
  if (task.when.kind !== "scheduled") {
    const Glyph = WHEN_ICON[task.when.kind];
    return <Glyph weight="fill" className={className} aria-hidden="true" />;
  }
  if (!isToday(task.when, today)) return <CalendarDots weight="fill" className={className} aria-hidden="true" />;
  return task.when.evening ? (
    <Moon weight="fill" className={className} aria-hidden="true" />
  ) : (
    <Star weight="fill" className={className} aria-hidden="true" />
  );
};

const STATUS_BOX = "relative mt-[3px] grid size-[18px] shrink-0 place-items-center rounded-[6px]";

const StatusMark = ({ task }: { task: PlannerTask }) => (
  <>
      <span
        className={cn(
          "absolute inset-0 rounded-[inherit] border-[1.5px] transition-colors duration-(--dur-fast)",
          task.when.kind === "someday" && "border-dashed",
          task.status.kind === "completed" ? "border-transparent bg-brand" : "border-foreground/30",
          task.status.kind === "canceled" && "border-foreground/20 bg-foreground/[0.06]",
          task.status.kind === "open" && "group-hover/status:border-foreground/55",
        )}
      />
      {task.status.kind === "completed" && (
        <svg viewBox="0 0 18 18" aria-hidden="true" className="relative size-full text-brand-foreground">
          <path d="M5 9.5l2.7 2.7L13 6.7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {task.status.kind === "canceled" && <X weight="bold" className="relative size-2.5 text-muted-foreground" aria-hidden="true" />}
  </>
);

const StatusBox = ({ task, today }: { task: PlannerTask; today: string }) => {
  const lingering = useLingering(task._id);
  const actions = useSelectionActions(today);
  const { reopen } = useTaskActions(task, today);
  return task.status.kind === "open" ? (
    <TaskCheckbox
      checked={lingering}
      someday={task.when.kind === "someday"}
      label={`Complete ${task.title}`}
      onCheckedChange={(checked) => (checked ? actions.completeSoon([task]) : actions.keepOpen(task))}
      className="mt-[3px]"
    />
  ) : (
    <button
      type="button"
      aria-label={`Reopen ${task.title}`}
      onClick={() => {
        haptic("toggle");
        void reopen();
      }}
      className={cn(
        STATUS_BOX,
        "group/status outline-offset-4 transition-transform duration-(--dur-press) ease-out before:absolute before:-inset-2.5 active:scale-[0.9]",
      )}
    >
      <StatusMark task={task} />
    </button>
  );
};

const TimeChip = ({ task, className: wanted }: { task: PlannerTask; className?: string }) => {
  const className = cn(useFocusOn(task._id) && "hidden @sm:inline-flex", wanted);
  const actual = Math.floor(useActualMs(task) / 60_000);
  if (actual === 0) return task.estimateMinutes === undefined ? null : <EstimateChip minutes={task.estimateMinutes} className={className} />;
  return (
    <ActualChip
      actual={actual}
      estimate={task.estimateMinutes}
      className={className}
      meter={<ActualMeter size="sm" actual={actual} estimate={task.estimateMinutes} colour={task.area ? areaVar(task.area.colour) : undefined} />}
    />
  );
};

const RowFocus = ({ task }: { task: PlannerTask }) => {
  const active = useFocusOn(task._id);
  const { start } = useFocusActions();
  if (active) return <FocusBadge active={active} />;
  return (
    <button
      type="button"
      data-no-select
      aria-label={`Start a Focus Session on ${task.title}`}
      title="Start a Focus Session (F)"
      onClick={(event) => {
        if (event.detail > 0) haptic("toggle");
        start(task, event.detail === 0 ? "keyboard" : "pointer");
      }}
      className="relative hidden size-6 shrink-0 place-items-center rounded-full text-muted-foreground opacity-0 transition-[opacity,background-color,color,scale] duration-(--dur-press) ease-out before:absolute before:-inset-1.5 hover:bg-foreground/[0.08] hover:text-foreground focus-visible:opacity-100 active:scale-[0.9] @sm:grid [@media(hover:hover)]:group-hover/row:opacity-100 [@media(hover:none)]:hidden"
    >
      <Play weight="fill" className="size-3" aria-hidden="true" />
    </button>
  );
};

const ChecklistCount = ({ items }: { items: PlannerTask["checklist"] }) => (
  <span className="inline-flex shrink-0 items-center gap-1 font-mono text-micro text-faint-foreground">
    <ListChecks className="size-3.5" aria-hidden="true" />
    <span className="sr-only">Checklist </span>
    {items.filter((item) => item.done).length}/{items.length}
  </span>
);

const NotesText = ({ notes }: { notes: string }) =>
  notes && (
    <p className="text-small break-words whitespace-pre-wrap text-muted-foreground">
      <Linkified text={notes} />
    </p>
  );

const ClosedBody = ({ task, today }: { task: PlannerTask; today: string }) => (
    <div className="space-y-3 pt-1 pr-3 pb-3 pl-[2.625rem]">
      <TitleLinks title={task.title} />
      <NotesText notes={task.notes} />
      {task.checklist.length > 0 && (
        <ul aria-label="Checklist" className="-ml-2 rounded-xl bg-foreground/[0.035] p-1">
          {task.checklist.map((item) => (
            <li key={item._id} className="flex min-h-8 items-center gap-2.5 px-2 py-1 text-small">
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-4 shrink-0 place-items-center rounded-full border-[1.5px]",
                  item.done ? "border-transparent bg-brand text-brand-foreground" : "border-foreground/30",
                )}
              >
                {item.done && (
                  <svg viewBox="0 0 18 18" className="size-full">
                    <path d="M5 9.5l2.7 2.7L13 6.7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span className={cn("min-w-0 break-words", item.done && "text-faint-foreground line-through")}>
                {item.title}
                <span className="sr-only">{item.done ? ", done" : ", to do"}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="-ml-0.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="inline-flex h-7 items-center gap-1.5 text-small font-medium">
          <WhenGlyph task={task} today={today} />
          <span className="sr-only">When </span>
          {task.status.kind === "open" ? whenLabel(task.when, today) : `${task.status.kind === "completed" ? "Completed" : "Canceled"} ${shortDay(localDate(task.status.at))}`}
        </span>
        {task.area && (
          <span className="inline-flex h-6 max-w-full min-w-0 items-center gap-1.5 rounded-full bg-foreground/[0.06] px-2 text-small text-foreground/80">
            <AreaDot colour={task.area.colour} className="size-1.5" />
            <span className="truncate">{task.project?.title ?? task.area.title}</span>
          </span>
        )}
        {task.labels.map((label) => (
          <span key={label._id} className="inline-flex h-6 max-w-full min-w-0 items-center gap-1.5 rounded-full bg-foreground/[0.06] px-2 text-small text-foreground/80">
            <AreaDot colour={label.colour} className="size-1.5" />
            <span className="truncate">{label.name}</span>
          </span>
        ))}
        <span className="ml-auto flex items-center gap-3">
          {task.deadline && <DeadlineMarker deadline={deadlineMark(task.deadline, today)} className="[&>span:last-child]:inline" />}
          <TimeChip task={task} />
        </span>
      </div>
    </div>
);

const FOCUSABLE = "button:not(:disabled), input, textarea, a[href]";

const keepFocusInside = (event: React.KeyboardEvent, container: HTMLElement) => {
  const stops = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((stop) => stop.offsetParent !== null);
  const edge = event.shiftKey ? stops[0] : stops.at(-1);
  if (document.activeElement !== edge) return;
  event.preventDefault();
  (event.shiftKey ? stops.at(-1) : stops[0])?.focus();
};

const OUTSIDE_THE_CARD = "[data-radix-popper-content-wrapper], [data-toaster], [role=menu], [data-focus-pill]";

export type TaskItemShow = { context?: boolean; star?: boolean; when?: boolean; closedAt?: boolean };

const ROW_HIDDEN = { height: 0, opacity: 0, overflow: "hidden" };
const ROW_SHOWN = { height: "auto", opacity: 1, transitionEnd: { overflow: "visible" } };

const TaskItem = ({
  task,
  itemKey,
  show = {},
  sortable,
}: {
  task: PlannerTask;
  itemKey: string;
  show?: TaskItemShow;
  sortable: boolean;
}) => {
  const { today, openCard, setOpenCard } = useShell();
  const reduce = useReducedMotion();
  const container = useRef<HTMLLIElement>(null);
  const [closedByKey, setClosedByKey] = useState(false);
  const open = openCard?.key === itemKey;
  const selected = useSelected(itemKey) && !open;
  const lingering = useLingering(task._id);

  useEffect(() => selection.register(itemKey, task), [itemKey, task]);
  useEffect(() => () => selection.forget(itemKey), [itemKey]);
  const transition = reduce || openCard?.instant || (!open && closedByKey) ? instant : springLayout;
  const closed = task.status.kind !== "open";
  const editable = open && !closed;
  const plannedToday = task.workBlocks.find((block) => !block.done && localDate(block.start) === today);
  const unsaved = isDraftTask(task._id);
  const { setNodeRef, listeners, transform: dragOffset, transition: dragTransition, isDragging } = useSortable({
    id: itemKey,
    disabled: !sortable || open || unsaved,
  });

  const close = (byKey: boolean) => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && container.current?.contains(active)) active.blur();
    setClosedByKey(byKey);
    setOpenCard(null);
    if (byKey) requestAnimationFrame(() => container.current?.querySelector<HTMLElement>("[data-arrow-item]")?.focus({ preventScroll: true }));
  };
  const closeFromOutside = useEffectEvent((event: PointerEvent) => {
    if (event.target instanceof Node && container.current?.contains(event.target)) return;
    if (event.target instanceof Element && event.target.closest(OUTSIDE_THE_CARD)) return;
    close(false);
  });

  useEffect(() => {
    if (!open) return;
    document.addEventListener("pointerdown", closeFromOutside);
    return () => document.removeEventListener("pointerdown", closeFromOutside);
  }, [open]);

  return (
    <motion.li
      ref={container}
      data-task-key={itemKey}
      data-task-id={task._id}
      data-open-card={open ? "" : undefined}
      data-selected={selected ? "" : undefined}
      initial={ROW_HIDDEN}
      animate={ROW_SHOWN}
      exit={ROW_HIDDEN}
      transition={reduce || (unsaved && openCard?.instant) ? instant : springLayout}
      className={cn(isDragging && "relative z-10")}
    >
      <div
        ref={setNodeRef}
        {...listeners}
        style={{ transform: CSS.Translate.toString(dragOffset), transition: dragTransition }}
      >
      <motion.div
        initial={false}
        animate={{ marginTop: open ? 8 : 0, marginBottom: open ? 8 : 0 }}
        transition={transition}
        onKeyDown={(event) => {
          if (!open || !container.current?.contains(event.target as Node)) return;
          if (event.key === "Tab") keepFocusInside(event, container.current);
          if (event.key === "Escape" || (event.key === "Enter" && (event.metaKey || event.ctrlKey))) {
            event.preventDefault();
            event.stopPropagation();
            close(true);
          }
        }}
        className={cn(
          "group/row @container rounded-xl transition-[background-color,box-shadow] duration-(--dur-fast) ease-out",
          open || isDragging
            ? "bg-popover shadow-lift"
            : selected
              ? "task-selected bg-brand/[0.12] dark:bg-brand/[0.17]"
              : "hover:bg-foreground/[0.04] has-[[data-arrow-item]:focus-visible]:bg-foreground/[0.07]",
        )}
      >
        <div className="flex items-start gap-3 px-3 py-2">
          <StatusBox task={task} today={today} />
          {editable ? (
            <TitleField task={task} today={today} />
          ) : (
          <button
            type="button"
            data-arrow-item
            aria-expanded={open}
            onFocus={(event) => {
              if (event.currentTarget.matches(":focus-visible") && !selection.has(itemKey)) selection.only(itemKey);
            }}
            onClick={(event) => {
              if (event.detail !== 0) return;
              setClosedByKey(true);
              setOpenCard(open ? null : { key: itemKey, instant: true });
            }}
            className="min-w-0 flex-1 rounded-md text-left outline-none"
          >
            <span className="flex items-center gap-1.5">
              {show.star && isToday(task.when, today) && (
                <>
                  <Star weight="fill" className="size-3.5 shrink-0 text-brand" aria-hidden="true" />
                  <span className="sr-only">In Today: </span>
                </>
              )}
              <span
                className={cn(
                  "min-w-0",
                  open ? "font-medium break-words" : "truncate",
                  "transition-colors duration-(--dur-slow) ease-out",
                  !open && (task.when.kind === "someday" || closed) && "text-muted-foreground",
                  lingering && "text-faint-foreground",
                  task.status.kind === "canceled" && "line-through",
                )}
              >
                {task.title}
              </span>
              {!open && task.notes && (
                <>
                  <Note className="size-3.5 shrink-0 text-faint-foreground" aria-hidden="true" />
                  <span className="sr-only">, has notes</span>
                </>
              )}
              {!open && task.checklist.length > 0 && <ChecklistCount items={task.checklist} />}
            </span>
            {!open && ((show.context && task.context) || (task.deadline && !closed)) && (
              <span
                className={cn(
                  "flex items-center gap-1.5 text-small text-muted-foreground",
                  !(show.context && task.context) && "@md:hidden",
                )}
              >
                {show.context && task.context && (
                  <>
                    {task.area && <AreaDot colour={task.area.colour} />}
                    <span className="truncate">{task.context}</span>
                    {task.project && task.area && <span className="hidden shrink-0 text-faint-foreground @md:inline">{task.area.title}</span>}
                  </>
                )}
                {task.deadline && !closed && <DeadlineMarker deadline={deadlineMark(task.deadline, today)} className="ml-auto @md:hidden" />}
              </span>
            )}
          </button>
          )}
          {!open && (
            <span className="flex shrink-0 items-center gap-3 pt-px">
              {!closed && !unsaved && <RowFocus task={task} />}
              {show.when && task.when.kind === "scheduled" && !isToday(task.when, today) && (
                <span className="hidden text-small text-muted-foreground @sm:inline">{whenLabel(task.when, today)}</span>
              )}
              {task.deadline && !closed && <DeadlineMarker deadline={deadlineMark(task.deadline, today)} className="hidden @md:inline-flex" />}
              {plannedToday && !closed && (
                <span title="Planned start" className="hidden font-mono text-small text-muted-foreground @sm:inline">
                  <span className="sr-only">Planned for </span>
                  {clockTime(plannedToday.start)}
                </span>
              )}
              <TimeChip task={task} className={cn(closed && "hidden opacity-60 @md:inline-flex")} />
              {show.closedAt && task.status.kind !== "open" && (
                <time dateTime={new Date(task.status.at).toISOString()} className="w-[4.5rem] text-right font-mono text-small text-faint-foreground">
                  {clockTime(task.status.at)}
                </time>
              )}
            </span>
          )}
        </div>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={transition}
              className="overflow-hidden"
            >
              {closed ? (
                <ClosedBody task={task} today={today} />
              ) : (
                <PanelBoundary panel="card" variant="inline">
                  <TaskCardBody task={task} today={today} />
                </PanelBoundary>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
      </div>
    </motion.li>
  );
};

const DRAG_START_PX = 6;
const DRAG_MODIFIERS = [restrictToVerticalAxis];

const keyBetween = Result.fromThrowable(generateKeyBetween, () => "unordered" as const);

export const useHasDrafts = () => useDraftCount(routeHref(useShell().route)) > 0;

export const TaskItems = ({
  tasks,
  show,
  className,
  hostsDrafts,
  sortable = false,
}: {
  tasks: readonly PlannerTask[];
  show?: TaskItemShow;
  className?: string;
  hostsDrafts?: "inline" | "above";
  sortable?: boolean;
}) => {
  const { route, today, openCard, setOpenCard } = useShell();
  const actions = useSelectionActions(today);
  const rows = useRows(tasks, hostsDrafts ? routeHref(route) : undefined);
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: DRAG_START_PX } }), useSensor(KeyboardSensor));
  const shown = hostsDrafts === "inline" ? rows.filter(({ task }) => isDraftTask(task._id) || tasks.includes(task)) : rows;
  const vanished = rows.find((row) => !shown.includes(row))?.key;

  useEffect(() => {
    if (!vanished) return;
    drafts.failed(vanished);
    if (openCard?.key === vanished) setOpenCard(null);
  }, [vanished, openCard, setOpenCard]);

  const place = (key: string, to: number) => {
    const moved = shown.find((row) => row.key === key);
    const others = shown.filter((row) => row.key !== key);
    if (!moved || to < 0 || to > others.length) return false;
    const order = keyBetween(others[to - 1]?.task.order ?? null, others[to]?.task.order ?? null);
    if (order.isErr()) return false;
    actions.reorder(moved.task, order.value);
    return true;
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    if (place(String(active.id), shown.findIndex((row) => row.key === over.id))) haptic("drop");
    else haptic("error");
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={DRAG_MODIFIERS} onDragEnd={onDragEnd}>
      <SortableContext items={shown.map((row) => row.key)} strategy={verticalListSortingStrategy}>
        <ul
          data-sortable={sortable ? "" : undefined}
          className={cn("-mx-3", className)}
          onKeyDown={(event) => {
            const step = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
            if (!sortable || step === 0 || !(event.metaKey || event.ctrlKey) || openCard) return;
            const key = (event.target as HTMLElement).closest<HTMLElement>("[data-task-key]")?.dataset.taskKey;
            const from = shown.findIndex((row) => row.key === key);
            if (!key || from === -1) return;
            event.preventDefault();
            place(key, from + step);
          }}
        >
          <AnimatePresence initial={false}>
            {shown.map(({ key, task }) => (
              <TaskItem key={key} itemKey={key} task={task} show={show} sortable={sortable} />
            ))}
          </AnimatePresence>
        </ul>
      </SortableContext>
    </DndContext>
  );
};
