"use client";

import { ArrowClockwise } from "@phosphor-icons/react";
import { useEffect, useId, useReducer, useRef, type KeyboardEvent, type RefObject } from "react";
import { Button } from "@/components/ui/action-button";
import { Kbd } from "@/components/ui/key-hint";
import { MorphText } from "@/components/ui/morph-text";
import { AiMark, AiMarkWorking } from "@/components/lifeos/ai-mark";
import { cn } from "@/lib/utils";
import { GLASS } from "../notes/parts";
import { askReducer, matchVerbs, type Ask, type AskEvent, type SourceRef, type Verb } from "./model";
import { AI_RING, ModelTag, Sources } from "./parts";

type Target = { element: HTMLElement; open: () => void };

const targets = new Set<Target>();

const distanceFromCentre = (element: HTMLElement) => {
  const box = element.getBoundingClientRect();
  if (box.bottom < 0 || box.top > window.innerHeight) return Number.POSITIVE_INFINITY;
  return Math.abs(box.top + box.height / 2 - window.innerHeight / 2);
};

const nearestTarget = () => {
  const focused = [...targets].find((target) => target.element.contains(document.activeElement));
  if (focused) return focused;
  const ranked = [...targets].map((target) => ({ target, distance: distanceFromCentre(target.element) })).toSorted((first, second) => first.distance - second.distance);
  return ranked[0] && Number.isFinite(ranked[0].distance) ? ranked[0].target : undefined;
};

