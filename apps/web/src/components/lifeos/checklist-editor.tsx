"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DotsSixVertical, Plus, X } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useId, useRef, useState, type Ref } from "react";
import { haptic } from "@/lib/haptics";
import { CSS_EASE_OUT, instant, springLayout } from "@/lib/motion-tokens";
import { cn } from "@/lib/utils";
import { TaskCheckbox } from "./task-row";

export type ChecklistEntry = { id: string; key: string; title: string; done: boolean };

type ItemActions = {
  onEdit: (id: string, title: string) => void;
  onTick: (id: string, done: boolean) => void;
  onRemove: (id: string) => void;
  marker?: (item: ChecklistEntry) => React.ReactNode;
};

const SORT_TRANSITION = { duration: 200, easing: CSS_EASE_OUT };

const focusSibling = (from: HTMLElement, step: 1 | -1) => {
  const fields = [...(from.closest("[data-checklist]")?.querySelectorAll<HTMLInputElement>("[data-checklist-field]") ?? [])];
  fields[fields.indexOf(from as HTMLInputElement) + step]?.focus();
};

const ItemRow = ({ item, onEdit, onTick, onRemove, marker }: { item: ChecklistEntry } & ItemActions) => {
  const reduce = useReducedMotion();
  const [draft, setDraft] = useState<string | null>(null);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.key,
    transition: reduce ? null : SORT_TRANSITION,
  });
  const title = draft ?? item.title;

  const commit = () => {
    if (draft === null) return;
    const next = draft.trim();
    setDraft(null);
    if (next === "") onRemove(item.id);
    else if (next !== item.title) onEdit(item.id, next);
  };

  return (
    <motion.li
      ref={setNodeRef}
      layout={false}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={reduce ? instant : springLayout}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("relative overflow-hidden rounded-lg", isDragging && "z-10 overflow-visible")}
    >
      <div
        className={cn(
          "group/item flex h-8 items-center gap-2.5 rounded-lg pr-0.5 pl-2 text-small transition-[background-color,box-shadow,scale] duration-(--dur-fast) ease-out has-[input:focus-visible]:bg-foreground/[0.05]",
          isDragging && "scale-[1.015] bg-popover shadow-lift",
        )}
      >
        {marker ? marker(item) : <TaskCheckbox size="sm" checked={item.done} onCheckedChange={(done) => onTick(item.id, done)} label={`Tick ${item.title}`} />}
        <span className="relative min-w-0 flex-1">
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none relative inline-block max-w-full truncate align-top whitespace-pre text-transparent select-none",
              "after:absolute after:inset-x-0 after:top-[52%] after:h-px after:origin-left after:bg-faint-foreground after:transition-transform after:duration-(--dur-slow) after:ease-out motion-reduce:after:transition-none",
              item.done && draft === null ? "after:scale-x-100" : "after:scale-x-0",
            )}
          >
            {title || " "}
          </span>
          <input
            data-checklist-field
            data-undo={draft === null ? "app" : undefined}
            aria-label={`Checklist Item: ${item.title}`}
            name="checklist-item-title"
            value={title}
            autoComplete="off"
            enterKeyHint="next"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
                event.preventDefault();
                focusSibling(event.currentTarget, 1);
              }
              if (event.key === "Backspace" && title === "") {
                event.preventDefault();
                focusSibling(event.currentTarget, -1);
              }
              if (event.key === "Escape" && draft !== null) {
                event.stopPropagation();
                setDraft(null);
              }
            }}
            className={cn(
              "absolute inset-0 w-full truncate bg-transparent outline-none transition-colors duration-(--dur-slow) ease-out",
              item.done ? "text-faint-foreground" : "text-foreground",
            )}
          />
        </span>
        <button
          type="button"
          aria-label={`Delete ${item.title}`}
          onClick={() => onRemove(item.id)}
          className="grid size-7 shrink-0 place-items-center rounded-md text-faint-foreground opacity-0 -outline-offset-2 transition-[opacity,color,background-color,scale] duration-(--dur-press) ease-out group-focus-within/item:opacity-100 group-hover/item:opacity-100 hover:bg-foreground/[0.06] hover:text-foreground focus-visible:opacity-100 active:scale-[0.9] [@media(hover:none)]:opacity-100"
        >
          <X weight="bold" className="size-3" aria-hidden="true" />
        </button>
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${item.title}`}
          className="grid size-7 shrink-0 cursor-grab touch-none place-items-center rounded-md -outline-offset-2 text-faint-foreground transition-colors duration-(--dur-press) hover:text-muted-foreground active:cursor-grabbing"
        >
          <DotsSixVertical weight="bold" className="size-4" aria-hidden="true" />
        </button>
      </div>
    </motion.li>
  );
};

export const ChecklistEditor = ({
  items,
  composerRef,
  onAdd,
  onMove,
  onComposerBlur,
  className,
  ...actions
}: {
  items: ChecklistEntry[];
  composerRef?: Ref<HTMLInputElement>;
  onAdd: (title: string) => Promise<boolean>;
  onMove: (id: string, toIndex: number) => void;
  onComposerBlur?: () => void;
  className?: string;
} & ItemActions) => {
  const dndId = useId();
  const [text, setText] = useState("");
  const overKey = useRef<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const add = () => {
    const title = text.trim();
    if (title === "") return;
    setText("");
    void onAdd(title).then((saved) => {
      if (!saved) setText((current) => (current === "" ? title : current));
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    overKey.current = null;
    haptic("drop");
    const moved = items.find((item) => item.key === active.id);
    const toIndex = items.findIndex((item) => item.key === over?.id);
    if (moved && toIndex !== -1 && over?.id !== active.id) onMove(moved.id, toIndex);
  };

  return (
    <div data-checklist className={cn("rounded-xl bg-foreground/[0.035] p-1", className)}>
      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        onDragOver={({ over }) => {
          const next = over ? String(over.id) : null;
          if (next !== overKey.current && overKey.current !== null) haptic("snap");
          overKey.current = next;
        }}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          overKey.current = null;
        }}
      >
        <SortableContext items={items.map((item) => item.key)} strategy={verticalListSortingStrategy}>
          <ul aria-label="Checklist">
            <AnimatePresence initial={false}>
              {items.map((item) => (
                <ItemRow key={item.key} item={item} {...actions} />
              ))}
            </AnimatePresence>
          </ul>
        </SortableContext>
      </DndContext>
      <label className="flex h-8 items-center gap-2.5 rounded-lg pr-2 pl-2 text-small transition-colors duration-(--dur-fast) ease-out has-[input:focus-visible]:bg-foreground/[0.05]">
        <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center rounded-full border-[1.5px] border-dashed border-foreground/25 text-faint-foreground">
          <Plus weight="bold" className="size-2.5" />
        </span>
        <input
          ref={composerRef}
          data-checklist-field
          data-undo={text === "" ? "app" : undefined}
          aria-label="Add a Checklist Item"
          name="checklist-item"
          value={text}
          placeholder={items.length === 0 ? "First step" : "Add a step"}
          autoComplete="off"
          enterKeyHint="enter"
          onChange={(event) => setText(event.target.value)}
          onBlur={() => {
            add();
            onComposerBlur?.();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
              event.preventDefault();
              add();
            }
            if (event.key === "Backspace" && text === "") focusSibling(event.currentTarget, -1);
            if (event.key === "Escape" && text !== "") {
              event.stopPropagation();
              setText("");
            }
          }}
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-faint-foreground"
        />
      </label>
    </div>
  );
};
