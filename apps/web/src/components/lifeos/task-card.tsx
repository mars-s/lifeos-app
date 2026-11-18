"use client";

import {
  Archive,
  CalendarDots,
  DotsSixVertical,
  Flag,
  ListChecks,
  Moon,
  Plus,
  Stack,
  Star,
  Tag as TagIcon,
  type Icon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, Reorder, useDragControls, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Popover, PopoverClose } from "@/components/ui/popover-panel";
import { instant, springLayout } from "@/lib/motion-tokens";
import { cn } from "@/lib/utils";
import { AreaDot, type AreaColour } from "./area";
import { formatMinutes } from "./format";
import { StrikeTitle, TaskCheckbox, TaskRow, type DeadlineMark, type TaskSummary } from "./task-row";
import { showUndo } from "./undo";

type WhenValue = "Today" | "This Evening" | "Tomorrow" | "Anytime" | "Someday";

const WHEN_OPTIONS = [
  { value: "Today", icon: Star },
  { value: "This Evening", icon: Moon },
  { value: "Tomorrow", icon: CalendarDots },
  { value: "Anytime", icon: Stack },
  { value: "Someday", icon: Archive },
] as const satisfies readonly { value: WhenValue; icon: Icon }[];

const DEADLINE_OPTIONS = [
  { label: "Thu 20 Nov", countdown: "2d left" },
  { label: "Fri 21 Nov", countdown: "3d left" },
  { label: "Mon 24 Nov", countdown: "6d left" },
] as const satisfies readonly DeadlineMark[];

const ESTIMATE_CHIPS = [10, 15, 30, 60, 120] as const;

export type TaskLabel = { name: string; colour: AreaColour };
export type ChecklistItem = { id: string; title: string; done: boolean };

export type TaskDetail = TaskSummary & {
  notes: string;
  when: WhenValue;
  labels: string[];
  items: ChecklistItem[];
};

const ToolButton = ({
  icon: IconComponent,
  label,
  active,
  className,
  children,
  ...props
}: React.ComponentProps<"button"> & { icon: Icon; label: string; active?: boolean }) => (
  <button
    type="button"
    aria-label={label}
    className={cn(
      "group/tool inline-flex h-7 shrink-0 items-center rounded-full px-1.5 text-small transition-[background-color,color,scale] duration-(--dur-press) ease-out hover:bg-foreground/[0.06] active:scale-[0.96]",
      active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      className,
    )}
    {...props}
  >
    <IconComponent weight={active ? "fill" : "regular"} className="size-4" aria-hidden="true" />
    {children ?? (
      <span className="grid grid-cols-[0fr] transition-[grid-template-columns] duration-(--dur-base) ease-out group-hover/tool:grid-cols-[1fr] group-focus-visible/tool:grid-cols-[1fr]">
        <span className="overflow-hidden pl-1.5 whitespace-nowrap">{label}</span>
      </span>
    )}
  </button>
);

const MenuRow = ({ children, selected, onSelect }: { children: ReactNode; selected?: boolean; onSelect: () => void }) => (
  <PopoverClose asChild>
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-left text-small transition-colors duration-(--dur-press) hover:bg-foreground/[0.06]",
        selected && "bg-foreground/[0.06] font-medium",
      )}
    >
      {children}
    </button>
  </PopoverClose>
);

const ChecklistRow = ({
  item,
  onToggle,
}: {
  item: ChecklistItem;
  onToggle: (done: boolean) => void;
}) => {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={item}
      dragListener={false}
      dragControls={controls}
      whileDrag={{ scale: 1.015, boxShadow: "var(--shadow-lift)", backgroundColor: "var(--popover)" }}
      transition={springLayout}
      className="relative flex h-8 items-center gap-2.5 rounded-lg pr-1 pl-2 text-small"
    >
      <TaskCheckbox size="sm" checked={item.done} onCheckedChange={onToggle} label={`Tick ${item.title}`} />
      <span className="min-w-0 flex-1">
        <StrikeTitle struck={item.done}>{item.title}</StrikeTitle>
      </span>
      <span
        role="button"
        tabIndex={-1}
        aria-label={`Reorder ${item.title}`}
        onPointerDown={(event) => controls.start(event)}
        className="grid size-7 cursor-grab touch-none place-items-center rounded-md text-faint-foreground hover:text-muted-foreground active:cursor-grabbing"
      >
        <DotsSixVertical weight="bold" className="size-4" aria-hidden="true" />
      </span>
    </Reorder.Item>
  );
};