export const useCmdJ = () => {
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key.toLowerCase() !== "j" || !(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
      const target = nearestTarget();
      if (!target) return;
      event.preventDefault();
      target.open();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
};

export const useCmdJTarget = (element: RefObject<HTMLElement | null>, open: () => void) => {
  const latest = useRef(open);
  useEffect(() => {
    latest.current = open;
  });
  useEffect(() => {
    if (!element.current) return;
    const target: Target = { element: element.current, open: () => latest.current() };
    targets.add(target);
    return () => {
      targets.delete(target);
    };
  }, [element]);
};

const READ_MS = 620;
const IDLE = { phase: "idle" } as const;

export type AskPlan = { total: number; pace: number };

export const useAsk = <Id extends string>(planOf: (verb: Id) => AskPlan) => {
  const [ask, send] = useReducer(askReducer<Id>, IDLE);
  const reading = ask.phase === "reading" ? ask.verb : undefined;
  const writing = ask.phase === "writing" ? ask.verb : undefined;
  const plan = useRef(planOf);
  useEffect(() => {
    plan.current = planOf;
  });
  useEffect(() => {
    if (reading === undefined) return;
    const timer = setTimeout(() => send({ type: "start", total: plan.current(reading).total }), READ_MS);
    return () => clearTimeout(timer);
  }, [reading]);
  useEffect(() => {
    if (writing === undefined) return;
    const timer = setInterval(() => send({ type: "tick" }), plan.current(writing).pace);
    return () => clearInterval(timer);
  }, [writing]);
  return [ask, send] as const;
};

type BoxProps<Id extends string> = {
  ask: Ask<Id>;
  verbs: readonly Verb<Id>[];
  free: Id;
  reads: Record<Id, SourceRef[]>;
  scope: string;
  send: (event: AskEvent<Id>) => void;
  onKeep: (verb: Id) => void;
  onDiscard: () => void;
  also?: { verb: Id; label: string; run: () => void } | undefined;
  refine?: string;
  offline?: boolean;
  still?: boolean;
  className?: string;
};

const ROW = "flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-left text-small transition-colors duration-(--dur-press) pointer-coarse:h-11";

const FIELD = "transition-[background-color,box-shadow] duration-(--dur-fast) focus-within:bg-foreground/[0.07] focus-within:shadow-[inset_0_0_0_1.5px] focus-within:shadow-foreground/25";

const Asking = <Id extends string>({ ask, verbs, free, scope, send, offline, still, field }: BoxProps<Id> & { ask: Extract<Ask<Id>, { phase: "asking" }>; field: RefObject<HTMLInputElement | null> }) => {
  const listId = useId();
  const matches = matchVerbs(verbs, ask.query);
  const custom = ask.query.trim() !== "" && matches.length === 0;
  const count = custom ? 1 : matches.length;
  const at = Math.min(ask.at, Math.max(0, count - 1));
  const activeVerb = custom ? free : matches[at]?.id;
  const off = offline === true;
  const pick = () => {
    if (activeVerb === undefined || off) return;
    send({ type: "pick", verb: activeVerb });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      send({ type: "move", to: (at + (event.key === "ArrowDown" ? 1 : count - 1)) % Math.max(1, count) });
    }
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      pick();
    }
  };
  return (
    <>
      <label className="flex h-10 items-center gap-2.5 px-2.5">
        <AiMark weight="bold" className="size-4 text-foreground/70" aria-hidden="true" />
        <input
          ref={field}
          type="text"
          name="ask-ai"
          role="combobox"
          aria-label="Ask LifeOS AI"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={count > 0 ? `${listId}-${at}` : undefined}
          autoComplete="off"
          spellCheck={false}
          readOnly={still || off}
          tabIndex={still ? -1 : 0}
          value={ask.query}
          onChange={(event) => send({ type: "type", query: event.target.value })}
          onKeyDown={onKeyDown}
          placeholder={off ? "Offline" : "Ask, or pick below…"}
          className="min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-faint-foreground"
        />
        <Kbd>Esc</Kbd>
      </label>
      <ul id={listId} role="listbox" aria-label="What to do" className="px-0.5 pb-0.5">
        {custom && (
          <li id={`${listId}-0`} role="option" aria-selected="true" aria-disabled={off} className={cn(ROW, "bg-foreground/[0.06]", off && "opacity-45")} onClick={pick}>
            <AiMark weight="bold" className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">Ask “{ask.query.trim()}”</span>
            <Kbd>↵</Kbd>
          </li>
        )}
        {!custom &&
          matches.map((verb, index) => (
            <li
              key={verb.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={!off && index === at}
              aria-disabled={off}
              onPointerMove={() => !off && index !== at && send({ type: "move", to: index })}
              onClick={() => !off && send({ type: "pick", verb: verb.id })}
              className={cn(ROW, !off && index === at && "bg-foreground/[0.06]", off ? "text-faint-foreground" : "cursor-default active:bg-foreground/[0.09]")}
            >
              <verb.icon weight="bold" className={cn("size-4 shrink-0", off ? "text-faint-foreground" : "text-muted-foreground")} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{verb.label}</span>
              {!off && <span className="shrink-0 text-micro text-muted-foreground">{verb.found}</span>}
            </li>
          ))}
      </ul>
      {off ? (
        <p role="status" className="mx-0.5 mt-1 rounded-xl bg-foreground/[0.04] px-2.5 py-2 text-small text-pretty text-muted-foreground">
          LifeOS AI needs a connection. Writing, Tasks and undo all still work, and this will be here when you are back.
        </p>
      ) : (
        <p className="flex items-center gap-2 px-2.5 pt-1.5 pb-1 text-micro text-faint-foreground">
          <span className="min-w-0 flex-1 truncate">{scope}</span>
          <ModelTag />
        </p>
      )}
    </>
  );
};

const Working = <Id extends string>({ ask, verbs, send, still }: BoxProps<Id>) => {
  const verb = verbs.find((candidate) => ask.phase !== "idle" && ask.phase !== "asking" && candidate.id === ask.verb);
  return (
    <div className="flex h-10 items-center gap-2.5 pr-1 pl-2.5">
      <AiMarkWorking weight="bold" className="size-4 text-foreground/70" aria-hidden="true" />
      <span role="status" className="min-w-0 flex-1 truncate text-body text-muted-foreground">
        <MorphText>{ask.phase === "reading" ? (verb?.reading ?? "Reading") : "Writing"}</MorphText>
      </span>
      <Button variant="quiet" tabIndex={still ? -1 : 0} onClick={() => send({ type: "stop" })} className="h-8 gap-2 px-2.5">
        Stop
        <Kbd>Esc</Kbd>
      </Button>
    </div>
  );
};

