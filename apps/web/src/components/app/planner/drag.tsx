"use client";

import {
  DndContext,
  DragOverlay,
  MouseSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { generateKeyBetween } from "fractional-indexing";
import { useReducedMotion } from "motion/react";
import { Result } from "neverthrow";
import { createContext, use, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { IsoDate } from "@lifeos/backend/date";
import { blockMinutesFor } from "@lifeos/backend/plan";
import type { PlannerTask } from "@lifeos/backend/types";
import { AreaDot } from "@/components/lifeos/area";
import { SNAP_MINUTES, minuteAtPointer } from "@/components/lifeos/timebox";
import { EstimateChip } from "@/components/lifeos/task-row";
import { haptic } from "@/lib/haptics";
import { CSS_EASE_OUT } from "@/lib/motion-tokens";
import { cn } from "@/lib/utils";
import { useSelectionActions } from "../selection-actions";
import type { PlanActions } from "./actions";
import { INBOX, dateOfCal, dateOfDay } from "./model";

export type PlanRow = { key: string; task: PlannerTask };

type Hold = {
  key: string;
  task: PlannerTask;
  from: string;
  to: string;
  index: number;
  cal: { date: IsoDate; minute: number } | null;
};

type Registry = Map<string, readonly PlanRow[]>;

const DRAG_START_PX = 6;
const GRAB_OFFSET_MINUTES = 8;
const DAY_MINUTES = 24 * 60;
const DROP = { duration: 220, easing: CSS_EASE_OUT };

const DragContext = createContext<{ hold: Hold | null; registry: Registry } | null>(null);

const useDrag = () => {
  const drag = use(DragContext);
  if (!drag) throw new Error("Planner lists need the Planner drag layer around them.");
  return drag;
};

const keyBetween = Result.fromThrowable(generateKeyBetween, () => "unordered" as const);

export const usePlacedRows = (container: string, rows: readonly PlanRow[]) => {
  const { hold, registry } = useDrag();
  const placed = useMemo(() => {
    if (!hold || hold.cal || hold.from === hold.to) return rows;
    const without = rows.filter((row) => row.key !== hold.key);
    if (container === hold.to) return [...without.slice(0, hold.index), { key: hold.key, task: hold.task }, ...without.slice(hold.index)];
    return container === hold.from ? without : rows;
  }, [hold, rows, container]);
  useEffect(() => {
    registry.set(container, placed);
    return () => void registry.delete(container);
  }, [registry, container, placed]);
  return placed;
};

export const useGhost = () => {
  const { hold } = useDrag();
  return useMemo(
    () => (hold?.cal ? { ...hold.cal, minutes: blockMinutesFor(hold.task.estimateMinutes), task: hold.task } : null),
    [hold],
  );
};

const isList = (id: string) => id === INBOX || dateOfDay(id) !== null;

const collide: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  const cal = within.find((hit) => dateOfCal(String(hit.id)) !== null);
  if (cal) return [cal];
  const list = within.find((hit) => isList(String(hit.id)));
  if (!list) return [];
  const items = args.droppableContainers.filter((each) => each.data.current?.sortable?.containerId === list.id);
  return items.length === 0 ? [list] : closestCenter({ ...args, droppableContainers: items });
};

export const usePlanCommit = (today: IsoDate, actions: PlanActions) => {
  const tasksDo = useSelectionActions(today);
  return useMemo(
    () => (task: PlannerTask, from: string, to: string, rows: readonly PlanRow[]) => {
      const date = dateOfDay(to);
      if (date) {
        actions.place(task, date, rows.map((row) => row.task));
        return true;
      }
      if (from !== INBOX) {
        actions.toInbox(task);
        return true;
      }
      const at = rows.findIndex((row) => row.task._id === task._id);
      const order = keyBetween(rows[at - 1]?.task.order ?? null, rows[at + 1]?.task.order ?? null);
      if (order.isErr()) return false;
      tasksDo.reorder(task, order.value);
      return true;
    },
    [actions, tasksDo],
  );
};

const Lifted = ({ task, faded }: { task: PlannerTask; faded: boolean }) => (
  <div
    className={cn(
      "flex w-[16.5rem] cursor-grabbing items-start gap-3 rounded-xl bg-popover px-3 py-2 shadow-lift transition-[opacity,scale] duration-(--dur-fast) ease-out motion-reduce:transition-none",
      faded ? "scale-90 opacity-0" : "scale-[1.02]",
    )}
  >
    <span className="mt-[3px] size-[18px] shrink-0 rounded-[6px] border-[1.5px] border-foreground/30" />
    <span className="min-w-0 flex-1">
      <span className="line-clamp-2 break-words">{task.title}</span>
      {task.context && (
        <span className="flex items-center gap-1.5 text-small text-muted-foreground">
          {task.area && <AreaDot colour={task.area.colour} />}
          <span className="truncate">{task.context}</span>
        </span>
      )}
    </span>
    {task.estimateMinutes !== undefined && <EstimateChip minutes={task.estimateMinutes} />}
  </div>
);

export const PlannerDrag = ({
  today,
  actions,
  onBlock,
  children,
}: {
  today: IsoDate;
  actions: PlanActions;
  onBlock: (date: IsoDate) => void;
  children: ReactNode;
}) => {
  const reduce = useReducedMotion();
  const [hold, setHold] = useState<Hold | null>(null);
  const [registry] = useState<Registry>(() => new Map());
  const held = useRef<Hold | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const [landedOnCalendar, setLandedOnCalendar] = useState(false);
  const stripLeft = useRef(0);
  const commit = usePlanCommit(today, actions);
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: DRAG_START_PX } }));
  const context = useMemo(() => ({ hold, registry }), [hold, registry]);

  const keep = (next: Hold | null) => {
    held.current = next;
    setHold(next);
  };

  useEffect(() => {
    const follow = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
    };
    window.addEventListener("pointermove", follow, { passive: true });
    return () => window.removeEventListener("pointermove", follow);
  }, []);

  const autoScroll = useMemo(
    () => ({
      threshold: { x: 0.06, y: 0.16 },
      acceleration: 8,
      canScroll: (element: Element) => {
        if (!(element instanceof HTMLElement)) return false;
        if (held.current?.cal) return element.dataset.planScroll === "timebox";
        if (element.dataset.planScroll !== "lists") return false;
        if (element.dataset.planStrip === undefined) return true;
        const box = element.getBoundingClientRect();
        return pointer.current.x > box.left && pointer.current.x < box.right;
      },
    }),
    [],
  );

  const listOf = (key: string) => [...registry].find(([, rows]) => rows.some((row) => row.key === key))?.[0];

  const onDragStart = ({ active }: DragStartEvent) => {
    const key = String(active.id);
    const from = listOf(key);
    const rows = from ? registry.get(from) : undefined;
    const index = rows?.findIndex((row) => row.key === key) ?? -1;
    const task = rows?.[index]?.task;
    if (!from || !task) return;
    setLandedOnCalendar(false);
    stripLeft.current = document.querySelector("[data-plan-strip]")?.scrollLeft ?? 0;
    keep({ key, task, from, to: from, index, cal: null });
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    const current = held.current;
    if (!current || !over) return;
    const overId = String(over.id);
    if (dateOfCal(overId)) return;
    const target = isList(overId) ? overId : listOf(overId);
    if (!target || target === current.to) return;
    const rows = (registry.get(target) ?? []).filter((row) => row.key !== current.key);
    const overIndex = rows.findIndex((row) => row.key === overId);
    const lifted = active.rect.current.translated;
    const below = lifted !== null && lifted.top > over.rect.top + over.rect.height / 2;
    haptic("snap");
    keep({ ...current, to: target, index: overIndex === -1 ? rows.length : overIndex + (below ? 1 : 0), cal: null });
  };

  const onDragMove = ({ over }: { over: DragOverEvent["over"] }) => {
    const current = held.current;
    if (!current) return;
    const date = over ? dateOfCal(String(over.id)) : null;
    if (!date) {
      if (current.cal) keep({ ...current, cal: null });
      return;
    }
    const column = document.querySelector<HTMLElement>(`[data-cal-day="${date}"]`);
    if (!column) return;
    const minutes = blockMinutesFor(current.task.estimateMinutes);
    const raw = minuteAtPointer(pointer.current.y, column.getBoundingClientRect().top) - GRAB_OFFSET_MINUTES;
    const minute = Math.min(DAY_MINUTES - minutes, Math.max(0, Math.round(raw / SNAP_MINUTES) * SNAP_MINUTES));
    if (current.cal?.date === date && current.cal.minute === minute) return;
    haptic("snap");
    keep({ ...current, cal: { date, minute } });
  };

  const onDragEnd = ({ over }: DragEndEvent) => {
    const current = held.current;
    keep(null);
    if (!current) return;
    if (current.cal) {
      setLandedOnCalendar(true);
      haptic("drop");
      actions.createBlock(current.task, current.cal.date, current.cal.minute);
      document.querySelector("[data-plan-strip]")?.scrollTo({ left: stripLeft.current, behavior: reduce ? "auto" : "smooth" });
      onBlock(current.cal.date);
      return;
    }
    const rows = registry.get(current.to) ?? [];
    const from = rows.findIndex((row) => row.key === current.key);
    const overIndex = over ? rows.findIndex((row) => row.key === String(over.id)) : -1;
    const to = overIndex === -1 ? from : overIndex;
    if (from === -1 || (current.from === current.to && from === to)) return;
    haptic(commit(current.task, current.from, current.to, arrayMove([...rows], from, to)) ? "drop" : "error");
  };

  return (
    <DragContext value={context}>
      <DndContext
        sensors={sensors}
        collisionDetection={collide}
        autoScroll={autoScroll}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={() => keep(null)}
      >
        {children}
        {typeof document !== "undefined" &&
          createPortal(
            <DragOverlay dropAnimation={reduce || landedOnCalendar ? null : DROP} zIndex={60}>
              {hold ? <Lifted task={hold.task} faded={hold.cal !== null} /> : null}
            </DragOverlay>,
            document.body,
          )}
      </DndContext>
    </DragContext>
  );
};

export const usePlanRegistry = () => useDrag().registry;
