"use client";

import { useEffect, useReducer } from "react";
import { Button } from "@/components/ui/action-button";
import { MorphText } from "@/components/ui/morph-text";
import { toast } from "@/components/ui/toast-stack";
import { AiOrb } from "@/components/lifeos/ai-orb";
import { cn } from "@/lib/utils";
import { GLASS } from "../notes/parts";
import { BriefCard, idleStatus, StepView, Tick } from "./cards";
import type { StepCard, StepStatus } from "./model";
import { BRIEF, BUILD_ASK, BUILD_EDGES, BUILD_FOLDER, BUILD_SIZE, BUILD_STEPS } from "./sample";
import { Stage } from "./stage";

type Phase = "idle" | "building" | "asking" | "running" | "kept" | "stopped";
type Build = { phase: Phase; shown: number; skipped: string[] };
type Event = { type: "start" } | { type: "tick" } | { type: "skip"; id: string } | { type: "run" } | { type: "keep" } | { type: "stop" } | { type: "undo" };

const START: Build = { phase: "idle", shown: 0, skipped: [] };

const buildReducer = (state: Build, event: Event) => {
  if (event.type === "start") return { ...START, phase: "building" } satisfies Build;
  if (event.type === "undo") return START;
  if (event.type === "tick" && state.phase === "building") {
    const shown = state.shown + 1;
    return { ...state, shown, phase: shown >= BUILD_STEPS.length ? "asking" : "building" } satisfies Build;
  }
  if (event.type === "skip" && state.phase === "asking") {
    const skipped = state.skipped.includes(event.id) ? state.skipped.filter((id) => id !== event.id) : [...state.skipped, event.id];
    return { ...state, skipped };
  }
  if (event.type === "run" && (state.phase === "asking" || state.phase === "kept" || state.phase === "stopped")) return { ...state, phase: "running" } satisfies Build;
  if (event.type === "keep" && state.phase === "asking") return { ...state, phase: "kept" } satisfies Build;
  if (event.type === "stop" && state.phase === "running") return { ...state, phase: "stopped" } satisfies Build;
  return state;
};

const statusOf = (step: StepCard, state: Build, first: StepCard | undefined) => {
  if (state.skipped.includes(step.id)) return { state: "idle", words: "Left out" } satisfies StepStatus;
  if (state.phase === "running" && first) {
    return step.id === first.id
      ? ({ state: "running", words: step.runner === "claude" ? "Claude Code is working" : "Running" } satisfies StepStatus)
      : ({ state: "waiting", words: `Waiting for ${first.title}` } satisfies StepStatus);
  }
  if (state.phase === "stopped" && step.id === first?.id) return { state: "failed", words: "Stopped by you" } satisfies StepStatus;
  return idleStatus(step);
};

const STRIP = cn("absolute bottom-3 left-1/2 z-30 flex h-11 w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-2.5 rounded-full py-1 pr-1.5 pl-3.5 text-small", GLASS);