const Proposed = <Id extends string>({
  ask,
  verbs,
  reads,
  send,
  onKeep,
  onDiscard,
  also,
  refine = "Change it: shorter, plainer…",
  still,
  field,
}: BoxProps<Id> & { ask: Extract<Ask<Id>, { phase: "proposed" }>; field: RefObject<HTMLInputElement | null> }) => {
  const verb = verbs.find((candidate) => candidate.id === ask.verb);
  const tab = still ? -1 : 0;
  return (
    <>
      <div className="flex flex-wrap items-center gap-1 p-0.5">
        <Button variant="primary" tabIndex={tab} onClick={() => onKeep(ask.verb)} className="gap-2">
          {verb?.keep ?? "Keep"}
          <span aria-hidden="true" className="text-[0.6875rem] opacity-60">
            ↵
          </span>
        </Button>
        {also?.verb === ask.verb && (
          <Button variant="secondary" tabIndex={tab} onClick={also.run}>
            {also.label}
          </Button>
        )}
        <Button variant="quiet" tabIndex={tab} onClick={() => send({ type: "pick", verb: ask.verb })} className="px-2.5">
          <ArrowClockwise weight="bold" className="size-3.5 @[23.5rem]:hidden" aria-hidden="true" />
          <span className="@max-[23.5rem]:sr-only">Try again</span>
        </Button>
        <Button variant="quiet" tabIndex={tab} onClick={onDiscard} className="ml-auto gap-2 pr-1.5 pl-2.5">
          Discard
          <Kbd className="@max-[23.5rem]:hidden">Esc</Kbd>
        </Button>
      </div>
      <span role="status" className="sr-only">
        Draft ready. Enter keeps it. Escape discards it.
      </span>
      <label className={cn("mt-1 flex h-9 items-center gap-2.5 rounded-xl bg-foreground/[0.04] px-2.5", FIELD)}>
        <AiMark weight="bold" className="size-4 text-foreground/55" aria-hidden="true" />
        <input
          ref={field}
          type="text"
          name="ask-ai-change"
          aria-label="Ask for a change"
          autoComplete="off"
          readOnly={still}
          tabIndex={tab}
          placeholder={refine}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            if (event.currentTarget.value.trim() === "") onKeep(ask.verb);
            else send({ type: "pick", verb: ask.verb });
          }}
          className="min-w-0 flex-1 bg-transparent text-small outline-none placeholder:text-faint-foreground"
        />
      </label>
      <div className="flex min-h-8 items-center gap-2 px-1 pt-1">
        <Sources sources={reads[ask.verb]} label="Read" className="flex-1" />
        <ModelTag className="self-start pt-1 pr-1.5" />
      </div>
    </>
  );
};

export const AskBox = <Id extends string>(props: BoxProps<Id>) => {
  const { ask, send, onDiscard, still = false, className } = props;
  const field = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const phase = ask.phase;
  const busy = phase === "reading" || phase === "writing";
  useEffect(() => {
    if (still || phase === "idle") return;
    if (phase === "reading" || phase === "writing") box.current?.focus({ preventScroll: true });
    else field.current?.focus({ preventScroll: true });
  }, [phase, still]);
  if (ask.phase === "idle") return null;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (busy) send({ type: "stop" });
    else onDiscard();
  };
  return (
    <div
      ref={box}
      tabIndex={-1}
      role="dialog"
      aria-label="LifeOS AI"
      data-ask-phase={phase}
      inert={still}
      onKeyDown={still ? undefined : onKeyDown}
      className={cn("@container w-full max-w-[26rem] rounded-2xl p-1.5 text-small outline-none", GLASS, AI_RING, !still && ask.phase === "asking" && ask.via === "pointer" && "animate-screen-in", className)}
    >
      {ask.phase === "asking" && <Asking {...props} ask={ask} field={field} />}
      {busy && <Working {...props} />}
      {ask.phase === "proposed" && <Proposed {...props} ask={ask} field={field} />}
    </div>
  );
};
