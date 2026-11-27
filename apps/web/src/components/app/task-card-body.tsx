"use client";

import { DotsThree, ListChecks, Stamp } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { api } from "@lifeos/backend/api";
import type { IsoDate } from "@lifeos/backend/date";
import type { PlannerTask } from "@lifeos/backend/types";
import { AiMark, AiMarkWorking } from "@/components/lifeos/ai-orb";
import { AreaDot } from "@/components/lifeos/area";
import { StepsPreview, useBreakIntoSteps } from "./break-into-steps";
import { ChecklistEditor } from "@/components/lifeos/checklist-editor";
import { DeadlinePicker, WhenPicker } from "@/components/lifeos/date-pickers";
import { LabelPicker } from "@/components/lifeos/label-picker";
import { baseDate } from "@lifeos/backend/client/repeat";
import { RepeatPicker } from "@/components/lifeos/repeat-picker";
import { ToolButton } from "@/components/lifeos/tool-button";
import { Menu } from "@/components/ui/action-menu";
import { WorkBlockList } from "@/components/lifeos/work-blocks";
import { enter, exit, instant, spring, springLayout } from "@/lib/motion-tokens";
import { deadlineMark, localDate, relativeDay, shortDay, whenLabel } from "./dates";
import { FocusSection, FocusTool } from "./focus";
import { useQuietView } from "./hooks";
import { Linkified, TitleLinks } from "./linkified";
import { useRepeatActions } from "./repeat-actions";
import { TaskEstimateField } from "./smart-estimate";
import { drafts, isDraftTask } from "./drafts";
import { useConvertToProject } from "./project-conversion";
import { isOptimistic, useTaskActions } from "./task-actions";
import { useFeatureOn } from "./settings/feature-state";
import { useTemplateActions } from "./template-actions";
import { TaskTrip } from "./trip";
import { AskBox } from "./ai/ask-box";
import { useTaskAsk } from "./ai/task-ask";

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

const CHIP_OUT = { opacity: 0, scale: 0.95 };
const CHIP_IN = { opacity: 1, scale: 1 };

const Chip = ({ colour, children, ref }: { colour: PlannerTask["labels"][number]["colour"]; children: ReactNode; ref?: Ref<HTMLSpanElement> }) => {
  const reduce = useReducedMotion();
  return (
    <motion.span
      ref={ref}
      layout={reduce ? false : "position"}
      initial={reduce ? { opacity: 0 } : CHIP_OUT}
      animate={CHIP_IN}
      exit={{ ...(reduce ? { opacity: 0 } : CHIP_OUT), transition: exit }}
      transition={reduce ? enter : { ...enter, layout: spring }}
      className="inline-flex h-6 max-w-full min-w-0 items-center gap-1.5 rounded-full bg-foreground/[0.06] px-2 text-small text-foreground/80"
    >
      <AreaDot colour={colour} className="size-1.5 transition-[background-color] duration-(--dur-fast)" />
      <span className="truncate">{children}</span>
    </motion.span>
  );
};

const draftField = "block w-full bg-transparent outline-none placeholder:text-faint-foreground";

