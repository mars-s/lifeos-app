"use client";

import { Sparkle } from "@phosphor-icons/react";
import type { OptimisticLocalStore } from "convex/browser";
import type { FunctionReturnType } from "convex/server";
import { useMutation } from "convex/react";
import { generateNKeysBetween } from "fractional-indexing";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { api } from "@lifeos/backend/api";
import { MODELS, isModelId } from "@lifeos/backend/ai";
import type { Id } from "@lifeos/backend/dataModel";
import type { PlannerTask } from "@lifeos/backend/types";
import { ChecklistEditor, type ChecklistEntry } from "@/components/lifeos/checklist-editor";
import { Button } from "@/components/ui/action-button";
import { haptic } from "@/lib/haptics";
import { instant, springLayout } from "@/lib/motion-tokens";
import { both, patchTask, useChange } from "./changes";
import { isDraftTask } from "./drafts";
import { useQuietView } from "./hooks";

type StepsView = FunctionReturnType<typeof api.ai.steps.forTask>;

const setView = (taskId: Id<"tasks">, view: StepsView) => (store: OptimisticLocalStore) => store.setQuery(api.ai.steps.forTask, { taskId }, view);

const FAILED = {
  not_configured: "Add an OpenAI or OpenCode Go key in Settings to break Tasks into steps.",
  unauthorised: "The provider refused the key. Check it in Settings.",
  rate_limited: "The model is busy. Try again in a moment.",
  unavailable: "The model did not answer. Try again in a moment.",
  invalid_response: "The answer could not be read. Try again.",
  refused: "The model would not break this one down.",
} as const;

export const useBreakIntoSteps = (task: PlannerTask) => {
  const saved = !isDraftTask(task._id);
  const view = useQuietView(api.ai.steps.forTask, saved ? { taskId: task._id } : "skip");
  const request = useMutation(api.ai.steps.request).withOptimisticUpdate((store, { taskId }) => setView(taskId, { kind: "thinking" })(store));
  const dismiss = useMutation(api.ai.steps.dismiss).withOptimisticUpdate((store, { taskId }) => setView(taskId, { kind: "idle" })(store));
  const change = useChange();
  return {
    view,
    available: view !== undefined && view.kind !== "off",
    ask: () => void request({ taskId: task._id }).catch(() => undefined),
    again: () => void request({ taskId: task._id, again: true }).catch(() => undefined),
    dismiss: () => void dismiss({ taskId: task._id }).catch(() => undefined),
    accept: (titles: string[]) => {
      if (!view) return;
      const orders = generateNKeysBetween(task.checklist.at(-1)?.order ?? null, null, titles.length);
      const added = titles.map((title, index) => ({ _id: `optimistic:${orders[index]}` as Id<"checklistItems">, title, done: false, order: orders[index] ?? "" }));
      haptic("complete");
      return change({
        title: titles.length === 1 ? "Added 1 step" : `Added ${titles.length} steps`,
        mutation: api.ai.steps.accept,
        args: { taskId: task._id, titles },
        apply: both(
          patchTask(task._id, (current) => ({ ...current, checklist: [...current.checklist, ...added] })),
          setView(task._id, { kind: "idle" }),
        ),
        revert: both(
          patchTask(task._id, (current) => ({ ...current, checklist: current.checklist.filter((item) => !added.some((entry) => entry._id === item._id)) })),
          setView(task._id, view),
        ),
      });
    },
  };
};

type Steps = ReturnType<typeof useBreakIntoSteps>;

const proposed = () => <span aria-hidden="true" className="size-4 shrink-0 rounded-full border-[1.5px] border-dashed border-brand/50" />;

const entryOf = (title: string, index: number) => ({ id: `step-${index}`, key: `step-${index}`, title, done: false }) satisfies ChecklistEntry;

