"use client";

import { ArrowRight, BookmarkSimple, Check } from "@phosphor-icons/react";
import { useRef } from "react";
import { Button } from "@/components/ui/action-button";
import { Kbd } from "@/components/ui/key-hint";
import { MorphText } from "@/components/ui/morph-text";
import { AiMarkWorking } from "@/components/lifeos/ai-orb";
import { AreaDot } from "@/components/lifeos/area";
import { cn } from "@/lib/utils";
import { DayTrack, LoadRows, ProgressDots } from "./graphs";
import type { Change, ChangeVerb, Graph, Option, Part, PlanStep, StepState } from "./model";
import { AI_RING, Ink, ModelTag, SourceChip, SourceDots, Sources } from "./parts";

export type PartActions = {
  choose?: (option: string) => void;
  skip?: (change: string) => void;
  make?: () => void;
  decline?: () => void;
  undo?: (change: string) => void;
  undoAll?: (changes: string[]) => void;
  redoAll?: () => void;
  unlearn?: () => void;
};

type Of<Kind extends Part["kind"]> = Extract<Part, { kind: Kind }>;

export const Thinking = ({ part }: { part: Of<"thinking"> }) => (
  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
    <span role="status" className="flex min-w-0 items-center gap-2.5">
      <AiMarkWorking weight="bold" className="size-4 text-foreground/70" aria-hidden="true" />
      <MorphText className="text-muted-foreground">{part.words}</MorphText>
    </span>
    <span className="flex items-center gap-2">
      <SourceDots sources={part.read} of={part.of} />
      <span className="font-mono text-micro text-muted-foreground">
        {part.read.length} of {part.of}
      </span>
    </span>
  </div>
);

const MARK: Record<StepState, string> = {
  done: "bg-foreground/80 text-background",
  doing: "shadow-[inset_0_0_0_1.5px] shadow-foreground/55",
  waiting: "bg-brand text-brand-foreground",
  todo: "shadow-[inset_0_0_0_1.5px] shadow-foreground/20",
};

const StepMark = ({ state }: { state: StepState }) => (
  <span data-step={state} className={cn("relative z-10 grid size-4 shrink-0 place-items-center rounded-full bg-clip-padding transition-[background-color,box-shadow] duration-(--dur-base) ease-out", MARK[state])}>
    {state === "done" && <Check weight="bold" className="size-2.5" aria-hidden="true" />}
    {state === "doing" && <span className="size-1.5 animate-pending rounded-full bg-foreground/70 motion-reduce:animate-none" />}
    {state === "waiting" && <span className="size-1.5 rounded-full bg-current" />}
  </span>
);

const STEP_WORD: Record<StepState, string> = { done: "Done", doing: "Doing now", waiting: "Needs you", todo: "Not started" };

const Loop = ({ loop }: { loop: NonNullable<PlanStep["loop"]> }) => (
  <span className="flex items-center gap-2">
    <span aria-hidden="true" className="flex items-center gap-[3px]">
      {Array.from({ length: loop.of }, (_, index) => (
        <span key={index} className={cn("size-1.5 rounded-full transition-colors duration-(--dur-base)", index < loop.done ? "bg-foreground/70" : "bg-foreground/[0.12]")} />
      ))}
    </span>
    <span className="font-mono text-micro text-muted-foreground">
      {loop.done} of {loop.of} <span className="sr-only">{loop.unit}</span>
    </span>
  </span>
);

export const Plan = ({ part }: { part: Of<"plan"> }) => (
  <ol aria-label="Plan" className="relative">
    {part.steps.map((step, index) => (
      <li key={step.id} className="relative flex items-start gap-3 pb-2.5 last:pb-0">
        {index < part.steps.length - 1 && (
          <span aria-hidden="true" className={cn("absolute top-4 bottom-0 left-[7px] w-[1.5px] rounded-full transition-colors duration-(--dur-base)", step.state === "done" ? "bg-foreground/30" : "bg-foreground/[0.09]")} />
        )}
        <span className="grid h-5 place-items-center">
          <StepMark state={step.state} />
        </span>
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5 text-small">
          <span className={cn("transition-colors duration-(--dur-base)", step.state === "todo" && "text-muted-foreground", step.state === "done" && "text-foreground/70", (step.state === "doing" || step.state === "waiting") && "font-medium")}>
            {step.title}
          </span>
          {step.state !== "waiting" && <span className="sr-only">{STEP_WORD[step.state]}</span>}
          {step.loop && step.state !== "todo" && <Loop loop={step.loop} />}
          {step.state === "waiting" && <span className="text-micro font-medium text-brand">Needs you</span>}
        </span>
      </li>
    ))}
  </ol>
);