const Gate = ({ state, send }: { state: Build; send: (event: Event) => void }) => {
  const count = BUILD_STEPS.length - state.skipped.length;
  return (
    <section data-still aria-label="Asks first" className={cn("absolute inset-x-3 bottom-3 z-30 animate-fade-in rounded-2xl p-3 sm:right-auto sm:w-[26rem]", GLASS)}>
      <div className="rounded-xl border border-dashed border-foreground/25 p-3">
        <p className="text-small font-medium">Nothing has run yet</p>
        <p className="text-small text-pretty text-muted-foreground">
          These Steps run commands on this Mac. They can write only inside{" "}
          <code translate="no" className="font-mono text-micro text-foreground">
            {BUILD_FOLDER}
          </code>
          .
        </p>
        <ul className="mt-2 space-y-1">
          {BUILD_STEPS.map((step) => {
            const off = state.skipped.includes(step.id);
            return (
              <li key={step.id} className="flex items-start gap-2.5">
                <span className="grid h-5 place-items-center">
                  <Tick on={!off} onToggle={() => send({ type: "skip", id: step.id })} label={`Run ${step.title}`} />
                </span>
                <div className={cn("min-w-0 flex-1 transition-opacity duration-(--dur-fast)", off && "opacity-45")}>
                  <p className="flex items-baseline gap-2 text-small">
                    <span className="truncate font-medium">{step.title}</span>
                    {step.reach.length > 0 && <span className="ml-auto shrink-0 text-micro text-muted-foreground">{step.reach.join(", ")}</span>}
                  </p>
                  <code translate="no" className="block truncate font-mono text-[11px] leading-4 text-muted-foreground">
                    {step.command}
                  </code>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Button variant="primary" disabled={count === 0} onClick={() => send({ type: "run" })}>
            Run {count}
          </Button>
          <Button onClick={() => send({ type: "keep" })}>Keep, do not run</Button>
          <Button variant="quiet" onClick={() => send({ type: "undo" })}>
            Undo all
          </Button>
        </div>
      </div>
    </section>
  );
};

const Strip = ({ state, send, first }: { state: Build; send: (event: Event) => void; first: StepCard | undefined }) => {
  if (state.phase === "idle")
    return (
      <div data-still className={STRIP}>
        <AiOrb state="idle" aria-hidden="true" />
        <p className="min-w-0 truncate">{BUILD_ASK}</p>
        <Button variant="primary" onClick={() => send({ type: "start" })}>
          Build it
        </Button>
      </div>
    );
  if (state.phase === "building") {
    const adding = BUILD_STEPS[Math.min(state.shown, BUILD_STEPS.length - 1)];
    return (
      <div data-still role="status" className={cn(STRIP, "pr-4")}>
        <AiOrb state="writing" aria-hidden="true" />
        <MorphText>{`Adding ${adding?.title ?? ""}`}</MorphText>
        <span className="font-mono text-micro text-muted-foreground tabular-nums">
          {Math.min(state.shown + 1, BUILD_STEPS.length)} of {BUILD_STEPS.length}
        </span>
      </div>
    );
  }
  if (state.phase === "running")
    return (
      <div data-still role="status" className={STRIP}>
        <AiOrb state="reading" aria-hidden="true" />
        <p className="min-w-0 truncate">Running on this Mac: {first?.title}</p>
        <Button variant="danger" onClick={() => send({ type: "stop" })}>
          Stop
        </Button>
      </div>
    );
  return (
    <div data-still role="status" className={STRIP}>
      <AiOrb state="done" aria-hidden="true" />
      <p className="min-w-0 truncate">{state.phase === "stopped" ? "Stopped. Every command was ended" : `Kept ${BUILD_STEPS.length} Steps. Nothing has run`}</p>
      <Button variant="primary" onClick={() => send({ type: "run" })}>
        Run
      </Button>
      <Button
        variant="quiet"
        onClick={() => {
          send({ type: "undo" });
          toast("All undone. The canvas is as it was", { id: "canvas-undo" });
        }}
      >
        Undo all
      </Button>
    </div>
  );
};

export const BuildCanvas = () => {
  const [state, send] = useReducer(buildReducer, START);
  useEffect(() => {
    if (state.phase !== "building") return;
    const timer = window.setTimeout(() => send({ type: "tick" }), state.shown === 0 ? 500 : 620);
    return () => window.clearTimeout(timer);
  }, [state.phase, state.shown]);

  const steps = BUILD_STEPS.slice(0, state.shown);
  const ids = new Set(["brief", ...steps.map((step) => step.id)]);
  const edges = BUILD_EDGES.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
  const pencil = state.phase === "building" || state.phase === "asking";
  const first = BUILD_STEPS.find((step) => !state.skipped.includes(step.id));
  const drawn = new Set(pencil ? [...steps.map((step) => step.id), ...edges.map((edge) => edge.id)] : []);
  const live = new Set(state.phase === "running" ? ["brief-write"] : []);

  return (
    <Stage
      label="Canvas: Launch film"
      size={BUILD_SIZE}
      cards={[BRIEF, ...steps]}
      edges={edges}
      pencil={drawn}
      live={live}
      focus={{ x: 300, y: 120 }}
      overlay={state.phase === "asking" ? <Gate state={state} send={send} /> : <Strip state={state} send={send} first={first} />}
    >
      {(card) => {
        if (card.kind === "step") return <StepView step={card} status={statusOf(card, state, first)} pencil={pencil} />;
        return card.kind === "text" ? <BriefCard card={card} /> : null;
      }}
    </Stage>
  );
};
