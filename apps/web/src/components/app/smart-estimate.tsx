"use client";

import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useState } from "react";
import { api } from "@lifeos/backend/api";
import type { PlannerTask } from "@lifeos/backend/types";
import { EstimateField, type SmartEstimate } from "@/components/lifeos/estimate-field";
import { isDraftTask } from "./drafts";
import { useQuietView } from "./hooks";

type EstimateView = FunctionReturnType<typeof api.planner.smartEstimates.forTask>;
type FailedView = Extract<EstimateView, { kind: "fallback" }>;

const THINKING_PATIENCE_MS = 15_000;

const fallbackNote = (view: FailedView) => {
  if (view.why === "untitled") return "Give the Task a title and LifeOS will guess.";
  if (view.why === "vague") return "Too vague to guess. A few more words in the title or notes will help.";
  if (view.error === "unauthorised") return "OpenAI refused the key. Check it in Settings.";
  if (view.error === "rate_limited") return "OpenAI is busy. Edit the title to try again.";
  return "No guess this time. Edit the title to try again.";
};

const smartFor = (view: EstimateView | undefined, patient: boolean) => {
  if (!view || view.kind === "presets") return undefined;
  if (view.kind === "thinking") return patient ? ({ kind: "thinking" } satisfies SmartEstimate) : ({ kind: "note", note: "Still waiting on OpenAI. Pick one for now." } satisfies SmartEstimate);
  if (view.kind === "guesses")
    return { kind: "guesses", guesses: view.guesses, likely: view.likely, reason: view.reason, dayMinutes: view.dayMinutes } satisfies SmartEstimate;
  return { kind: "note", note: fallbackNote(view) } satisfies SmartEstimate;
};

export const TaskEstimateField = ({
  task,
  onChange,
  onSteps,
}: {
  task: PlannerTask;
  onChange: (minutes: number | null) => void;
  onSteps?: () => void;
}) => {
  const saved = !isDraftTask(task._id);
  const unestimated = saved && task.estimateMinutes === undefined;
  const view = useQuietView(api.planner.smartEstimates.forTask, saved ? { taskId: task._id } : "skip");
  const request = useMutation(api.planner.smartEstimates.request);
  const thinking = view?.kind === "thinking";
  const [wasThinking, setWasThinking] = useState(thinking);
  const [round, setRound] = useState(0);
  const [gaveUpOn, setGaveUpOn] = useState(-1);
  if (thinking !== wasThinking) {
    setWasThinking(thinking);
    if (thinking) setRound(round + 1);
  }
  useEffect(() => {
    if (unestimated) request({ taskId: task._id }).catch(() => undefined);
  }, [unestimated, request, task._id]);
  useEffect(() => {
    if (!thinking) return;
    const timer = setTimeout(() => setGaveUpOn(round), THINKING_PATIENCE_MS);
    return () => clearTimeout(timer);
  }, [thinking, round]);
  return <EstimateField minutes={task.estimateMinutes} smart={smartFor(view, gaveUpOn !== round)} onChange={onChange} onSteps={onSteps} />;
};