const Draft = ({ steps, project, answeredBy, onAccept, onAgain, onDismiss }: {
  steps: readonly string[];
  project: boolean;
  answeredBy: string;
  onAccept: (titles: string[]) => void;
  onAgain: () => void;
  onDismiss: () => void;
}) => {
  const [items, setItems] = useState<ChecklistEntry[]>(() => steps.map(entryOf));
  const [next, setNext] = useState(steps.length);
  const model = isModelId(answeredBy) ? MODELS[answeredBy].title : answeredBy;
  const titles = items.map((item) => item.title.trim()).filter((title) => title !== "");
  return (
    <>
      <ChecklistEditor
        items={items}
        marker={proposed}
        className="bg-transparent p-0"
        onAdd={async (title) => {
          setItems((current) => [...current, entryOf(title, next)]);
          setNext(next + 1);
          return true;
        }}
        onEdit={(id, title) => setItems((current) => current.map((item) => (item.id === id ? { ...item, title } : item)))}
        onTick={() => undefined}
        onRemove={(id) => setItems((current) => current.filter((item) => item.id !== id))}
        onMove={(id, toIndex) =>
          setItems((current) => {
            const moving = current.find((item) => item.id === id);
            if (!moving) return current;
            return current.filter((item) => item.id !== id).toSpliced(toIndex, 0, moving);
          })
        }
      />
      {project && (
        <p className="px-2 pt-1 text-small text-pretty text-muted-foreground">This looks big enough to be a Project with headings. For now, the steps go in the Checklist.</p>
      )}
      <div className="flex flex-wrap items-center gap-1.5 px-1 pt-2">
        <Button variant="primary" disabled={titles.length === 0} onClick={() => onAccept(titles)}>
          {titles.length === 1 ? "Add 1 step" : `Add ${titles.length} steps`}
        </Button>
        <Button variant="quiet" onClick={onAgain}>
          Ask again
        </Button>
        <Button variant="quiet" onClick={onDismiss}>
          Dismiss
        </Button>
        <span translate="no" className="ml-auto pr-1 text-micro text-faint-foreground">
          {model}
        </span>
      </div>
    </>
  );
};

const Thinking = () => (
  <div className="grid gap-1.5 px-2 py-1">
    {[72, 56, 64].map((width, index) => (
      <span key={width} aria-hidden="true" style={{ width: `${width}%`, animationDelay: `${index * 160}ms` }} className="h-5 rounded-md bg-foreground/[0.06] motion-safe:animate-pending" />
    ))}
    <span role="status" className="sr-only">
      Breaking it into steps…
    </span>
  </div>
);

export const StepsPreview = ({ steps }: { steps: Steps }) => {
  const reduce = useReducedMotion();
  const { view } = steps;
  const shown = view?.kind === "thinking" || view?.kind === "steps" || view?.kind === "failed";
  return (
    <AnimatePresence initial={false}>
      {shown && (
        <motion.section
          aria-label="Suggested steps"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={reduce ? instant : springLayout}
          className="-ml-2 overflow-hidden"
        >
          <div className="rounded-xl bg-brand/[0.05] p-1 ring-1 ring-brand/15 ring-inset">
            <h3 className="flex items-center gap-2 px-2 pt-1.5 pb-1 text-small font-medium">
              <Sparkle weight="fill" className="size-3.5 text-brand" aria-hidden="true" />
              Suggested steps
            </h3>
            {view.kind === "thinking" && <Thinking />}
            {view.kind === "failed" && (
              <div className="flex flex-wrap items-center gap-2 px-2 pb-1.5">
                <p role="status" className="mr-auto text-small text-pretty text-muted-foreground">
                  {FAILED[view.error]}
                </p>
                <Button variant="quiet" onClick={steps.again}>
                  Try again
                </Button>
                <Button variant="quiet" onClick={steps.dismiss}>
                  Dismiss
                </Button>
              </div>
            )}
            {view.kind === "steps" && (
              <Draft
                key={view.steps.join("\n")}
                steps={view.steps}
                project={view.project}
                answeredBy={view.answeredBy}
                onAccept={(titles) => void steps.accept(titles)}
                onAgain={steps.again}
                onDismiss={steps.dismiss}
              />
            )}
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
};