export const TaskCard = ({
  task: initial,
  labels,
  open,
  onOpenChange,
}: {
  task: TaskDetail;
  labels: TaskLabel[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const reduce = useReducedMotion();
  const [task, setTask] = useState(initial);
  const [completed, setCompleted] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const transition = reduce ? instant : springLayout;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element;
      if (container.current?.contains(target) || target.closest("[data-radix-popper-content-wrapper]")) return;
      onOpenChange(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, onOpenChange]);

  const change = (message: string, patch: Partial<TaskDetail>) => {
    const before = task;
    setTask({ ...task, ...patch });
    showUndo(message, () => setTask(before));
  };

  const doneCount = task.items.filter((item) => item.done).length;
  const summary = {
    ...task,
    someday: task.when === "Someday",
    checklist: task.items.length > 0 ? { done: doneCount, total: task.items.length } : undefined,
  };
  const WhenIcon = WHEN_OPTIONS.find((option) => option.value === task.when)?.icon ?? Star;

  return (
    <motion.div
      ref={container}
      animate={{ marginTop: open ? 8 : 0, marginBottom: open ? 8 : 0 }}
      transition={transition}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) onOpenChange(false);
      }}
      className={cn(
        "rounded-2xl transition-[background-color,box-shadow] duration-(--dur-base) ease-out",
        open && "bg-popover shadow-lift",
      )}
    >
      {open ? (
        <div className="flex items-start gap-3 px-3 pt-2.5">
          <TaskCheckbox
            checked={completed}
            onCheckedChange={setCompleted}
            label={`Complete ${task.title}`}
            className="mt-[3px]"
          />
          <input
            ref={titleInput}
            aria-label="Title"
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
                rows={2}
                value={task.notes}
                onChange={(event) => setTask({ ...task, notes: event.target.value })}
                placeholder="Notes"
                className="block w-full resize-none bg-transparent text-small text-muted-foreground outline-none placeholder:text-faint-foreground"
              />
              {task.items.length > 0 && (
                <Reorder.Group
                  axis="y"
                  values={task.items}
                  onReorder={(items) => setTask({ ...task, items })}
                  className="-ml-2 rounded-xl bg-foreground/[0.035] p-1"
                >
                  {task.items.map((item) => (
                    <ChecklistRow
                      key={item.id}
                      item={item}
                      onToggle={(done) =>
                        setTask({
                          ...task,
                          items: task.items.map((entry) => (entry.id === item.id ? { ...entry, done } : entry)),
                        })
                      }
                    />
                  ))}
                </Reorder.Group>
              )}
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Estimate">
                <span className="mr-1 text-small text-muted-foreground">Estimate</span>
                {ESTIMATE_CHIPS.map((minutes) => {
                  const selected = task.estimate === minutes;
                  return (
                    <button
                      key={minutes}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        change(selected ? "Estimate cleared" : `Estimate set to ${formatMinutes(minutes)}`, {
                          estimate: selected ? undefined : minutes,
                        })
                      }
                      className={cn(
                        "h-7 rounded-md px-2 font-mono text-small transition-[background-color,color,scale] duration-(--dur-press) ease-out active:scale-[0.94]",
                        selected
                          ? "bg-brand text-brand-foreground"
                          : "bg-foreground/[0.06] text-foreground/80 hover:bg-foreground/[0.1]",
                      )}
                    >
                      {formatMinutes(minutes)}
                    </button>
                  );
                })}
              </div>
              <div className="-ml-1.5 flex flex-wrap items-center gap-1">
                <Popover
                  align="start"
                  className="w-52 p-1.5"
                  trigger={
                    <ToolButton icon={WhenIcon} label="When" active className="pr-2.5">
                      <span className="pl-1.5 font-medium">{task.when}</span>
                    </ToolButton>
                  }
                >
                  {WHEN_OPTIONS.map(({ value, icon: OptionIcon }) => (
                    <MenuRow
                      key={value}
                      selected={task.when === value}
                      onSelect={() => change(`Moved to ${value}`, { when: value })}
                    >
                      <OptionIcon weight="fill" className="size-4 text-muted-foreground" aria-hidden="true" />
                      {value}
                    </MenuRow>
                  ))}
                </Popover>
                {task.labels.map((name) => {
                  const label = labels.find((entry) => entry.name === name);
                  return (
                    label && (
                      <span
                        key={name}
                        className="inline-flex h-6 items-center gap-1.5 rounded-full bg-foreground/[0.06] px-2 text-small text-foreground/80"
                      >
                        <AreaDot colour={label.colour} className="size-1.5" />
                        {name}
                      </span>
                    )
                  );
                })}
                <span className="ml-auto flex items-center gap-0.5">
                  <Popover
                    align="end"
                    className="w-48 p-1.5"
                    trigger={<ToolButton icon={TagIcon} label="Labels" />}
                  >
                    {labels.map((label) => {
                      const selected = task.labels.includes(label.name);
                      return (
                        <MenuRow
                          key={label.name}
                          selected={selected}
                          onSelect={() =>
                            change(selected ? `Removed ${label.name}` : `Labelled ${label.name}`, {
                              labels: selected
                                ? task.labels.filter((name) => name !== label.name)
                                : [...task.labels, label.name],
                            })
                          }
                        >
                          <AreaDot colour={label.colour} />
                          {label.name}
                        </MenuRow>
                      );
                    })}
                  </Popover>
                  <ToolButton
                    icon={task.items.length > 0 ? Plus : ListChecks}
                    label="Checklist Item"
                    onClick={() =>
                      setTask({
                        ...task,
                        items: [...task.items, { id: `item-${Date.now()}`, title: "New step", done: false }],
                      })
                    }
                  />
                  <Popover
                    align="end"
                    className="w-52 p-1.5"
                    trigger={
                      task.deadline ? (
                        <ToolButton icon={Flag} label="Deadline" active className="pr-2.5 text-deadline">
                          <span className="pl-1.5 font-medium">{task.deadline.label}</span>
                        </ToolButton>
                      ) : (
                        <ToolButton icon={Flag} label="Deadline" />
                      )
                    }
                  >
                    {DEADLINE_OPTIONS.map((option) => (
                      <MenuRow
                        key={option.label}
                        selected={task.deadline?.label === option.label}
                        onSelect={() => change(`Deadline set to ${option.label}`, { deadline: option })}
                      >
                        <Flag weight="fill" className="size-4 text-deadline" aria-hidden="true" />
                        <span className="flex-1">{option.label}</span>
                        <span className="text-faint-foreground">{option.countdown}</span>
                      </MenuRow>
                    ))}
                    {task.deadline && (
                      <MenuRow onSelect={() => change("Deadline cleared", { deadline: undefined })}>
                        <span className="pl-[1.625rem] text-muted-foreground">No Deadline</span>
                      </MenuRow>
                    )}
                  </Popover>
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