const OptionCard = ({ option, index, chosen, onChoose }: { option: Option; index: number; chosen: string | undefined; onChoose?: ((option: string) => void) | undefined }) => {
  const picked = chosen === option.id;
  return (
    <div className={cn("@container relative flex min-w-0 flex-col rounded-xl transition-colors duration-(--dur-base) ease-out", picked ? "bg-foreground/[0.08]" : "bg-foreground/[0.04]")}>
      <button
        type="button"
        aria-pressed={picked}
        disabled={chosen !== undefined || !onChoose}
        onClick={() => onChoose?.(option.id)}
        className="flex flex-1 flex-col gap-2.5 rounded-xl p-3 text-left transition-[background-color,scale] duration-(--dur-press) ease-out enabled:hover:bg-foreground/[0.03] enabled:active:scale-[0.985]"
      >
        <span className="flex items-start gap-2">
          <span className="min-w-0 flex-1 font-medium text-pretty">{option.title}</span>
          {picked ? (
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-foreground/80 text-background">
              <Check weight="bold" className="size-3" aria-hidden="true" />
            </span>
          ) : (
            <Kbd>{index + 1}</Kbd>
          )}
        </span>
        <span className="text-small text-pretty text-muted-foreground">{option.detail}</span>
        <LoadRows days={option.days} className="mt-auto pt-1" />
      </button>
    </div>
  );
};

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

export const Decision = ({ part, onChoose }: { part: Of<"decision">; onChoose?: ((option: string) => void) | undefined }) => {
  const holder = useRef<HTMLElement>(null);
  const advised = part.options.find((option) => option.id === part.advised);
  const open = part.chosen === undefined && onChoose !== undefined;
  const choose = onChoose
    ? (option: string) => {
        holder.current?.focus({ preventScroll: true });
        onChoose(option);
      }
    : undefined;
  return (
    <section
      ref={holder}
      tabIndex={-1}
      aria-label={part.ask}
      className={cn("@container outline-none", AI_RING)}
      onKeyDown={(event) => {
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        const picked = part.options[Number(event.key) - 1];
        if (open && picked) choose?.(picked.id);
      }}
    >
      <p role="status" className="text-small font-medium">
        <MorphText>{part.chosen === undefined ? part.ask : "You picked"}</MorphText>
      </p>
      <div className={cn("mt-2 grid gap-2", part.chosen === undefined && "@xl:grid-cols-2")}>
        {part.options.map((option, index) => (part.chosen === undefined || part.chosen === option.id) && <OptionCard key={option.id} option={option} index={index} chosen={part.chosen} onChoose={choose} />)}
      </div>
      {part.chosen === undefined && advised?.because && (
        <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-muted-foreground">
          I would {lowerFirst(advised.title)}, because
          <SourceChip source={advised.because} />
        </p>
      )}
    </section>
  );
};

const VERB_WORD: Record<ChangeVerb, string> = { plan: "Plan", move: "Move", link: "Link", trash: "Trash" };

