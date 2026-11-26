"use client";

import { ArrowCounterClockwise, CaretDown, Check } from "@phosphor-icons/react";
import { useEffect, useReducer, useRef, useState } from "react";
import { Button, IconButton } from "@/components/ui/action-button";
import { KeyCombo } from "@/components/ui/key-hint";
import { MorphText } from "@/components/ui/morph-text";
import { toast } from "@/components/ui/toast-stack";
import { AiMark, AiMarkWorking } from "@/components/lifeos/ai-mark";
import { TaskRow, type TaskSummary } from "@/components/lifeos/task-row";
import { cn } from "@/lib/utils";
import { Specimen } from "../specimen";
import { PartView, type PartActions } from "./agent";
import { useCmdJTarget } from "./ask";
import { DayColumn } from "./graphs";
import { RUN_START, runReducer, runStatus, type Part, type RunStatus, type StepState } from "./model";
import { AI_RING } from "./parts";
import { RUN_ASK, RUN_CHANGES, runMade, runParts, runSteps, runWords, THURSDAY, thursdayAt } from "./sample";

const TICK_MS = 780;

const DOT: Record<StepState, string> = {
  done: "bg-foreground/65",
  doing: "animate-pending bg-foreground/65 motion-reduce:animate-none",
  waiting: "bg-brand",
  todo: "bg-foreground/[0.14]",
};

const StatusGlyph = ({ status }: { status: RunStatus }) => {
  if (status === "working") return <AiMarkWorking weight="bold" className="size-4 text-foreground/70" aria-hidden="true" />;
  if (status === "done")
    return (
      <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center rounded-full bg-positive/85 text-background">
        <Check weight="bold" className="size-2.5" />
      </span>
    );
  return (
    <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center">
      <span className={cn("size-2 rounded-full", status === "needs-you" && "bg-brand", status === "offline" && "shadow-[inset_0_0_0_1.5px] shadow-muted-foreground", status === "failed" && "bg-negative/80")} />
    </span>
  );
};

export const RunStrip = ({
  status,
  words,
  steps,
  open = false,
  onOpen,
  action,
  main,
  className,
}: {
  status: RunStatus;
  words: string;
  steps: StepState[];
  open?: boolean;
  onOpen?: (() => void) | undefined;
  action?: { label: string; run: () => void } | undefined;
  main?: React.Ref<HTMLButtonElement>;
  className?: string;
}) => (
  <div role="group" aria-label="LifeOS AI run" data-run={status} className={cn("inline-flex h-11 max-w-full items-center gap-1 rounded-full bg-popover p-1 shadow-float", AI_RING, className)}>
    <span role="status" className="sr-only">
      {words}
    </span>
    <button
      ref={main}
      type="button"
      aria-expanded={open}
      onClick={onOpen}
      className="flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-full pr-3 pl-2.5 text-left text-small transition-[background-color,scale] duration-(--dur-press) ease-out hover:bg-foreground/[0.05] active:scale-[0.98]"
    >
      <StatusGlyph status={status} />
      <span className="min-w-0 truncate font-medium">
        <MorphText>{words}</MorphText>
      </span>
      <span aria-hidden="true" className="flex shrink-0 items-center gap-[3px] pl-0.5">
        {steps.map((state, index) => (
          <span key={index} className={cn("size-1.5 rounded-full transition-colors duration-(--dur-base)", DOT[state])} />
        ))}
      </span>
    </button>
    {action && (
      <button
        type="button"
        onClick={action.run}
        className="h-9 shrink-0 rounded-full bg-foreground/[0.06] px-3.5 text-small font-medium transition-[background-color,scale] duration-(--dur-press) ease-out hover:bg-foreground/[0.1] active:scale-[0.96]"
      >
        {action.label}
      </button>
    )}
  </div>
);

const partKey = (part: Part) => part.kind;

const anchorOf = (parts: Part[]) => {
  if (parts.some((part) => part.kind === "receipt")) return parts.length;
  const asking = parts.findIndex((part) => part.kind === "decision" && part.chosen === undefined);
  return asking > 0 ? asking - 1 : 0;
};

