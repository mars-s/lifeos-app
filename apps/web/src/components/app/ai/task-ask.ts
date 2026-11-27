"use client";

import { useUIMessages } from "@convex-dev/agent/react";
import { useMutation } from "convex/react";
import { generateNKeysBetween } from "fractional-indexing";
import { useCallback, useEffect, useState } from "react";
import { api } from "@lifeos/backend/api";
import { taskActions } from "@lifeos/backend/client/task-actions";
import type { Id } from "@lifeos/backend/dataModel";
import type { PlannerTask } from "@lifeos/backend/types";
import { haptic } from "@/lib/haptics";
import { patchTask, useChange } from "../changes";
import { askToConfirm } from "../confirm";
import { useQuietView } from "../hooks";

export type VerbId = "steps" | "estimate" | "time" | "notes";

export const TASK_VERBS = [
  { id: "steps", label: "Break into steps", request: "Break this Task into steps.", reading: "Reading the Task" },
  { id: "estimate", label: "Estimate", request: "Estimate how long this Task takes.", reading: "Reading the Task" },
  { id: "time", label: "Find a time", request: "Find a time this week to work on this Task.", reading: "Reading your days" },
  { id: "notes", label: "Draft the notes", request: "Draft what goes in this Task's notes, such as the email or the plan.", reading: "Reading the Task" },
] as const satisfies readonly { id: VerbId; label: string; request: string; reading: string }[];

export type Proposal =
  | { kind: "steps"; steps: string[]; why: string }
  | { kind: "estimate"; minutes: number; why: string }
  | { kind: "time"; start: number; minutes: number; timeZone: string; date: string; why: string }
  | { kind: "notes"; text: string; why: string };

type Part = { type: string; input?: unknown; output?: unknown; text?: string };

const record = (value: unknown) => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {});

const text = (value: unknown) => (typeof value === "string" ? value : "");

const proposalOf = (part: Part) => {
  const input = record(part.input);
  const output = record(part.output);
  const why = text(input.why);
  if (part.type === "tool-propose_steps" && Array.isArray(input.steps))
    return { kind: "steps", steps: input.steps.map(text).filter((step) => step.trim() !== ""), why } satisfies Proposal;
  if (part.type === "tool-propose_estimate" && typeof input.minutes === "number") return { kind: "estimate", minutes: input.minutes, why } satisfies Proposal;
  if (part.type === "tool-propose_notes" && typeof input.text === "string") return { kind: "notes", text: input.text, why } satisfies Proposal;
  if (part.type === "tool-propose_time" && typeof output.start === "number" && typeof input.minutes === "number")
    return { kind: "time", start: output.start, minutes: input.minutes, timeZone: text(output.timeZone), date: text(output.date), why } satisfies Proposal;
  return null;
};

export type AskPhase =
  | { kind: "idle" }
  | { kind: "asking" }
  | { kind: "reading"; verb: VerbId | null; request: string }
  | { kind: "writing"; verb: VerbId | null; request: string; words: string }
  | { kind: "proposed"; verb: VerbId | null; request: string; words: string; proposal: Proposal | null; answeredBy: string | null }
  | { kind: "failed"; request: string };

type Asked = { jobId: Id<"jobs">; threadId: string; verb: VerbId | null; request: string } | null;

const useOnline = () => {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  return online;
};

