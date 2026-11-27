"use client";

import { useMutation } from "convex/react";
import { api } from "@lifeos/backend/api";
import { AiOrb } from "@/components/lifeos/ai-orb";
import { Button } from "@/components/ui/action-button";
import { useQuietView } from "../hooks";
import { openRun } from "./open-run";

const STATUS_WORDS = { working: "Working", needsYou: "Needs you", done: "Done", failed: "Stopped" } as const;

const when = new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

const changes = (count: number) => (count >= 11 ? "more than 10 changes" : count === 1 ? "1 change" : `${count} changes`);

export const RunList = () => {
  const runs = useQuietView(api.ai.runs.recent, {});
  const undoRun = useMutation(api.platform.undo.undoRun);
  if (!runs) return null;
  if (runs.length === 0)
    return <p className="py-10 text-center text-small text-pretty text-muted-foreground">No runs yet. Press Cmd+J on a Task, type what you want done, and pick Do it.</p>;
  return (
    <ul aria-label="Runs" className="grid gap-1">
      {runs.map((run) => (
        <li key={run.jobId} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-foreground/[0.03]">
          <AiOrb state={run.status === "working" ? "reading" : run.status === "needsYou" ? "needsYou" : "done"} className="size-5" aria-hidden="true" />
          <button type="button" onClick={() => openRun(run.jobId)} className="min-w-0 flex-1 text-left">
            <span className="block truncate text-body">{run.request}</span>
            <span className="block text-micro text-muted-foreground">
              {STATUS_WORDS[run.status]}
              {run.changes > 0 ? `, ${changes(run.changes)}` : ""}
              {run.undone ? ", undone" : ""} · {when.format(run.startedAt)}
            </span>
          </button>
          {run.changes > 0 && !run.undone && (run.status === "done" || run.status === "failed") && (
            <Button variant="quiet" onClick={() => void undoRun({ jobId: run.jobId })}>
              Undo run
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
};
