"use client";

import { ListChecks } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { instant, springLayout } from "@/lib/motion-tokens";
import { cn } from "@/lib/utils";
import { AreaDot, type AreaColour } from "./area";
import { ChecklistEditor } from "./checklist-editor";
import { DeadlinePicker, WhenPicker, type WhenValue } from "./date-pickers";
import { EstimateField } from "./estimate-field";
import { formatMinutes } from "./format";
import { LabelPicker } from "./label-picker";
import { TaskCheckbox, TaskRow, type TaskSummary } from "./task-row";
import { ToolButton } from "./tool-button";
import { showUndo } from "./undo";
import { WorkBlockList, type PlannedBlock } from "./work-blocks";

export type TaskLabel = { name: string; colour: AreaColour };
export type ChecklistItem = { id: string; title: string; done: boolean };

export type TaskDetail = Omit<TaskSummary, "deadline"> & {
  notes: string;
  when: WhenValue;
  deadlineDate?: string;
  labels: string[];
  items: ChecklistItem[];
  blocks?: PlannedBlock[];
};

const shortDay = new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const dayLabel = (date: string) => shortDay.format(Date.parse(`${date}T00:00:00Z`)).replaceAll(",", "");

const whenLabel = (when: WhenValue, today: string) => {
  if (when.kind !== "scheduled") return { inbox: "Inbox", anytime: "Anytime", someday: "Someday" }[when.kind];
  if (when.date <= today) return when.evening ? "This Evening" : "Today";
  return dayLabel(when.date);
};

