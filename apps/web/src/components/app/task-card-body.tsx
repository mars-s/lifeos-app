"use client";

import { ListChecks } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@lifeos/backend/api";
import type { PlannerTask } from "@lifeos/backend/types";
import { AreaDot } from "@/components/lifeos/area";
import { ChecklistEditor } from "@/components/lifeos/checklist-editor";
import { DeadlinePicker, WhenPicker } from "@/components/lifeos/date-pickers";
import { EstimateField } from "@/components/lifeos/estimate-field";
import { LabelPicker } from "@/components/lifeos/label-picker";
import { ToolButton } from "@/components/lifeos/tool-button";
import { WorkBlockList } from "@/components/lifeos/work-blocks";
import { instant, springLayout } from "@/lib/motion-tokens";
import { deadlineMark, localDate, relativeDay, shortDay, whenLabel } from "./dates";
import { useQuietView } from "./hooks";
import { Linkified, TitleLinks } from "./linkified";
import { isOptimistic, useTaskActions } from "./task-actions";

type KnownKeys = ReadonlyMap<string, { key: string; order: string }>;

const reconcileKeys = (known: KnownKeys, items: PlannerTask["checklist"]) => {
  const live = new Set<string>(items.map((item) => item._id));
  const adopted = (order: string) =>
    [...known].find(([id, entry]) => isOptimistic(id) && !live.has(id) && entry.order === order)?.[1].key;
  const next = new Map(
    items.map((item) => [item._id, { key: known.get(item._id)?.key ?? adopted(item.order) ?? item._id, order: item.order }]),
  );
  const same = next.size === known.size && [...next].every(([id, entry]) => known.get(id)?.order === entry.order);
  return same ? known : next;
};

const useStableKeys = (items: PlannerTask["checklist"]) => {
  const [known, setKnown] = useState<KnownKeys>(new Map());
  const keys = reconcileKeys(known, items);
  if (keys !== known) setKnown(keys);
  return items.map((item) => ({ id: item._id, key: keys.get(item._id)?.key ?? item._id, title: item.title, done: item.done }));
};

const Chip = ({ colour, children }: { colour: PlannerTask["labels"][number]["colour"]; children: ReactNode }) => (
  <span className="inline-flex h-6 max-w-full min-w-0 items-center gap-1.5 rounded-full bg-foreground/[0.06] px-2 text-small text-foreground/80">
    <AreaDot colour={colour} className="size-1.5 transition-[background-color] duration-(--dur-fast)" />
    <span className="truncate">{children}</span>
  </span>
);

const draftField = "block w-full bg-transparent outline-none placeholder:text-faint-foreground";

export const TitleField = ({ task, today }: { task: PlannerTask; today: string }) => {
  const { rename } = useTaskActions(task, today);
  const [draft, setDraft] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    field.current?.focus({ preventScroll: true });
    if (field.current?.value === "New Task") field.current.select();
  }, []);
  const commit = () => {
    const next = draft?.trim();
    setDraft(null);
    if (next && next !== task.title) rename(next);
  };
  return (
    <input
      ref={field}
      aria-label="Title"
      name="title"
      data-undo={draft === null ? "app" : undefined}
      value={draft ?? task.title}
      placeholder="New Task"
      autoComplete="off"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) event.currentTarget.blur();
      }}
      className={`${draftField} min-w-0 flex-1 font-medium`}
    />
  );
};

export const NotesField = ({ notes, onSave }: { notes: string; onSave: (notes: string) => void }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editing) field.current?.focus({ preventScroll: true });
  }, [editing]);
  if (!editing && notes !== "") {
    return (
      <p
        role="textbox"
        aria-label="Notes"
        aria-multiline="true"
        tabIndex={0}
        onFocus={(event) => {
          if (event.target === event.currentTarget) setEditing(true);
        }}
        className="cursor-text text-small break-words whitespace-pre-wrap text-muted-foreground outline-none"
      >
        <Linkified text={notes} />
      </p>
    );
  }
  return (
    <textarea
      ref={field}
      aria-label="Notes"
      name="notes"
      autoComplete="off"
      data-undo={draft === null ? "app" : undefined}
      rows={1}
      value={draft ?? notes}
      placeholder="Notes"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== null && draft !== notes) onSave(draft);
        setDraft(null);
        setEditing(false);
      }}
      className={`${draftField} field-sizing-content min-h-5 resize-none text-small break-words text-muted-foreground`}
    />
  );
};

