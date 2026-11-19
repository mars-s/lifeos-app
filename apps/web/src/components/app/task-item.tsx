"use client";

import { Archive, CalendarDots, ListChecks, Moon, Note, Repeat, Stack, Star, Tray, X, type Icon } from "@phosphor-icons/react";
import { DndContext, KeyboardSensor, MouseSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { generateKeyBetween } from "fractional-indexing";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Result } from "neverthrow";
import { memo, useCallback, useEffect, useEffectEvent, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { PlannerTask, TaskRepeat } from "@lifeos/backend/types";
import { AreaDot, areaVar } from "@/components/lifeos/area";
import { formatMinutes } from "@/components/lifeos/format";
import { ActualMeter } from "@/components/lifeos/focus-timer";
import { lowerFirst, repeatLabel } from "@/components/lifeos/repeat";
import { ActualChip, DeadlineMarker, EstimateChip, TaskCheckbox } from "@/components/lifeos/task-row";
import { AnchoredPopover, type AnchoredPopoverProps } from "@/components/ui/popover-panel";
import { haptic } from "@/lib/haptics";
import { instant, springLayout } from "@/lib/motion-tokens";
import { cn } from "@/lib/utils";
import { clockTime, deadlineMark, isToday, localDate, shortDay, whenLabel } from "./dates";
import { drafts, isDraftTask, useDraftCount, useRows } from "./drafts";
import { FocusBadge, useActualMs, useFocusOn } from "./focus";
import { PanelBoundary } from "./panel-boundary";
import { routeHref } from "./route";
import { RowGap, useRowWindow } from "./row-window";
import { selection, useLingering, useRegisteredTask, useSelected } from "./selection";
import { useSelectionActions } from "./selection-actions";
import { useShell, type OpenCard } from "./shell-context";
import { Linkified, TitleLinks } from "./linkified";
import { TaskCardBody, TitleField } from "./task-card-body";
import { TaskEstimateField } from "./smart-estimate";
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

const TimeChip = ({ task, className: wanted, plain = false }: { task: PlannerTask; className?: string; plain?: boolean }) => {
  const className = cn(useFocusOn(task._id) && "hidden @sm:inline-flex", wanted);
  const actual = Math.floor(useActualMs(task) / 60_000);
  if (actual === 0) return task.estimateMinutes === undefined ? null : <EstimateChip minutes={task.estimateMinutes} className={className} />;
  return (
    <ActualChip
      actual={actual}
      estimate={task.estimateMinutes}
      className={className}
      meter={plain ? null : <ActualMeter size="sm" actual={actual} estimate={task.estimateMinutes} colour={task.area ? areaVar(task.area.colour) : undefined} />}
    />
  );
};

type EstimatePanel = "unused" | "closed" | "open";

const EstimatePopover = ({
  task,
  today,
  ...popover
}: { task: PlannerTask; today: string } & Pick<AnchoredPopoverProps, "anchor" | "id" | "open" | "onOpenChange" | "viaKeyboard">) => {
  const actions = useSelectionActions(today);
  return (
    <AnchoredPopover {...popover} title="Estimate" side="bottom" align="end" className="w-64">
      <TaskEstimateField task={task} onChange={(minutes) => actions.setEstimate([task], minutes)} />
    </AnchoredPopover>
  );
};

const EstimateEdit = ({ task, today }: { task: PlannerTask; today: string }) => {
  const idle = Math.floor(useActualMs(task) / 60_000) === 0;
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const [panel, setPanel] = useState<EstimatePanel>("unused");
  const [viaKeyboard, setViaKeyboard] = useState(false);
  const open = panel === "open";
  return (
    <>
      <button
        ref={button}
        type="button"
        data-no-select
        data-state={open ? "open" : "closed"}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={task.estimateMinutes === undefined ? `Set an Estimate for ${task.title}` : `Change the Estimate for ${task.title}`}
        onPointerDown={() => setViaKeyboard(false)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") setViaKeyboard(true);
        }}
        onClick={() => setPanel(open ? "closed" : "open")}
        className="relative flex h-6 shrink-0 items-center rounded-md outline-offset-2 transition-[scale,opacity] duration-(--dur-press) ease-out before:absolute before:-inset-1.5 active:scale-[0.94]"
      >
        {task.estimateMinutes === undefined && idle ? (
          <span className="inline-flex h-6 items-center rounded-md px-1.5 font-mono text-small text-faint-foreground opacity-0 transition-opacity duration-(--dur-fast) ease-out group-hover/row:opacity-100 group-has-[:focus-visible]/row:opacity-100 [@media(hover:none)]:opacity-100">
            0:00
          </span>
        ) : (
          <TimeChip task={task} plain />
        )}
      </button>
      {panel !== "unused" && (
        <EstimatePopover
          task={task}
          today={today}
          anchor={button}
          id={panelId}
          open={open}
          onOpenChange={(next) => setPanel(next ? "open" : "closed")}
          viaKeyboard={viaKeyboard}
        />
      )}
    </>
  );
};