export const TaskCard = ({
  task: initial,
  labels: initialLabels,
  today,
  open,
  onOpenChange,
}: {
  task: TaskDetail;
  labels: TaskLabel[];
  today: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const reduce = useReducedMotion();
  const [task, setTask] = useState(initial);
  const [labels, setLabels] = useState(initialLabels);
  const [completed, setCompleted] = useState(false);
  const [composing, setComposing] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLInputElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const transition = reduce ? instant : springLayout;
  const hasChecklist = task.items.length > 0 || composing;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element;
      if (container.current?.contains(target) || target.closest("[data-radix-popper-content-wrapper], [data-toaster]")) return;
      onOpenChange(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (composing) composer.current?.focus({ preventScroll: true });
  }, [composing]);

  const change = (message: string, patch: Partial<TaskDetail>) => {
    const before = task;
    setTask({ ...task, ...patch });
    showUndo(message, () => setTask(before), `card:${task.id}`);
  };
  const editItem = (id: string, fields: Partial<ChecklistItem>) =>
    task.items.map((entry) => (entry.id === id ? { ...entry, ...fields } : entry));

  const doneCount = task.items.filter((item) => item.done).length;
  const summary = {
    ...task,
    someday: task.when.kind === "someday",
    deadline: task.deadlineDate ? { label: dayLabel(task.deadlineDate) } : undefined,
    checklist: task.items.length > 0 ? { done: doneCount, total: task.items.length } : undefined,
  };

  return (
    <motion.div
      ref={container}
      animate={{ marginTop: open ? 8 : 0, marginBottom: open ? 8 : 0 }}
      transition={transition}
      onKeyDown={(event) => {
        if (!open || !container.current?.contains(event.target as Node)) return;
        if (event.key === "Escape" || (event.key === "Enter" && (event.metaKey || event.ctrlKey))) onOpenChange(false);
      }}
      className={cn("rounded-xl transition-[background-color,box-shadow] duration-(--dur-base) ease-out", open && "bg-popover shadow-lift")}
    >
      {open ? (
        <div className="flex items-start gap-3 px-3 pt-2.5">
          <TaskCheckbox checked={completed} onCheckedChange={setCompleted} label={`Complete ${task.title}`} className="mt-[3px]" />
          <input
            ref={titleInput}
            aria-label="Title"
            name="title"
            autoComplete="off"
            value={task.title}
            onChange={(event) => setTask({ ...task, title: event.target.value })}
            className="min-w-0 flex-1 bg-transparent font-medium outline-none placeholder:text-faint-foreground"
            placeholder="New Task"
          />
        </div>
      ) : (
        <TaskRow
          task={summary}
          completed={completed}
          onCompletedChange={setCompleted}
          onOpen={() => {
            onOpenChange(true);
            requestAnimationFrame(() => titleInput.current?.focus({ preventScroll: true }));
          }}
        />
      )}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={transition}
            className="overflow-hidden"
          >
            <div className="space-y-3 pt-1 pr-3 pb-3 pl-[2.8125rem]">
              <textarea
                aria-label="Notes"
                name="notes"
                autoComplete="off"
                rows={1}
                value={task.notes}
                onChange={(event) => setTask({ ...task, notes: event.target.value })}
                placeholder="Notes"
                className="block field-sizing-content min-h-5 w-full resize-none bg-transparent text-small text-muted-foreground outline-none placeholder:text-faint-foreground"
              />
              {hasChecklist && (
                <ChecklistEditor
                  className="-ml-2"
                  composerRef={composer}
                  items={task.items.map((item) => ({ ...item, key: item.id }))}
                  onAdd={(title) => {
                    change(`Added ${title}`, { items: [...task.items, { id: `item-${task.items.length}-${title}`, title, done: false }] });
                    return Promise.resolve(true);
                  }}
                  onEdit={(id, title) => change("Checklist Item renamed", { items: editItem(id, { title }) })}
                  onTick={(id, done) => change(done ? "Ticked" : "Unticked", { items: editItem(id, { done }) })}
                  onRemove={(id) => change("Checklist Item deleted", { items: task.items.filter((entry) => entry.id !== id) })}
                  onMove={(id, toIndex) => {
                    const moved = task.items.find((entry) => entry.id === id);
                    const rest = task.items.filter((entry) => entry.id !== id);
                    if (moved) change("Checklist Item moved", { items: [...rest.slice(0, toIndex), moved, ...rest.slice(toIndex)] });
                  }}
                  onComposerBlur={() => setComposing(false)}
                />
              )}
              {task.blocks && task.blocks.length > 0 && <WorkBlockList blocks={task.blocks} colour={task.area.colour} />}
              <EstimateField
                minutes={task.estimate}
                onChange={(minutes) =>
                  change(minutes === null ? "Estimate cleared" : `Estimate set to ${formatMinutes(minutes)}`, { estimate: minutes ?? undefined })
                }
              />
              <div className="-ml-1.5 flex flex-wrap items-center gap-1.5">
                <WhenPicker
                  when={task.when}
                  label={whenLabel(task.when, today)}
                  today={today}
                  onChange={(when) => change(`Moved to ${whenLabel(when, today)}`, { when })}
                />
                {task.labels.map((name) => {
                  const label = labels.find((entry) => entry.name === name);
                  return (
                    label && (
                      <span key={name} className="inline-flex h-6 items-center gap-1.5 rounded-full bg-foreground/[0.06] px-2 text-small text-foreground/80">
                        <AreaDot colour={label.colour} className="size-1.5" />
                        {name}
                      </span>
                    )
                  );
                })}
                <span className="ml-auto flex items-center gap-0.5">
                  <LabelPicker
                    labels={labels.map((label) => ({ id: label.name, ...label }))}
                    selected={task.labels}
                    onToggle={({ name }) =>
                      change(task.labels.includes(name) ? `Removed ${name}` : `Labelled ${name}`, {
                        labels: task.labels.includes(name) ? task.labels.filter((entry) => entry !== name) : [...task.labels, name],
                      })
                    }
                    onCreate={(name, colour) => {
                      setLabels([...labels, { name, colour }]);
                      change(`Labelled ${name}`, { labels: [...task.labels, name] });
                    }}
                    onColour={({ name }, colour) => setLabels(labels.map((label) => (label.name === name ? { ...label, colour } : label)))}
                  />
                  {!hasChecklist && <ToolButton icon={ListChecks} label="Checklist" onClick={() => setComposing(true)} />}
                  <DeadlinePicker
                    deadline={task.deadlineDate}
                    label={task.deadlineDate && dayLabel(task.deadlineDate)}
                    today={today}
                    onChange={(deadline) =>
                      change(deadline ? `Deadline set to ${dayLabel(deadline)}` : "Deadline cleared", { deadlineDate: deadline ?? undefined })
                    }
                  />
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
