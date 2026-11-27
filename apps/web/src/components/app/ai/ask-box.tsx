"use client";

import { ArrowClockwise, CalendarPlus, Hourglass, ListChecks, NotePencil } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { MODELS, isModelId } from "@lifeos/backend/ai";
import { formatMinutes } from "@lifeos/backend/estimate";
import { AiOrb } from "@/components/lifeos/ai-orb";
import { Button } from "@/components/ui/action-button";
import { Kbd } from "@/components/ui/key-hint";
import { MorphText } from "@/components/ui/morph-text";
import type { Glyph } from "@/lib/glyph";
import { cn } from "@/lib/utils";
import { TASK_VERBS, type AskPhase, type Proposal, type TaskAsk, type VerbId } from "./task-ask";

export const AI_RING = "[--ring:color-mix(in_oklab,var(--foreground)_50%,transparent)]";

const BOX = "@container w-full max-w-[26rem] rounded-2xl bg-popover p-1.5 text-small shadow-float outline-none";

const ROW = "flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-left text-small transition-colors duration-(--dur-press) pointer-coarse:h-11";

const VERB_ICONS = { steps: ListChecks, estimate: Hourglass, time: CalendarPlus, notes: NotePencil } satisfies Record<VerbId, Glyph>;

const KEEP: Record<Proposal["kind"], (proposal: Proposal) => string> = {
  steps: (proposal) => (proposal.kind === "steps" && proposal.steps.length === 1 ? "Add 1 step" : `Add ${proposal.kind === "steps" ? proposal.steps.length : 0} steps`),
  estimate: () => "Set Estimate",
  time: () => "Plan it",
  notes: () => "Add to notes",
};

const timeOf = (start: number) => new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(start);

export const PencilDraft = ({ proposal }: { proposal: Proposal }) => (
  <div data-ink="pencil" className="grid gap-1.5 text-muted-foreground">
    <span className="sr-only">Suggested, not saved: </span>
    {proposal.kind === "steps" && (
      <ul aria-label="Suggested steps" className="grid gap-1">
        {proposal.steps.map((step, index) => (
          <li key={`${index}-${step}`} style={{ animationDelay: `${index * 45}ms` }} className="flex animate-fade-in items-center gap-2.5 motion-reduce:animate-none">
            <span aria-hidden="true" className="size-4 shrink-0 rounded-full border-[1.5px] border-dashed border-foreground/35" />
            <span className="min-w-0 text-small text-pretty">{step}</span>
          </li>
        ))}
      </ul>
    )}
    {proposal.kind === "estimate" && (
      <span className="inline-flex h-7 w-fit items-center rounded-md px-2 font-mono text-small outline-[1.5px] -outline-offset-[1.5px] outline-foreground/35 outline-dashed">
        {formatMinutes(proposal.minutes)}
      </span>
    )}
    {proposal.kind === "time" && (
      <span className="inline-flex h-7 w-fit items-center gap-2 rounded-md px-2 text-small outline-[1.5px] -outline-offset-[1.5px] outline-foreground/35 outline-dashed">
        <CalendarPlus weight="bold" className="size-3.5" aria-hidden="true" />
        {timeOf(proposal.start)}, {formatMinutes(proposal.minutes)}
      </span>
    )}
    {proposal.kind === "notes" && <p className="border-l-[3px] border-dashed border-foreground/30 pl-3 text-small whitespace-pre-wrap text-pretty">{proposal.text}</p>}
    {proposal.why && <p className="text-micro text-pretty text-faint-foreground">{proposal.why}</p>}
  </div>
);

const ModelTag = ({ model }: { model: string | null }) =>
  model ? (
    <span translate="no" className="shrink-0 text-micro whitespace-nowrap text-faint-foreground">
      {isModelId(model) ? MODELS[model].title : model}
    </span>
  ) : null;