const ChangeRow = ({ change, pencil, off, offWord, control }: { change: Change; pencil: boolean; off: boolean; offWord: string; control: React.ReactNode }) => (
  <li className={cn("@container flex items-start gap-2.5 py-1.5 transition-opacity duration-(--dur-base)", off && "opacity-45")}>
    <span className="grid h-5 shrink-0 place-items-center">{control}</span>
    <span className="grid min-w-0 flex-1 gap-x-3 @md:grid-cols-[minmax(0,1fr)_auto] @md:items-baseline">
      <span className="flex min-w-0 items-baseline gap-2 text-small">
        <span className="w-10 shrink-0 text-muted-foreground">
          {off && <span className="sr-only">{offWord}: </span>}
          {VERB_WORD[change.verb]}
        </span>
        <span className={cn("min-w-0 truncate transition-colors duration-(--dur-base)", off && "line-through decoration-foreground/30")}>
          <AreaDot colour={change.colour} className="mr-1.5 inline-block -translate-y-px align-middle" />
          {change.subject}
        </span>
      </span>
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 pl-11 font-mono text-small @md:pl-0">
        {change.from && (
          <>
            <span className="text-faint-foreground line-through decoration-faint-foreground/60">{change.from}</span>
            <ArrowRight weight="bold" className="size-3 shrink-0 translate-y-px self-center text-faint-foreground" aria-hidden="true" />
            <span className="sr-only">becomes</span>
          </>
        )}
        <Ink pencil={pencil} className={cn((change.verb === "link" || change.verb === "trash") && "font-sans")}>
          {change.to}
        </Ink>
      </span>
    </span>
  </li>
);

const Tick = ({ on, label, onToggle }: { on: boolean; label: string; onToggle?: (() => void) | undefined }) => (
  <button
    type="button"
    role="checkbox"
    aria-checked={on}
    aria-label={label}
    disabled={!onToggle}
    onClick={onToggle}
    className={cn(
      "relative grid size-4 place-items-center rounded-[5px] transition-[background-color,box-shadow,scale] duration-(--dur-fast) ease-out before:absolute before:-inset-2 active:scale-[0.88]",
      on ? "bg-foreground/80 text-background" : "shadow-[inset_0_0_0_1.5px] shadow-foreground/30",
    )}
  >
    {on && <Check weight="bold" className="size-2.5" aria-hidden="true" />}
  </button>
);

export const Gate = ({ part, onSkip, onMake, onDecline }: { part: Of<"gate">; onSkip?: ((change: string) => void) | undefined; onMake?: (() => void) | undefined; onDecline?: (() => void) | undefined }) => {
  const count = part.changes.length - part.skipped.length;
  return (
    <section aria-label="Asks first" className={cn("relative rounded-xl border border-dashed border-foreground/25 p-3", AI_RING)}>
      <p className="text-small font-medium">Nothing has changed yet</p>
      <p className="text-small text-pretty text-muted-foreground">{part.why}</p>
      <ul className="mt-1.5">
        {part.changes.map((change) => {
          const skipped = part.skipped.includes(change.id);
          return (
            <ChangeRow
              key={change.id}
              change={change}
              pencil
              off={skipped}
              offWord="Left out"
              control={<Tick on={!skipped} label={`${VERB_WORD[change.verb]} ${change.subject}`} onToggle={onSkip ? () => onSkip(change.id) : undefined} />}
            />
          );
        })}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Button variant="primary" disabled={count === 0 || !onMake} onClick={onMake}>
          {part.go} {count}
        </Button>
        <Button variant="quiet" disabled={!onDecline} onClick={onDecline}>
          Not now
        </Button>
        <span className="ml-1 text-small text-muted-foreground">Untick a row to leave it out</span>
      </div>
    </section>
  );
};

export const Remembered = ({ part, onUndo }: { part: Of<"remembered">; onUndo?: (() => void) | undefined }) => (
  <div data-memory={part.undone ? "undone" : "kept"} className={cn("flex items-start gap-2 rounded-xl bg-foreground/[0.04] py-1.5 pr-1.5 pl-2.5 text-small", AI_RING)}>
    <span className="grid h-5 shrink-0 place-items-center">
      <BookmarkSimple weight="fill" className={cn("size-3.5 transition-colors duration-(--dur-base)", part.undone ? "text-faint-foreground" : "text-muted-foreground")} aria-hidden="true" />
    </span>
    <p className="min-w-0 flex-1 text-pretty">
      <span className="text-muted-foreground">
        <MorphText>{part.undone ? "Not remembered" : "Remembered"}</MorphText>
      </span>{" "}
      <span className={cn("transition-colors duration-(--dur-base)", part.undone && "text-faint-foreground line-through decoration-faint-foreground/60")}>{part.text}</span>
    </p>
    <button
      type="button"
      disabled={!onUndo}
      aria-label={part.undone ? "Remember it after all" : "Undo remembering this"}
      onClick={onUndo}
      className="relative -my-0.5 h-6 shrink-0 rounded-full px-2 font-medium before:absolute before:-inset-2 text-muted-foreground transition-[background-color,color,scale] duration-(--dur-press) ease-out hover:bg-foreground/[0.07] hover:text-foreground active:scale-[0.96]"
    >
      <MorphText>{part.undone ? "Redo" : "Undo"}</MorphText>
    </button>
  </div>
);