const RowFocus = ({ task }: { task: PlannerTask }) => {
  const active = useFocusOn(task._id);
  return active ? <FocusBadge active={active} /> : null;
};

const TileMeta = ({ task, today, planned, left }: { task: PlannerTask; today: string; planned: number | undefined; left: number | undefined }) =>
  (task.context || task.notes || task.checklist.length > 0 || planned !== undefined || task.deadline || left !== undefined) && (
    <span className="flex w-full flex-wrap items-center gap-x-2.5 gap-y-0.5 pl-[1.875rem] text-small text-muted-foreground">
      {task.context && (
        <span className="flex max-w-full min-w-0 items-center gap-1.5">
          {task.area && <AreaDot colour={task.area.colour} />}
          <span className="truncate">{task.context}</span>
        </span>
      )}
      {planned !== undefined && (
        <span title="Planned start" className="shrink-0 font-mono text-faint-foreground">
          <span className="sr-only">Planned for </span>
          {clockTime(planned)}
        </span>
      )}
      {left !== undefined && (
        <span title="Counted on this day up to one day's share. The rest is left for other days." className="shrink-0 font-mono text-faint-foreground">
          {formatMinutes(left)} left
        </span>
      )}
      {task.notes && (
        <>
          <Note className="size-3.5 shrink-0 text-faint-foreground" aria-hidden="true" />
          <span className="sr-only">Has notes</span>
        </>
      )}
      {task.checklist.length > 0 && <ChecklistCount items={task.checklist} />}
      {task.deadline && <DeadlineMarker deadline={deadlineMark(task.deadline, today)} />}
    </span>
  );

const ChecklistCount = ({ items }: { items: PlannerTask["checklist"] }) => (
  <span className="inline-flex shrink-0 items-center gap-1 font-mono text-micro text-faint-foreground">
    <ListChecks className="size-3.5" aria-hidden="true" />
    <span className="sr-only">Checklist </span>
    {items.filter((item) => item.done).length}/{items.length}
  </span>
);

export const RepeatMark = ({ repeat }: { repeat: Pick<TaskRepeat, "schedule" | "end"> }) => {
  const text = `Repeats ${lowerFirst(repeatLabel(repeat.schedule, repeat.end))}`;
  return (
    <span title={text} className="inline-flex shrink-0 text-faint-foreground">
      <Repeat className="size-3.5" aria-hidden="true" />
      <span className="sr-only">, {lowerFirst(text)}</span>
    </span>
  );
};

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

export type TaskItemShow = {
  context?: boolean;
  star?: boolean;
  when?: boolean;
  closedAt?: boolean;
  tileOn?: string;
  tileLeft?: ReadonlyMap<string, number>;
};

const ROW_HIDDEN = { height: 0, opacity: 0, overflow: "hidden" };
const ROW_SHOWN = { height: "auto", opacity: 1, transitionEnd: { overflow: "visible" } };

const NO_SHOW: TaskItemShow = {};

type CardState = "closed" | "snapped" | "open" | "instant";

type TaskItemProps = {
  task: PlannerTask;
  itemKey: string;
  show?: TaskItemShow;
  sortable: boolean;
  today: string;
  card: CardState;
  onCard: (card: OpenCard | null) => void;
  settled?: boolean;
};

const isShut = (card: CardState) => card === "closed" || card === "snapped";