const Asking = ({ ask, field }: { ask: TaskAsk; field: React.RefObject<HTMLInputElement | null> }) => {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const needle = query.trim().toLowerCase();
  const matches = needle ? TASK_VERBS.filter((verb) => verb.label.toLowerCase().includes(needle)) : TASK_VERBS;
  const custom = needle !== "" && matches.length === 0;
  const count = custom ? 1 : matches.length;
  const active = Math.min(at, Math.max(0, count - 1));
  const off = !ask.online;
  const pick = (index: number) => {
    if (off) return;
    const verb = matches[index];
    if (custom) ask.ask(null, query.trim());
    else if (verb) ask.ask(verb.id, verb.request);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setAt((active + (event.key === "ArrowDown" ? 1 : count - 1)) % Math.max(1, count));
    }
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      pick(active);
    }
  };
  return (
    <>
      <label className="flex h-10 items-center gap-2.5 px-2.5">
        <AiOrb state={off ? "offline" : "idle"} className="size-4" aria-hidden="true" />
        <input
          ref={field}
          type="text"
          name="ask-ai"
          role="combobox"
          aria-label="Ask LifeOS AI"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={count > 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          readOnly={off}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setAt(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={off ? "Offline" : "Ask, or pick below…"}
          className="min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-faint-foreground"
        />
        <Kbd>Esc</Kbd>
      </label>
      <ul id={listId} role="listbox" aria-label="What to do" className="px-0.5 pb-0.5">
        {custom ? (
          <li id={`${listId}-0`} role="option" aria-selected="true" aria-disabled={off} className={cn(ROW, "bg-foreground/[0.06]", off && "opacity-45")} onClick={() => pick(0)}>
            <AiOrb className="size-4" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">Ask “{query.trim()}”</span>
            <Kbd>↵</Kbd>
          </li>
        ) : (
          matches.map((verb, index) => {
            const Icon = VERB_ICONS[verb.id];
            return (
              <li
                key={verb.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={!off && index === active}
                aria-disabled={off}
                onPointerMove={() => !off && index !== active && setAt(index)}
                onClick={() => pick(index)}
                className={cn(ROW, !off && index === active && "bg-foreground/[0.06]", off ? "text-faint-foreground" : "cursor-default active:bg-foreground/[0.09]")}
              >
                <Icon weight="bold" className={cn("size-4 shrink-0", off ? "text-faint-foreground" : "text-muted-foreground")} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{verb.label}</span>
              </li>
            );
          })
        )}
      </ul>
      {off ? (
        <p role="status" className="mx-0.5 mt-1 rounded-xl bg-foreground/[0.04] px-2.5 py-2 text-small text-pretty text-muted-foreground">
          LifeOS AI needs a connection. Writing, Tasks and undo all still work.
        </p>
      ) : (
        <p className="px-2.5 pt-1.5 pb-1 text-micro text-faint-foreground">Reads this Task and your days. Nothing changes until you keep it.</p>
      )}
    </>
  );
};

const Working = ({ phase, ask }: { phase: Extract<AskPhase, { kind: "reading" | "writing" }>; ask: TaskAsk }) => {
  const verb = TASK_VERBS.find((candidate) => candidate.id === phase.verb);
  return (
    <div className="grid gap-1.5">
      <div className="flex h-10 items-center gap-2.5 pr-1 pl-2.5">
        <AiOrb state={phase.kind === "reading" ? "reading" : "writing"} className="size-4" aria-hidden="true" />
        <span role="status" className="min-w-0 flex-1 truncate text-body text-muted-foreground">
          <MorphText>{phase.kind === "reading" ? (verb?.reading ?? "Reading") : "Writing"}</MorphText>
        </span>
        <Button variant="quiet" onClick={ask.close} className="h-8 gap-2 px-2.5">
          Stop
          <Kbd>Esc</Kbd>
        </Button>
      </div>
      {phase.kind === "writing" && <p className="px-2.5 pb-1.5 text-small text-pretty text-muted-foreground">{phase.words}</p>}
    </div>
  );
};

const Proposed = ({ phase, ask, field }: { phase: Extract<AskPhase, { kind: "proposed" }>; ask: TaskAsk; field: React.RefObject<HTMLInputElement | null> }) => {
  const { proposal } = phase;
  return (
    <>
      {phase.words && <p className="px-2.5 pt-1.5 pb-1 text-small text-pretty text-muted-foreground">{phase.words}</p>}
      {proposal && (
        <div className="px-2.5 py-1.5">
          <PencilDraft proposal={proposal} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1 p-0.5">
        {proposal ? (
          <Button variant="primary" onClick={() => ask.keep(proposal)} className="gap-2">
            {KEEP[proposal.kind](proposal)}
            <span aria-hidden="true" className="text-[0.6875rem] opacity-60">
              ↵
            </span>
          </Button>
        ) : (
          <Button variant="secondary" onClick={ask.close}>
            Done
          </Button>
        )}
        <Button variant="quiet" onClick={() => ask.ask(phase.verb, phase.request)} className="px-2.5">
          <ArrowClockwise weight="bold" className="size-3.5 @[23.5rem]:hidden" aria-hidden="true" />
          <span className="@max-[23.5rem]:sr-only">Try again</span>
        </Button>
        <Button variant="quiet" onClick={ask.close} className="ml-auto gap-2 pr-1.5 pl-2.5">
          Discard
          <Kbd className="@max-[23.5rem]:hidden">Esc</Kbd>
        </Button>
      </div>
      <span role="status" className="sr-only">
        {proposal ? "Draft ready. Enter keeps it. Escape discards it." : "Answered. Escape closes."}
      </span>
      <label className="mt-1 flex h-9 items-center gap-2.5 rounded-xl bg-foreground/[0.04] px-2.5 transition-[background-color,box-shadow] duration-(--dur-fast) focus-within:bg-foreground/[0.07] focus-within:shadow-[inset_0_0_0_1.5px] focus-within:shadow-foreground/25">
        <AiOrb className="size-4 opacity-70" aria-hidden="true" />
        <input
          ref={field}
          type="text"
          name="ask-ai-change"
          aria-label="Ask for a change"
          autoComplete="off"
          placeholder="Change it: shorter, plainer…"
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            const wanted = event.currentTarget.value.trim();
            if (wanted === "" && proposal) ask.keep(proposal);
            else if (wanted !== "") ask.ask(phase.verb, `${phase.request} ${wanted}`);
          }}
          className="min-w-0 flex-1 bg-transparent text-small outline-none placeholder:text-faint-foreground"
        />
      </label>
      <div className="flex justify-end px-2 pt-1.5 pb-0.5">
        <ModelTag model={phase.answeredBy} />
      </div>
    </>
  );
};

export const AskBox = ({ ask, via }: { ask: TaskAsk; via: "keys" | "pointer" }) => {
  const field = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const { phase } = ask;
  const busy = phase.kind === "reading" || phase.kind === "writing";
  useEffect(() => {
    if (phase.kind === "reading") box.current?.focus({ preventScroll: true });
    if (phase.kind === "asking" || phase.kind === "proposed") field.current?.focus({ preventScroll: true });
  }, [phase.kind]);
  if (phase.kind === "idle") return null;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    ask.close();
  };
  return (
    <div
      ref={box}
      tabIndex={-1}
      role="dialog"
      aria-label="LifeOS AI"
      aria-busy={busy}
      data-ask-phase={phase.kind}
      onKeyDown={onKeyDown}
      className={cn(BOX, AI_RING, via === "pointer" && phase.kind === "asking" && "animate-screen-in motion-reduce:animate-none")}
    >
      {phase.kind === "asking" && <Asking ask={ask} field={field} />}
      {busy && <Working phase={phase} ask={ask} />}
      {phase.kind === "proposed" && <Proposed phase={phase} ask={ask} field={field} />}
      {phase.kind === "failed" && (
        <div className="flex flex-wrap items-center gap-2 px-2.5 py-1.5">
          <AiOrb state="offline" className="size-4" aria-hidden="true" />
          <p role="status" className="mr-auto text-small text-pretty text-muted-foreground">
            The model did not answer. Nothing changed.
          </p>
          <Button variant="quiet" onClick={() => ask.ask(null, phase.request)}>
            Try again
          </Button>
          <Button variant="quiet" onClick={ask.close}>
            Close
          </Button>
        </div>
      )}
    </div>
  );
};