export const useTaskAsk = (task: PlannerTask, today: string) => {
  const [open, setOpen] = useState(false);
  const openBox = useCallback(() => setOpen(true), []);
  const [asked, setAsked] = useState<Asked>(null);
  const [sending, setSending] = useState<{ verb: VerbId | null; request: string } | null>(null);
  const online = useOnline();
  const start = useMutation(api.ai.runs.start);
  const change = useChange();
  const overview = useQuietView(api.ai.routing.overview, {});
  const available = overview?.capabilities.some((state) => state.capability === "agent" && state.on && state.answering !== null) ?? false;
  const run = useQuietView(api.ai.runs.get, asked ? { jobId: asked.jobId } : "skip");
  const { results } = useUIMessages(api.ai.runs.messages, asked ? { threadId: asked.threadId } : "skip", { initialNumItems: 6, stream: true });
  const lastAsk = results.findLastIndex((message) => message.role === "user");
  const parts = results.slice(lastAsk + 1).flatMap((message) => (message.role === "assistant" ? (message.parts as Part[]) : []));
  const words = parts
    .filter((part) => part.type === "text")
    .map((part) => text(part.text).trim())
    .filter((said) => said !== "")
    .join(" ");
  const proposal = parts.map(proposalOf).findLast((found) => found !== null) ?? null;

  const pending = sending ?? (asked && { verb: asked.verb, request: asked.request });
  const phaseOf = () => {
    if (!open) return { kind: "idle" } satisfies AskPhase;
    if (!pending) return { kind: "asking" } satisfies AskPhase;
    if (run?.status === "failed") return { kind: "failed", request: pending.request } satisfies AskPhase;
    if (run?.status === "done") return { kind: "proposed", ...pending, words, proposal, answeredBy: run.answeredBy } satisfies AskPhase;
    return words ? ({ kind: "writing", ...pending, words } satisfies AskPhase) : ({ kind: "reading", ...pending } satisfies AskPhase);
  };
  const phase: AskPhase = phaseOf();

  const close = () => {
    setOpen(false);
    setAsked(null);
    setSending(null);
  };

  const ask = (verb: VerbId | null, request: string) => {
    setSending({ verb, request });
    setAsked(null);
    void start({ request, mode: "ask", taskId: task._id })
      .then((result) => {
        if (result.ok) setAsked({ ...result.value, verb, request });
        else setAsked(null);
        setSending(null);
        if (!result.ok) close();
      })
      .catch(() => close());
  };

  const actions = taskActions(change, task, today, askToConfirm);

  const keep = (kept: Proposal) => {
    close();
    if (kept.kind === "estimate") return void actions.setEstimate(kept.minutes);
    if (kept.kind === "notes") return void actions.setNotes(task.notes.trim() === "" ? kept.text : `${task.notes.trimEnd()}\n\n${kept.text}`);
    if (kept.kind === "steps") {
      const orders = generateNKeysBetween(task.checklist.at(-1)?.order ?? null, null, kept.steps.length);
      const added = kept.steps.map((title, index) => ({ _id: `optimistic:${orders[index]}` as Id<"checklistItems">, title, done: false, order: orders[index] ?? "" }));
      haptic("complete");
      return void change({
        title: added.length === 1 ? "Added 1 step" : `Added ${added.length} steps`,
        mutation: api.ai.steps.accept,
        args: { taskId: task._id, titles: kept.steps },
        apply: patchTask(task._id, (current) => ({ ...current, checklist: [...current.checklist, ...added] })),
        revert: patchTask(task._id, (current) => ({ ...current, checklist: current.checklist.filter((item) => !added.some((entry) => entry._id === item._id)) })),
      });
    }
    const block = { _id: `optimistic:block:${kept.start}` as Id<"workBlocks">, start: kept.start, minutes: kept.minutes, done: false };
    return void change({
      title: "Work Block planned",
      mutation: api.planner.workBlocks.create,
      args: { taskId: task._id, start: kept.start, minutes: kept.minutes, timeZone: kept.timeZone, date: kept.date },
      apply: patchTask(task._id, (current) => ({ ...current, workBlocks: [...current.workBlocks, block] })),
      revert: patchTask(task._id, (current) => ({ ...current, workBlocks: current.workBlocks.filter((entry) => entry._id !== block._id) })),
    });
  };

  return { phase, open: openBox, close, ask, keep, online, available };
};

export type TaskAsk = ReturnType<typeof useTaskAsk>;