export const RunSheet = ({ title, parts, act, steering, onHide, className }: { title: string; parts: Part[]; act: PartActions; steering: boolean; onHide: () => void; className?: string }) => {
  const body = useRef<HTMLDivElement>(null);
  const anchor = anchorOf(parts);
  useEffect(() => {
    const scroller = body.current;
    if (!scroller) return;
    const target = scroller.children[anchor];
    scroller.scrollTo({ top: target instanceof HTMLElement ? target.offsetTop - scroller.offsetTop : scroller.scrollHeight });
  }, [anchor]);
  return (
    <section aria-label={title} className={cn("flex max-h-[33rem] w-full flex-col overflow-hidden rounded-2xl bg-popover shadow-float", AI_RING, className)}>
      <header className="flex items-center gap-2 py-2 pr-2 pl-4">
        <h4 className="min-w-0 flex-1 truncate text-heading font-medium">{title}</h4>
        <IconButton icon={CaretDown} iconWeight="bold" label="Hide. The run keeps going" onClick={onHide} />
      </header>
      <div ref={body} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pt-1 pb-4 [mask-image:linear-gradient(to_bottom,transparent,black_0.75rem,black_calc(100%-0.75rem),transparent)]">
        {parts.map((part) => (
          <div key={partKey(part)} className="animate-screen-in">
            <PartView part={part} act={act} />
          </div>
        ))}
      </div>
      {steering && (
        <label className="mx-2 mb-2 flex h-9 shrink-0 items-center gap-2.5 rounded-xl bg-foreground/[0.04] px-2.5 transition-[background-color,box-shadow] duration-(--dur-fast) focus-within:bg-foreground/[0.07] focus-within:shadow-[inset_0_0_0_1.5px] focus-within:shadow-foreground/25">
          <AiMark weight="bold" className="size-4 text-foreground/55" aria-hidden="true" />
          <input
            type="text"
            name="steer-run"
            aria-label="Tell the run something"
            autoComplete="off"
            placeholder="Tell it something: keep Friday morning free…"
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing || event.currentTarget.value.trim() === "") return;
              event.currentTarget.value = "";
              toast("It will take that into account", { id: "steer" });
            }}
            className="min-w-0 flex-1 bg-transparent text-small outline-none placeholder:text-faint-foreground"
          />
        </label>
      )}
    </section>
  );
};

const LIST: TaskSummary[] = [
  { id: "outline", title: "Draft the thesis outline", area: { name: "University", colour: "violet" }, project: "Honours thesis", estimate: 90, deadline: { label: "Sun 22 Nov" } },
  { id: "rerun", title: "Rerun the hybrid on the small index", area: { name: "University", colour: "violet" }, project: "Honours thesis", estimate: 90, plannedAt: "11:15" },
  { id: "copy", title: "Review the onboarding copy", area: { name: "Korvant", colour: "teal" }, estimate: 45, plannedAt: "1:45" },
  { id: "reading", title: "Read two papers on retrieval", area: { name: "University", colour: "violet" }, project: "Honours thesis", estimate: 60, plannedAt: "2:30" },
];

const RunWindow = () => {
  const root = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLButtonElement>(null);
  const [run, send] = useReducer(runReducer, RUN_START);
  const [started, setStarted] = useState(false);
  const [open, setOpen] = useState(true);
  const hide = () => {
    setOpen(false);
    strip.current?.focus({ preventScroll: true });
  };
  const status = runStatus(run);
  const ticking = started && status === "working";
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => send({ type: "tick" }), TICK_MS);
    return () => clearInterval(timer);
  }, [ticking]);
  const start = () => {
    send({ type: "reset" });
    setStarted(true);
    setOpen(true);
    root.current?.focus({ preventScroll: true });
  };
  const stop = () => {
    setStarted(false);
    send({ type: "reset" });
    root.current?.focus({ preventScroll: true });
    toast("Stopped. Nothing was changed", { id: "run-stop" });
  };
  useCmdJTarget(root, () => (started ? setOpen(true) : start()));
  const changes = run.choice ? (RUN_CHANGES[run.choice] ?? []) : [];
  const act: PartActions = {
    choose: (option) => send({ type: "choose", option }),
    undo: (change) => send({ type: "undo", change }),
    undoAll: (ids) => send({ type: "undo-all", changes: ids }),
    redoAll: () => send({ type: "redo-all" }),
    unlearn: () => send({ type: "unlearn" }),
  };
  const allUndone = status === "done" && runMade(run) === 0;
  const action =
    status === "working"
      ? { label: "Stop", run: stop }
      : status === "done"
        ? allUndone
          ? { label: "Redo all", run: () => send({ type: "redo-all" }) }
          : { label: "Undo all", run: () => send({ type: "undo-all", changes: changes.map((change) => change.id) }) }
        : open
          ? undefined
          : { label: "Open", run: () => setOpen(true) };
  return (
    <div ref={root} tabIndex={-1} role="group" aria-label="A longer run in the Planner" className={cn("@container relative flex w-full flex-1 flex-col outline-none", AI_RING)}>
      <div className={cn("grid flex-1 gap-x-6 gap-y-4 transition-opacity duration-(--dur-base) ease-out @3xl:grid-cols-[minmax(0,1fr)_minmax(0,17rem)]", started && open && "opacity-55")}>
        <div className="min-w-0">
          <div className="flex h-8 items-baseline gap-2 px-3">
            <h4 className="text-heading font-medium">Thursday</h4>
            <span className="text-small text-muted-foreground">19 Nov</span>
          </div>
          {LIST.map((task) => (
            <TaskRow key={task.id} task={task} completed={false} onCompletedChange={() => undefined} />
          ))}
        </div>
        <DayColumn from={THURSDAY.from} to={THURSDAY.to} spans={thursdayAt(run)} className="@max-3xl:hidden" />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-2">
        {started && open && (
          <RunSheet title={RUN_ASK} parts={runParts(run)} act={act} steering={status === "working"} onHide={hide} className="pointer-events-auto max-w-[27rem] animate-screen-in" />
        )}
        <div className="pointer-events-auto flex max-w-full items-center gap-2">
          {started ? (
            <RunStrip main={strip} status={status} words={runWords(run)} steps={runSteps(run).map((step) => step.state)} open={open} onOpen={() => setOpen(!open)} action={action} className="animate-screen-in" />
          ) : (
            <Button variant="secondary" size="md" icon={AiMark} iconWeight="bold" onClick={start} className="gap-2.5 shadow-float">
              {RUN_ASK}
              <KeyCombo keys="mod+j" />
            </Button>
          )}
          {started && status === "done" && <IconButton icon={ArrowCounterClockwise} iconWeight="bold" label="Play it again" variant="secondary" onClick={start} className="size-9 shadow-float" />}
        </div>
      </div>
    </div>
  );
};

