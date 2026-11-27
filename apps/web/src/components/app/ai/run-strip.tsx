"use client";

import { useUIMessages } from "@convex-dev/agent/react";
import { ArrowCounterClockwise, Check, X } from "@phosphor-icons/react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useRef, useState } from "react";
import { api } from "@lifeos/backend/api";
import { MODELS, isModelId } from "@lifeos/backend/ai";
import type { Id } from "@lifeos/backend/dataModel";
import { AiOrb, type AiState } from "@/components/lifeos/ai-orb";
import { Button, IconButton } from "@/components/ui/action-button";
import { Checkbox } from "@/components/ui/choice-controls";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { useQuietView } from "../hooks";
import { AI_RING } from "./ask-box";
import { openRun, useOpenRun } from "./open-run";

type Run = NonNullable<FunctionReturnType<typeof api.ai.runs.live>>;
type Part = { type: string; state?: string; input?: unknown; text?: string; approval?: { id: string } };
type Message = { role: string; parts: unknown[]; key: string };

const READS = /^(get|list|search|find|recent|preview)_/;

const humanise = (tool: string) => {
  const words = tool.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const inputLine = (input: unknown) => {
  const fields = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const shown = [fields.title, fields.name, fields.query, fields.status, fields.when].filter((value): value is string => typeof value === "string");
  return shown.join(", ");
};

const askLabel = (part: Part) => {
  const tool = part.type.replace(/^tool-/, "");
  const fields = typeof part.input === "object" && part.input !== null ? (part.input as Record<string, unknown>) : {};
  if (tool === "set_task_status" && fields.status === "trashed") return "Move a Task to the Trash";
  if (tool === "convert_task_to_project") return "Turn a Task into a Project";
  return `${humanise(tool)}${inputLine(part.input) ? `: ${inputLine(part.input)}` : ""}`;
};

const changesWord = (count: number) => (count >= 11 ? "more than 10 changes" : count === 1 ? "1 change" : `${count} changes`);

const STRIP: Record<Run["status"], { orb: AiState; dot?: string }> = {
  working: { orb: "reading" },
  needsYou: { orb: "needsYou", dot: "bg-brand" },
  done: { orb: "done", dot: "bg-positive" },
  failed: { orb: "idle", dot: "bg-negative" },
};

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

const stripWords = (run: Run, online: boolean) => {
  if (!online && run.status === "working") return "Waiting for a connection";
  if (run.status === "working") return run.request;
  if (run.status === "needsYou") return "Needs you: a change waits for your OK";
  if (run.status === "done") return run.undone ? "Done, then undone" : run.changes === 0 ? "Done. Nothing changed" : `Done. ${changesWord(run.changes)}`;
  return run.changes === 0 ? "Stopped. Nothing changed" : `Stopped. ${changesWord(run.changes)} kept`;
};

const Gate = ({ run, parts }: { run: Run; parts: Part[] }) => {
  const respond = useMutation(api.ai.runs.respond);
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
  const asks = parts.filter((part) => part.state === "approval-requested" && part.approval);
  if (asks.length === 0) return null;
  const decide = (approve: boolean) =>
    void respond({ jobId: run.jobId, decisions: asks.map((part) => ({ approvalId: part.approval?.id ?? "", approved: approve && !unticked.has(part.approval?.id ?? "") })) });
  return (
    <section aria-label="Asking first" className="rounded-xl p-3 outline-[1.5px] -outline-offset-[1.5px] outline-foreground/25 outline-dashed">
      <h3 className="text-small font-medium">Nothing has changed yet</h3>
      <p className="mt-0.5 text-small text-pretty text-muted-foreground">This one is hard to take back, so LifeOS AI asks first.</p>
      <ul className="mt-2 grid gap-1.5">
        {asks.map((part) => {
          const id = part.approval?.id ?? "";
          return (
            <li key={id}>
              <Checkbox
                checked={!unticked.has(id)}
                onCheckedChange={(checked) => {
                  haptic("toggle");
                  setUnticked((current) => {
                    const next = new Set(current);
                    if (checked) next.delete(id);
                    else next.add(id);
                    return next;
                  });
                }}
                label={askLabel(part)}
              />
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex gap-1.5">
        <Button variant="primary" onClick={() => decide(true)} disabled={asks.every((part) => unticked.has(part.approval?.id ?? ""))}>
          Do it
        </Button>
        <Button variant="quiet" onClick={() => decide(false)}>
          Not now
        </Button>
      </div>
    </section>
  );
};

const Receipt = ({ run }: { run: Run }) => {
  const entries = useQuietView(api.ai.runs.receipt, { jobId: run.jobId }) ?? [];
  const undo = useMutation(api.platform.undo.undo);
  const undoRun = useMutation(api.platform.undo.undoRun);
  if (entries.length === 0) return null;
  return (
    <section aria-label="Receipt" className="rounded-xl bg-foreground/[0.04] p-3">
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-small font-medium">{run.undone ? "All undone" : `Done: ${changesWord(entries.length)}`}</h3>
        {!run.undone && (
          <Button variant="quiet" icon={ArrowCounterClockwise} iconWeight="bold" onClick={() => void undoRun({ jobId: run.jobId })}>
            Undo all
          </Button>
        )}
      </div>
      <ul className="mt-1.5 grid gap-1">
        {entries.map((entry) => (
          <li key={entry.id} className={cn("flex min-h-7 items-center gap-2 text-small", entry.undone && "text-faint-foreground line-through")}>
            <Check weight="bold" className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{entry.subject ? `${humanise(entry.action.replace(/^[a-zA-Z]+\./, ""))}: ${entry.subject}` : humanise(entry.action)}</span>
            {!entry.undone && !run.undone && (
              <Button variant="quiet" className="h-7 px-2" onClick={() => void undo({ activityId: entry.id as Id<"activity"> })}>
                Undo
              </Button>
            )}
          </li>
        ))}
      </ul>
      {run.answeredBy && (
        <p translate="no" className="mt-2 text-right text-micro text-faint-foreground">
          {isModelId(run.answeredBy) ? MODELS[run.answeredBy].title : run.answeredBy}
        </p>
      )}
    </section>
  );
};

const Body = ({ run, messages }: { run: Run; messages: Message[] }) => (
  <div className="grid gap-2.5">
    {messages.slice(1).map((message) => {
      const parts = message.parts as Part[];
      if (message.role === "user")
        return (
          <p key={message.key} className="text-small text-muted-foreground">
            You: {parts.map((part) => part.text ?? "").join(" ")}
          </p>
        );
      return (
        <div key={message.key} className="grid gap-1.5">
          {parts.map((part, index) => {
            if (part.type === "text" && part.text?.trim()) return <p key={index} className="text-small text-pretty">{part.text}</p>;
            if (!part.type.startsWith("tool-") || part.state === "approval-requested") return null;
            const tool = part.type.replace(/^tool-/, "");
            return (
              <p key={index} className="flex items-center gap-2 text-micro text-muted-foreground">
                <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", READS.test(tool) ? "bg-foreground/25" : "bg-foreground/60")} />
                <span className="truncate">
                  {READS.test(tool) ? "Read" : "Changed"}: {humanise(tool)}
                  {inputLine(part.input) ? `, ${inputLine(part.input)}` : ""}
                </span>
              </p>
            );
          })}
        </div>
      );
    })}
    {run.status === "needsYou" && <Gate run={run} parts={messages.flatMap((message) => message.parts as Part[])} />}
    {(run.status === "done" || run.status === "failed") && <Receipt run={run} />}
  </div>
);

const Sheet = ({ run, onHide }: { run: Run; onHide: () => void }) => {
  const { results } = useUIMessages(api.ai.runs.messages, run.threadId ? { threadId: run.threadId } : "skip", { initialNumItems: 30, stream: true });
  const tell = useMutation(api.ai.runs.tell);
  const [said, setSaid] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [results.length, run.status]);
  return (
    <div role="dialog" aria-label="Run" className={cn("pointer-events-auto flex max-h-[min(36rem,70dvh)] w-[min(27rem,calc(100vw-2rem))] flex-col rounded-2xl bg-popover shadow-float", AI_RING)}>
      <div className="flex items-start gap-2 px-4 pt-3.5 pb-2">
        <h2 className="min-w-0 flex-1 text-body font-medium text-pretty">{run.request}</h2>
        <IconButton icon={X} iconWeight="bold" label="Hide" onClick={onHide} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3">
        <Body run={run} messages={results as Message[]} />
        <div ref={end} />
      </div>
      {run.status !== "working" && (
        <form
          className="border-t border-foreground/[0.06] px-3 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (said.trim() === "") return;
            void tell({ jobId: run.jobId, text: said });
            setSaid("");
          }}
        >
          <input
            name="tell-run"
            aria-label="Tell it something"
            autoComplete="off"
            value={said}
            onChange={(event) => setSaid(event.target.value)}
            placeholder="Tell it something: keep Friday morning free…"
            className="h-8 w-full rounded-lg bg-foreground/[0.04] px-2.5 text-small outline-none placeholder:text-faint-foreground focus-visible:shadow-[inset_0_0_0_1.5px] focus-visible:shadow-foreground/25"
          />
        </form>
      )}
    </div>
  );
};

export const RunStrip = () => {
  const live = useQuietView(api.ai.runs.live, {});
  const opened = useOpenRun();
  const openedRun = useQuietView(api.ai.runs.get, opened ? { jobId: opened.jobId } : "skip");
  const online = useOnline();
  const stop = useMutation(api.ai.runs.stop);
  const dismiss = useMutation(api.ai.runs.dismiss);
  const undoRun = useMutation(api.platform.undo.undoRun);
  const start = useMutation(api.ai.runs.start);
  const run = opened && live?.jobId !== opened.jobId ? (openedRun ? { ...openedRun, changes: 0, undone: false } : null) : live;
  const showSheet = opened !== null && run !== null && run !== undefined;
  if (!run) return null;
  const look = STRIP[run.status];
  return (
    <div className="pointer-events-none fixed right-4 bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-30 flex flex-col items-end gap-2 md:right-6">
      {showSheet && <Sheet run={run} onHide={() => openRun(null)} />}
      <div data-run-status={run.status} className="pointer-events-auto flex h-11 max-w-[min(26rem,calc(100vw-2rem))] items-center gap-2 rounded-full bg-popover py-1 pr-1 pl-3 shadow-float">
        <button type="button" onClick={() => openRun(showSheet ? null : run.jobId)} aria-expanded={showSheet} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <AiOrb state={!online && run.status === "working" ? "offline" : look.orb} className="size-5" aria-hidden="true" />
          {look.dot && <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", look.dot)} />}
          <span role="status" className="min-w-0 truncate text-small">
            {stripWords(run, online)}
          </span>
        </button>
        {run.status === "working" && online && (
          <Button variant="quiet" onClick={() => void stop({ jobId: run.jobId })}>
            Stop
          </Button>
        )}
        {run.status === "needsYou" && !showSheet && (
          <Button variant="secondary" onClick={() => openRun(run.jobId)}>
            Open
          </Button>
        )}
        {run.status === "done" && run.changes > 0 && !run.undone && (
          <Button variant="quiet" onClick={() => void undoRun({ jobId: run.jobId })}>
            Undo all
          </Button>
        )}
        {run.status === "failed" && (
          <Button variant="quiet" onClick={() => void start({ request: run.request, mode: "run" }).then((result) => result.ok && openRun(null))}>
            Try again
          </Button>
        )}
        {(run.status === "done" || run.status === "failed") && (
          <IconButton
            icon={X}
            iconWeight="bold"
            label="Dismiss"
            onClick={() => {
              openRun(null);
              void dismiss({ jobId: run.jobId });
            }}
          />
        )}
      </div>
    </div>
  );
};
