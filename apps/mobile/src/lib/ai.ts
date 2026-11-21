import type { OptimisticLocalStore } from "convex/browser";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { generateNKeysBetween } from "fractional-indexing";
import { useEffect, useState } from "react";
import { api } from "@lifeos/backend/api";
import { both, patchTask } from "@lifeos/backend/client/updaters";
import type { Id } from "@lifeos/backend/dataModel";
import type { PlannerTask } from "@lifeos/backend/types";
import { change } from "@/lib/change";
import { haptic } from "@/lib/haptics";
import { isUnsaved } from "@/lib/tasks";
import { useView } from "@/lib/views";

export type StepsView = FunctionReturnType<typeof api.ai.steps.forTask>;
export type EstimateView = FunctionReturnType<typeof api.planner.smartEstimates.forTask>;

const THINKING_PATIENCE_MS = 15_000;

const setSteps = (taskId: Id<"tasks">, view: StepsView) => (store: OptimisticLocalStore) => store.setQuery(api.ai.steps.forTask, { taskId }, view);

export const STEPS_FAILED = {
  not_configured: "Add an OpenAI or OpenCode Go key in Settings to break Tasks into steps.",
  unauthorised: "The provider refused the key. Check it in Settings.",
  rate_limited: "The model is busy. Try again in a moment.",
  unavailable: "The model did not answer. Try again in a moment.",
  invalid_response: "The answer could not be read. Try again.",
  refused: "The model would not break this one down.",
} as const;

export const useSteps = (task: PlannerTask) => {
  const saved = !isUnsaved(task._id);
  const view = useView(api.ai.steps.forTask, saved ? { taskId: task._id } : "skip");
  const request = useMutation(api.ai.steps.request).withOptimisticUpdate((store, { taskId }) => setSteps(taskId, { kind: "thinking" })(store));
  const dismiss = useMutation(api.ai.steps.dismiss).withOptimisticUpdate((store, { taskId }) => setSteps(taskId, { kind: "idle" })(store));
  return {
    view,
    available: view !== undefined && view.kind !== "off",
    ask: () => {
      haptic("toggle");
      void request({ taskId: task._id }).catch(() => undefined);
    },
    again: () => {
      haptic("toggle");
      void request({ taskId: task._id, again: true }).catch(() => undefined);
    },
    dismiss: () => {
      haptic("toggle");
      void dismiss({ taskId: task._id }).catch(() => undefined);
    },
    accept: (titles: string[]) => {
      if (!view) return;
      const orders = generateNKeysBetween(task.checklist.at(-1)?.order ?? null, null, titles.length);
      const added = titles.map((title, index) => ({ _id: `optimistic:${orders[index]}` as Id<"checklistItems">, title, done: false, order: orders[index] ?? "" }));
      haptic("complete");
      void change({
        title: titles.length === 1 ? "Added 1 step" : `Added ${titles.length} steps`,
        mutation: api.ai.steps.accept,
        args: { taskId: task._id, titles },
        apply: both(
          patchTask(task._id, (current) => ({ ...current, checklist: [...current.checklist, ...added] })),
          setSteps(task._id, { kind: "idle" }),
        ),
        revert: both(
          patchTask(task._id, (current) => ({ ...current, checklist: current.checklist.filter((item) => !added.some((entry) => entry._id === item._id)) })),
          setSteps(task._id, view),
        ),
      });
    },
  };
};

export type Steps = ReturnType<typeof useSteps>;

export type SmartEstimate =
  | { kind: "none" }
  | { kind: "thinking" }
  | { kind: "guesses"; guesses: readonly { minutes: number; probability: number }[]; likely: number; reason: string; dayMinutes: number }
  | { kind: "note"; note: string };

const fallbackNote = (view: Extract<EstimateView, { kind: "fallback" }>) => {
  if (view.why === "untitled") return "Give the Task a title and LifeOS will guess.";
  if (view.why === "vague") return "Too vague to guess. A few more words in the title or notes will help.";
  if (view.error === "unauthorised") return "OpenAI refused the key. Check it in Settings.";
  if (view.error === "rate_limited") return "OpenAI is busy. Edit the title to try again.";
  return "No guess this time. Edit the title to try again.";
};

const smartOf = (view: EstimateView | undefined, patient: boolean) => {
  if (!view || view.kind === "presets") return { kind: "none" } satisfies SmartEstimate;
  if (view.kind === "thinking") return patient ? ({ kind: "thinking" } satisfies SmartEstimate) : ({ kind: "note", note: "Still waiting on the model. Pick one for now." } satisfies SmartEstimate);
  if (view.kind === "guesses") return { kind: "guesses", guesses: view.guesses, likely: view.likely, reason: view.reason, dayMinutes: view.dayMinutes } satisfies SmartEstimate;
  return { kind: "note", note: fallbackNote(view) } satisfies SmartEstimate;
};

export const useSmartEstimate = (task: PlannerTask, { ask = false } = {}) => {
  const saved = !isUnsaved(task._id);
  const view = useView(api.planner.smartEstimates.forTask, saved ? { taskId: task._id } : "skip");
  const request = useMutation(api.planner.smartEstimates.request);
  const unestimated = saved && task.estimateMinutes === undefined;
  const thinking = view?.kind === "thinking";
  const [wasThinking, setWasThinking] = useState(thinking);
  const [round, setRound] = useState(0);
  const [gaveUpOn, setGaveUpOn] = useState(-1);
  if (thinking !== wasThinking) {
    setWasThinking(thinking);
    if (thinking) setRound(round + 1);
  }
  useEffect(() => {
    if (ask && unestimated) request({ taskId: task._id }).catch(() => undefined);
  }, [ask, unestimated, request, task._id]);
  useEffect(() => {
    if (!thinking) return;
    const timer = setTimeout(() => setGaveUpOn(round), THINKING_PATIENCE_MS);
    return () => clearTimeout(timer);
  }, [thinking, round]);
  return smartOf(view, gaveUpOn !== round);
};