export const useCardHost = () => {
  const { today, openCard, setOpenCard } = useShell();
  const latest = useRef(setOpenCard);
  useEffect(() => {
    latest.current = setOpenCard;
  }, [setOpenCard]);
  const onCard = useCallback((card: OpenCard | null) => latest.current(card), []);
  const cardOf = (key: string) =>
    (openCard?.key === key ? (openCard.instant ? "instant" : "open") : openCard?.instant ? "snapped" : "closed") satisfies CardState;
  return { today, onCard, cardOf };
};

const SortableRow = ({ id, disabled, children }: { id: string; disabled: boolean; children: ReactNode }) => {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id, disabled });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      data-dragging={isDragging ? "" : undefined}
      className="group/sort"
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      {children}
    </div>
  );
};

const sameFields = (a: object, b: object) => {
  const keys = Object.keys(a) as (keyof typeof a)[];
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
};

const sameRow = (before: TaskItemProps, after: TaskItemProps) => {
  const { show: { tileLeft: leftBefore, ...shownBefore } = NO_SHOW, card: cardBefore, settled: _settledBefore, ...restBefore } = before;
  const { show: { tileLeft: leftAfter, ...shownAfter } = NO_SHOW, card: cardAfter, settled: _settledAfter, ...restAfter } = after;
  const sameCard = cardBefore === cardAfter || (isShut(cardBefore) && isShut(cardAfter));
  const sameLeft = leftBefore?.get(before.task._id) === leftAfter?.get(after.task._id);
  return sameCard && sameLeft && sameFields(restBefore, restAfter) && sameFields(shownBefore, shownAfter);
};

const TaskItemRow = ({ task, itemKey, show = NO_SHOW, sortable, today, card, onCard: setOpenCard, settled = false }: TaskItemProps) => {
  const reduce = useReducedMotion();
  const container = useRef<HTMLLIElement>(null);
  const [closedByKey, setClosedByKey] = useState(false);
  const open = !isShut(card);
  const quick = card === "instant" || card === "snapped";
  const selected = useSelected(itemKey) && !open;
  const lingering = useLingering(task._id);

  useRegisteredTask(itemKey, task);
  const transition = reduce || quick || (!open && closedByKey) ? instant : springLayout;
  const closed = task.status.kind !== "open";
  const editable = open && !closed;
  const tile = show.tileOn !== undefined;
  const plannedToday = task.workBlocks.find((block) => !block.done && localDate(block.start) === (show.tileOn || today));
  const unsaved = isDraftTask(task._id);
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

  const dismiss = (byKey: boolean) => {
    const back = drafts.discard(itemKey);
    close(byKey);
    if (back) requestAnimationFrame(() => back.focus({ preventScroll: true }));
  };
  const escapeFromNowhere = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented || event.target !== document.body) return;
    if (document.querySelector("[role=dialog], [role=menu], [role=alertdialog]")) return;
    event.preventDefault();
    dismiss(true);
  });

  useEffect(() => {
    if (!open) return;
    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", escapeFromNowhere);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", escapeFromNowhere);
    };
  }, [open]);

  return (
    <motion.li
      ref={container}
      data-task-key={itemKey}
      data-task-id={task._id}
      data-open-card={open ? "" : undefined}
      data-selected={selected ? "" : undefined}
      initial={settled ? false : ROW_HIDDEN}
      animate={ROW_SHOWN}
      exit={ROW_HIDDEN}
      transition={reduce || (unsaved && quick) ? instant : springLayout}
      onAnimationComplete={() => {
        if (open && unsaved) container.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
      }}
      className={cn("has-[>[data-dragging]]:relative has-[>[data-dragging]]:z-10", tile && "pb-1.5")}
    >
      <SortableRow id={itemKey} disabled={!sortable || open || unsaved}>
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
            if (event.key === "Escape") dismiss(true);
            else close(true);
          }
        }}
        className={cn(
          "group/row @container rounded-xl transition-[background-color,box-shadow] duration-(--dur-fast) ease-out group-data-[dragging]/sort:rounded-xl!",
          tile
            ? "group-data-[dragging]/sort:bg-foreground/[0.04]! group-data-[dragging]/sort:opacity-40"
            : "group-data-[dragging]/sort:bg-popover! group-data-[dragging]/sort:shadow-lift!",
          open
            ? "bg-popover shadow-lift"
            : selected
              ? "task-selected bg-brand/[0.12] dark:bg-brand/[0.17]"
              : tile
                ? "bg-foreground/[0.035] hover:bg-foreground/[0.06] has-[[data-arrow-item]:focus-visible]:bg-foreground/[0.085]"
                : "hover:bg-foreground/[0.04] has-[[data-arrow-item]:focus-visible]:bg-foreground/[0.07]",
        )}
      >
        <div className={cn("flex items-start gap-x-3 px-3 py-2", tile && !open && "flex-wrap gap-y-0.5")}>
          <StatusBox task={task} today={today} />
          {editable ? (
            <TitleField task={task} today={today} onCreated={() => close(true)} />
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
            {tile && !open && !closed ? (
              <span className="line-clamp-2 break-words">{task.title}</span>
            ) : (
              <>
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
              {!open && task.repeat?.active && <RepeatMark repeat={task.repeat} />}
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
              </>
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
              {tile && !closed ? <EstimateEdit task={task} today={today} /> : <TimeChip task={task} className={cn(closed && "hidden opacity-60 @md:inline-flex")} />}
              {show.closedAt && task.status.kind !== "open" && (
                <time dateTime={new Date(task.status.at).toISOString()} className="w-[4.5rem] text-right font-mono text-small text-faint-foreground">
                  {clockTime(task.status.at)}
                </time>
              )}
            </span>
          )}
          {tile && !open && !closed && <TileMeta task={task} today={today} planned={plannedToday?.start} left={show.tileLeft?.get(task._id)} />}
        </div>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div initial={ROW_HIDDEN} animate={ROW_SHOWN} exit={ROW_HIDDEN} transition={transition}>
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
      </SortableRow>
    </motion.li>
  );
};