export const Receipt = ({
  part,
  onUndo,
  onUndoAll,
  onRedoAll,
}: {
  part: Of<"receipt">;
  onUndo?: ((change: string) => void) | undefined;
  onUndoAll?: ((changes: string[]) => void) | undefined;
  onRedoAll?: (() => void) | undefined;
}) => {
  const live = part.changes.filter((change) => !part.undone.includes(change.id));
  const allUndone = live.length === 0;
  return (
    <section aria-label="What changed" className={cn("rounded-xl bg-foreground/[0.04] p-3", AI_RING)}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <p role="status" className="text-small font-medium">
          <MorphText>{allUndone ? "All undone" : live.length === 1 ? "1 change made" : `${live.length} changes made`}</MorphText>
        </p>
        <span className="text-micro text-muted-foreground">{part.at}</span>
        <ModelTag className="ml-auto" />
      </div>
      <ul className="mt-1">
        {part.changes.map((change) => {
          const undone = part.undone.includes(change.id);
          return (
            <ChangeRow
              key={change.id}
              change={change}
              pencil={false}
              off={undone}
              offWord="Undone"
              control={
                <span className={cn("grid size-4 place-items-center rounded-full transition-colors duration-(--dur-base)", undone ? "shadow-[inset_0_0_0_1.5px] shadow-foreground/25" : "bg-positive/85 text-background")}>
                  {!undone && <Check weight="bold" className="size-2.5" aria-hidden="true" />}
                </span>
              }
            />
          );
        })}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Button variant="secondary" disabled={!onUndoAll} onClick={() => (allUndone ? onRedoAll?.() : onUndoAll?.(part.changes.map((change) => change.id)))}>
          <MorphText>{allUndone ? "Redo all" : "Undo all"}</MorphText>
        </Button>
        {part.changes.map(
          (change) =>
            onUndo && (
              <Button key={change.id} variant="quiet" aria-label={`${part.undone.includes(change.id) ? "Redo" : "Undo"}: ${VERB_WORD[change.verb]} ${change.subject}, ${change.to}`} onClick={() => onUndo(change.id)} className="px-2.5">
                <MorphText>{`${part.undone.includes(change.id) ? "Redo" : "Undo"} ${VERB_WORD[change.verb].toLowerCase()}`}</MorphText>
              </Button>
            ),
        )}
      </div>
    </section>
  );
};

export const GraphView = ({ graph }: { graph: Graph }) => {
  if (graph.kind === "time") return <DayTrack day={graph.day} from={graph.from} to={graph.to} spans={graph.spans} />;
  if (graph.kind === "capacity") return <LoadRows days={graph.days} />;
  return <ProgressDots title={graph.title} colour={graph.colour} done={graph.done} pencil={graph.pencil} total={graph.total} />;
};

export const PartView = ({ part, act = {} }: { part: Part; act?: PartActions }) => {
  switch (part.kind) {
    case "thinking":
      return <Thinking part={part} />;
    case "plan":
      return <Plan part={part} />;
    case "words":
      return <p className="text-small text-pretty">{part.text}</p>;
    case "graph":
      return <GraphView graph={part.graph} />;
    case "decision":
      return <Decision part={part} onChoose={act.choose} />;
    case "gate":
      return <Gate part={part} onSkip={act.skip} onMake={act.make} onDecline={act.decline} />;
    case "receipt":
      return <Receipt part={part} onUndo={act.undo} onUndoAll={act.undoAll} onRedoAll={act.redoAll} />;
    case "remembered":
      return <Remembered part={part} onUndo={act.unlearn} />;
    case "sources":
      return <Sources sources={part.refs} />;
    default:
      return part satisfies never;
  }
};