export const TaskCardBody = ({ task, today }: { task: PlannerTask; today: string }) => {
  const reduce = useReducedMotion();
  const actions = useTaskActions(task, today);
  const labels = useQuietView(api.planner.labels.list, {}) ?? task.labels;
  const items = useStableKeys(task.checklist);
  const [composing, setComposing] = useState(false);
  const composer = useRef<HTMLInputElement>(null);
  const hasChecklist = task.checklist.length > 0 || composing;
  const deadline = task.deadline ? deadlineMark(task.deadline, today) : undefined;

  useEffect(() => {
    if (composing) composer.current?.focus({ preventScroll: true });
  }, [composing]);

  return (
    <div data-arrow-scope className="space-y-3 pt-1 pr-3 pb-3 pl-[2.625rem]">
      <TitleLinks title={task.title} />
      <NotesField notes={task.notes} onSave={actions.setNotes} />
      <AnimatePresence initial={false}>
        {hasChecklist && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduce ? instant : springLayout}
            className="-ml-2 overflow-hidden"
          >
            <ChecklistEditor
              items={items}
              composerRef={composer}
              onAdd={actions.addItem}
              onEdit={actions.editItem}
              onTick={actions.tickItem}
              onMove={actions.moveItem}
              onRemove={actions.removeItem}
              onComposerBlur={() => setComposing(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>
      {task.workBlocks.length > 0 && (
        <WorkBlockList
          colour={task.area?.colour}
          blocks={task.workBlocks.map((block) => {
            const start = new Date(block.start);
            const day = localDate(block.start);
            return {
              id: block._id,
              day: relativeDay(day, today) ?? shortDay(day),
              startMinute: start.getHours() * 60 + start.getMinutes(),
              minutes: block.minutes,
              done: block.done,
            };
          })}
        />
      )}
      <EstimateField minutes={task.estimateMinutes} onChange={(minutes) => void actions.setEstimate(minutes)} />
      <div className="-ml-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
        <WhenPicker when={task.when} label={whenLabel(task.when, today)} today={today} onChange={actions.setWhen} />
        {task.area && <Chip colour={task.area.colour}>{task.project?.title ?? task.area.title}</Chip>}
        {task.labels.map((label) => (
          <Chip key={label._id} colour={label.colour}>
            {label.name}
          </Chip>
        ))}
        <span className="ml-auto flex items-center gap-0.5">
          <LabelPicker
            labels={labels.map((label) => ({ id: label._id, name: label.name, colour: label.colour }))}
            selected={task.labelIds}
            onToggle={({ id }) => {
              const label = labels.find((entry) => entry._id === id);
              if (label) actions.toggleLabel(label);
            }}
            onCreate={actions.createLabel}
            onColour={({ id }, colour) => {
              const label = labels.find((entry) => entry._id === id);
              if (label) actions.recolourLabel(label, colour);
            }}
            onRename={({ id }, name) => {
              const label = labels.find((entry) => entry._id === id);
              if (label) actions.renameLabel(label, name);
            }}
            onRemove={({ id }) => {
              const label = labels.find((entry) => entry._id === id);
              if (label) actions.removeLabel(label);
            }}
          />
          {!hasChecklist && <ToolButton icon={ListChecks} label="Checklist" onClick={() => setComposing(true)} />}
          <DeadlinePicker
            deadline={task.deadline}
            label={deadline?.label}
            overdue={deadline?.overdue}
            today={today}
            onChange={actions.setDeadline}
          />
        </span>
      </div>
    </div>
  );
};
