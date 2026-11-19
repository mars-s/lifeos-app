"use client";

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DotsSixVertical } from "@phosphor-icons/react";
import { useId, useRef, type ReactNode } from "react";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";

export type RankItem = { key: string; label: string; content: ReactNode; trailing?: ReactNode };

const Row = ({ item, rank }: { item: RankItem; rank: number }) => {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.key });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "group/rank relative flex min-h-9 items-center gap-2 rounded-lg py-1 pr-1 pl-2 text-small",
        isDragging && "z-10 bg-popover shadow-lift",
      )}
    >
      <span aria-hidden="true" className="w-4 shrink-0 text-right font-mono text-micro text-faint-foreground tabular-nums">
        {rank}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2">{item.content}</span>
      {item.trailing}
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Move ${item.label}`}
        className="grid size-7 shrink-0 cursor-grab touch-none place-items-center rounded-md -outline-offset-2 text-faint-foreground transition-colors duration-(--dur-press) hover:text-muted-foreground active:cursor-grabbing"
      >
        <DotsSixVertical weight="bold" className="size-4" aria-hidden="true" />
      </button>
    </li>
  );
};

export const RankList = ({
  label,
  items,
  onMove,
  className,
}: {
  label: string;
  items: readonly RankItem[];
  onMove: (key: string, toIndex: number) => void;
  className?: string;
}) => {
  const dndId = useId();
  const over = useRef<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over: target }: DragEndEvent) => {
    over.current = null;
    haptic("drop");
    const toIndex = items.findIndex((item) => item.key === target?.id);
    if (toIndex !== -1 && target?.id !== active.id) onMove(String(active.id), toIndex);
  };
  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragOver={({ over: target }) => {
        const next = target ? String(target.id) : null;
        if (next !== over.current && over.current !== null) haptic("snap");
        over.current = next;
      }}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        over.current = null;
      }}
    >
      <SortableContext items={items.map((item) => item.key)} strategy={verticalListSortingStrategy}>
        <ol aria-label={label} className={cn("relative p-1", className)}>
          {items.map((item, index) => (
            <Row key={item.key} item={item} rank={index + 1} />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
};