const ALL_DONE: StepState[] = ["done", "done", "done", "done", "done"];

const STRIPS: { status: RunStatus; words: string; steps: StepState[]; action?: string; note: string }[] = [
  { status: "working", words: "Checking the next 4 days", steps: ["done", "doing", "todo", "todo", "todo"], action: "Stop", note: "One line says what it is doing. A dot for each step." },
  { status: "needs-you", words: "Needs you: pick one", steps: ["done", "done", "waiting", "todo", "todo"], action: "Open", note: "It waits. No sound, no badge, no timeout." },
  { status: "done", words: "Done. 3 changes", steps: ALL_DONE, action: "Undo all", note: "It stays until you dismiss it, then lives in Activity." },
  { status: "offline", words: "Waiting for a connection", steps: ["done", "doing", "todo", "todo", "todo"], note: "It carries on when you are back online. Nothing is lost." },
  { status: "failed", words: "Stopped. Nothing changed", steps: ["done", "done", "todo", "todo", "todo"], action: "Try again", note: "It says what happened to your data first." },
];

const StripStates = () => (
  <ul className="w-full max-w-[24rem] space-y-4 self-center">
    {STRIPS.map((strip) => (
      <li key={strip.status}>
        <RunStrip status={strip.status} words={strip.words} steps={strip.steps} action={strip.action ? { label: strip.action, run: () => undefined } : undefined} />
        <p className="mt-1.5 px-3 text-small text-pretty text-muted-foreground">{strip.note}</p>
      </li>
    ))}
  </ul>
);

const HISTORY: { id: string; at: string; title: string; detail: string; status: RunStatus; action: string }[] = [
  { id: "room", at: "9:41 am", title: "Made room for the thesis outline", detail: "3 changes", status: "done", action: "Undo" },
  { id: "tasks", at: "Tue", title: "Turned 3 lines into Tasks", detail: "Supervision, 17 Nov", status: "done", action: "Undo" },
  { id: "japan", at: "Sun", title: "Plan the Japan trip week", detail: "Needs you: pick the ferry day", status: "needs-you", action: "Resume" },
  { id: "pages", at: "Sun", title: "Indexed 6 notebook pages", detail: "No changes to your notes", status: "done", action: "Open" },
];

const History = () => (
  <ul aria-label="AI runs in Activity" className="w-full max-w-[34rem] self-center">
    {HISTORY.map((entry) => (
      <li key={entry.id} className="flex items-center gap-3 rounded-xl py-2 pr-1 pl-3 transition-colors duration-(--dur-fast) hover:bg-foreground/[0.04]">
        <span className="w-12 shrink-0 text-micro text-muted-foreground">{entry.at}</span>
        <StatusGlyph status={entry.status} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-small">{entry.title}</span>
          <span className={cn("block truncate text-micro", entry.status === "needs-you" ? "font-medium text-brand" : "text-muted-foreground")}>{entry.detail}</span>
        </span>
        <Button variant="quiet" aria-label={`${entry.action}: ${entry.title}`} onClick={() => toast(entry.action === "Undo" ? `Undone: ${entry.title}` : `${entry.title} opens`, { id: "history" })} className="px-2.5">
          {entry.action}
        </Button>
      </li>
    ))}
  </ul>
);

export const RunSpecimens = () => (
  <>
    <Specimen
      name="A run, start to finish"
      note="Press the button. The run sits in a strip at the foot of the window and opens into a sheet. It reads, plans, asks you the one thing it cannot know, makes the changes and hands you the receipt. Hide it and it keeps going."
      className="md:col-span-6 xl:col-span-8 xl:row-span-2"
      stage="min-h-[42rem] items-stretch justify-start p-4 sm:p-5"
    >
      <RunWindow />
    </Specimen>
    <Specimen name="The strip" note="The whole run in one pill. It is the only AI thing that stays on screen, and it goes when the run is done." className="md:col-span-3 xl:col-span-4" stage="items-stretch justify-center bg-surface">
      <StripStates />
    </Specimen>
    <Specimen name="Later, in Activity" note="Every run is one entry, under a Runs filter. Undo the whole run, open its receipt, or pick up one that is waiting for you." className="md:col-span-3 xl:col-span-4" stage="items-stretch justify-center p-2 sm:p-3">
      <History />
    </Specimen>
  </>
);