export const TitleField = ({ task, today, onCreated }: { task: PlannerTask; today: string; onCreated?: () => void }) => {
  const { rename } = useTaskActions(task, today);
  const [draft, setDraft] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    field.current?.focus({ preventScroll: true });
  }, []);
  const commit = () => {
    const next = draft?.trim();
    setDraft(null);
    if (drafts.isUnsaved(task._id)) return void drafts.commit(task._id, next ?? "");
    if (isDraftTask(task._id) && !drafts.exists(task._id)) return;
    if (next && next !== task.title) rename(next);
  };
  return (
    <textarea
      ref={field}
      aria-label="Title"
      name="title"
      rows={1}
      data-undo={draft === null ? "app" : undefined}
      value={draft ?? task.title}
      placeholder="New Task"
      autoComplete="off"
      onChange={(event) => setDraft(event.target.value.replaceAll(/\s*\n\s*/g, " "))}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || event.metaKey || event.ctrlKey) return;
        event.preventDefault();
        const unsaved = drafts.isUnsaved(task._id);
        if (unsaved && event.currentTarget.value.trim() === "") return;
        event.currentTarget.blur();
        if (unsaved) onCreated?.();
      }}
      className={`${draftField} field-sizing-content min-w-0 flex-1 resize-none font-medium break-words`}
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
        <Linkified text={notes.trimEnd().replaceAll(/\n\s*\n(\s*\n)+/g, "\n\n")} />
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
  const repeatDo = useRepeatActions(task, today);
  const templateDo = useTemplateActions();
  const templatesOn = useFeatureOn("templates");
  const steps = useBreakIntoSteps(task);
  const convertToProject = useConvertToProject();
  const saved = !isDraftTask(task._id);
  const breakIntoSteps = steps.available ? steps.ask : () => setComposing(true);
  const repeat = task.repeat?.active ? task.repeat : undefined;
  const labels = useQuietView(api.planner.labels.list, {}) ?? task.labels;
  const items = useStableKeys(task.checklist);
  const [composing, setComposing] = useState(false);
  const composer = useRef<HTMLInputElement>(null);
  const hasChecklist = task.checklist.length > 0 || composing;
  const deadline = task.deadline ? deadlineMark(task.deadline, today) : undefined;
  const ask = useTaskAsk(task, today);
  const [askVia, setAskVia] = useState<"keys" | "pointer">("keys");
  const canAsk = saved && ask.available;
  const openAsk = ask.open;

  useEffect(() => {
    if (composing) composer.current?.focus({ preventScroll: true });
  }, [composing]);

  useEffect(() => {
    if (!canAsk) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "j") return;
      event.preventDefault();
      setAskVia("keys");
      openAsk();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canAsk, openAsk]);

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
      <StepsPreview steps={steps} />
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
      <TaskTrip task={task} />
      <TaskEstimateField task={task} onChange={(minutes) => void actions.setEstimate(minutes)} onSteps={breakIntoSteps}
        onProject={saved && task.status.kind === "open" ? () => convertToProject(task, "pointer") : undefined}
      />
      <FocusSection task={task} today={today} />
      <div className="-ml-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
        <WhenPicker when={task.when} label={whenLabel(task.when, today)} today={today} onChange={actions.setWhen} />
        <AnimatePresence initial={false} mode="popLayout">
          {task.area && (
            <Chip key={task.project?._id ?? task.area._id} colour={task.area.colour}>
              {task.project?.title ?? task.area.title}
            </Chip>
          )}
          {task.labels.map((label) => (
            <Chip key={label._id} colour={label.colour}>
              {label.name}
            </Chip>
          ))}
        </AnimatePresence>
        <span className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-0.5">
          {canAsk && (
            <ToolButton
              icon={AiMark}
              label="Ask AI"
              aria-keyshortcuts="Meta+J"
              aria-expanded={ask.phase.kind !== "idle"}
              onClick={() => {
                setAskVia("pointer");
                ask.open();
              }}
            />
          )}
          <FocusTool task={task} />
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
          {steps.available && (
            <ToolButton icon={steps.view?.kind === "thinking" ? AiMarkWorking : AiMark} label="Break into steps" onClick={steps.ask} className="@max-xs:hidden" />
          )}
          <RepeatPicker
            repeat={repeat && { schedule: repeat.schedule, end: repeat.end, next: repeat.next, settled: !isOptimistic(repeat.ruleId) }}
            base={baseDate(task.when, today as IsoDate)}
            today={today}
            onSet={repeatDo.set}
            onStop={repeatDo.stop}
            onSkip={repeatDo.skip}
          />
          {templatesOn && <ToolButton icon={Stamp} label="Save as Template" onClick={() => templateDo.save(task, today)} className="@max-xs:hidden" />}
          <DeadlinePicker
            deadline={task.deadline}
            label={deadline?.label}
            overdue={deadline?.overdue}
            today={today}
            onChange={actions.setDeadline}
          />
          {(steps.available || templatesOn) && (
            <Menu
              align="end"
              trigger={<ToolButton icon={DotsThree} label="More" className="@xs:hidden" />}
              groups={[
                {
                  items: [
                    ...(steps.available ? [{ id: "steps", label: "Break into steps", icon: AiMark, onSelect: steps.ask }] : []),
                    ...(templatesOn ? [{ id: "template", label: "Save as Template", icon: Stamp, onSelect: () => templateDo.save(task, today) }] : []),
                  ],
                },
              ]}
            />
          )}
        </span>
      </div>
      <AskBox ask={ask} via={askVia} />
    </div>
  );
};