export const TaskItem = memo(TaskItemRow, sameRow);

const DRAG_START_PX = 6;
const DRAG_MODIFIERS = [restrictToVerticalAxis];

const keyBetween = Result.fromThrowable(generateKeyBetween, () => "unordered" as const);

export const useHasDrafts = () => useDraftCount(routeHref(useShell().route)) > 0;

export const useHostedRows = (tasks: readonly PlannerTask[], slot: string | undefined, inline: boolean) => {
  const { closeCard } = useShell();
  const rows = useRows(tasks, slot);
  const shown = useMemo(() => {
    if (!inline) return rows;
    const listed = new Set(tasks);
    return rows.filter(({ task }) => isDraftTask(task._id) || listed.has(task));
  }, [rows, tasks, inline]);
  const vanished = shown.length === rows.length ? undefined : rows.find((row) => !shown.includes(row))?.key;

  useEffect(() => {
    if (!vanished) return;
    drafts.failed(vanished);
    closeCard(vanished);
  }, [vanished, closeCard]);

  return shown;
};

export const TaskItems = ({
  tasks,
  show,
  className,
  hostsDrafts,
  slot,
  sortable = false,
}: {
  tasks: readonly PlannerTask[];
  show?: TaskItemShow;
  className?: string;
  hostsDrafts?: "inline" | "above";
  slot?: string;
  sortable?: boolean;
}) => {
  const { route, openCard } = useShell();
  const { today, onCard, cardOf } = useCardHost();
  const actions = useSelectionActions(today);
  const shown = useHostedRows(tasks, hostsDrafts ? (slot ?? routeHref(route)) : undefined, hostsDrafts === "inline");
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: DRAG_START_PX } }), useSensor(KeyboardSensor));
  const list = useRef<HTMLUListElement>(null);
  const rowWindow = useRowWindow(list, shown, openCard?.key, (task) => `${show?.context && task.context ? "context" : ""}${task.deadline ? "deadline" : ""}`);
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
          ref={list}
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
            {shown.map((row, index) =>
              rowWindow.shows(row, index) ? (
                <TaskItem
                  key={row.key}
                  itemKey={row.key}
                  task={row.task}
                  show={show}
                  sortable={sortable}
                  today={today}
                  card={cardOf(row.key)}
                  onCard={onCard}
                  settled={rowWindow.settled(row.key)}
                />
              ) : (
                <RowGap key={row.key} itemKey={row.key} task={row.task} height={rowWindow.gapHeight(row)} />
              ),
            )}
          </AnimatePresence>
        </ul>
      </SortableContext>
    </DndContext>
  );
};
