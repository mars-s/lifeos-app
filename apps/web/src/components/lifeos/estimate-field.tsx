"use client";

import { useState } from "react";
import { parseEstimateText } from "@lifeos/backend/estimate";
import { Tooltip } from "@/components/ui/tooltip-hint";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { AiMark } from "./ai-mark";
import { formatMinutes } from "./format";

const ESTIMATE_CHIPS = [10, 15, 30, 60, 120] as const;

export type EstimateGuess = { minutes: number; probability: number };

export type SmartEstimate =
  | { kind: "thinking" }
  | { kind: "guesses"; guesses: readonly EstimateGuess[]; likely: number; reason: string; dayMinutes: number }
  | { kind: "note"; note: string };

const percent = new Intl.NumberFormat("en-AU", { style: "percent", maximumFractionDigits: 0 });

const GHOSTS = [0, 160, 320] as const;

const workingDays = (minutes: number, dayMinutes: number) =>
  minutes >= dayMinutes && minutes % dayMinutes === 0 ? minutes / dayMinutes : undefined;

const plainUnits = (days: number) => {
  if (days % 5 === 0) return days === 5 ? "1 week" : `${days / 5} weeks`;
  return days === 1 ? "1 day" : `${days} days`;
};

const CHIP =
  "relative h-7 rounded-md px-2 font-mono text-small transition-[background-color,color,scale,opacity] duration-(--dur-press) ease-out before:absolute before:-inset-x-0.5 before:-inset-y-2 active:scale-[0.94]";

const LIKELY = "bg-brand/[0.12] text-foreground hover:bg-brand/[0.18]";

const GUESS = "pb-1 starting:opacity-0 motion-safe:duration-(--dur-fast)";

const Odds = ({ probability, selected }: { probability: number; selected: boolean }) => (
  <span aria-hidden="true" className={cn("pointer-events-none absolute inset-x-2 bottom-[3px] h-0.5 overflow-hidden rounded-full", selected ? "bg-brand-foreground/25" : "bg-foreground/10")}>
    <span
      className={cn("block h-full rounded-full", selected ? "bg-brand-foreground/80" : "bg-brand/70")}
      style={{ width: `${Math.max(6, Math.round(probability * 100))}%` }}
    />
  </span>
);

const Ghosts = () => (
  <>
    {GHOSTS.map((delay) => (
      <span
        key={delay}
        aria-hidden="true"
        style={{ animationDelay: `${delay}ms` }}
        className="h-7 w-[3.25rem] rounded-md bg-foreground/[0.06] motion-safe:animate-pending"
      />
    ))}
    <span role="status" className="sr-only">
      Guessing an Estimate…
    </span>
  </>
);

const Spark = () => <AiMark weight="bold" aria-hidden="true" className="pointer-events-none absolute -top-1 -right-1 size-2.5 text-brand" />;

const chipsFor = (smart: SmartEstimate | undefined) =>
  smart?.kind === "guesses" ? smart.guesses : smart?.kind === "thinking" ? [] : ESTIMATE_CHIPS.map((minutes) => ({ minutes, probability: undefined }));

export const EstimateField = ({
  minutes,
  smart,
  onChange,
  onSteps,
  onProject,
  labelled = true,
  className,
}: {
  minutes: number | undefined;
  smart?: SmartEstimate | undefined;
  onChange: (minutes: number | null) => void;
  onSteps?: (() => void) | undefined;
  onProject?: (() => void) | undefined;
  labelled?: boolean | undefined;
  className?: string;
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  const chips: readonly { minutes: number; probability: number | undefined }[] = chipsFor(smart);
  const custom = minutes !== undefined && !chips.some((chip) => chip.minutes === minutes);
  const guessed = smart?.kind === "guesses" ? smart : undefined;
  const big = guessed !== undefined && guessed.likely >= guessed.dayMinutes;

  const commit = () => {
    if (draft === null) return;
    const text = draft.trim();
    if (text === "") {
      setDraft(null);
      if (custom) onChange(null);
      return;
    }
    const parsed = parseEstimateText(text);
    if (parsed.isErr()) {
      setRefused(true);
      haptic("error");
      return;
    }
    setDraft(null);
    if (parsed.value !== minutes) onChange(parsed.value);
  };

  return (
    <div role="group" aria-label="Estimate" className={cn("grid items-start gap-x-1.5 gap-y-1", labelled ? "grid-cols-[3.75rem_minmax(0,1fr)] @max-xs:grid-cols-1" : "grid-cols-1", className)}>
      {labelled && (
        <span aria-hidden="true" className="text-small leading-7 text-muted-foreground @max-xs:leading-5">
          Estimate
        </span>
      )}
      <div className="flex flex-wrap items-center gap-1 @md:gap-1.5">
      {smart?.kind === "thinking" && <Ghosts />}
      {chips.map(({ minutes: chip, probability }) => {
        const selected = minutes === chip;
        const likely = guessed !== undefined && guessed.likely === chip;
        const odds = probability === undefined ? undefined : percent.format(probability);
        const days = guessed ? workingDays(chip, guessed.dayMinutes) : undefined;
        const label = days === undefined ? formatMinutes(chip) : plainUnits(days);
        const dayNote = days === undefined || !guessed ? "" : ` A day here is your Working Hours, ${formatMinutes(guessed.dayMinutes)}.`;
        const button = (
          <button
            key={chip}
            type="button"
            aria-pressed={selected}
            aria-label={odds ? `${label}, ${odds} likely${likely ? ", the best guess" : ""}` : undefined}
            onClick={(event) => {
              if (event.detail > 0) haptic("toggle");
              setDraft(null);
              setRefused(false);
              onChange(selected ? null : chip);
            }}
            className={cn(
              CHIP,
              selected ? "bg-brand text-brand-foreground" : "bg-foreground/[0.06] text-foreground/80 hover:bg-foreground/[0.1]",
              probability !== undefined && GUESS,
              likely && !selected && LIKELY,
              days !== undefined && "font-sans",
            )}
          >
            {label}
            {probability !== undefined && <Odds probability={probability} selected={selected} />}
            {likely && <Spark />}
          </button>
        );
        return guessed && odds ? (
          <Tooltip key={chip} content={likely ? `${odds} likely. ${guessed.reason}${dayNote}` : `${odds} likely.${dayNote}`} side="top" align="start">
            {button}
          </Tooltip>
        ) : (
          button
        );
      })}
      <input
        aria-label="Another Estimate, such as 45 or 1h30"
        aria-invalid={refused}
        data-undo={draft === null ? "app" : undefined}
        value={draft ?? (custom ? formatMinutes(minutes) : "")}
        placeholder="Other"
        name="estimate"
        inputMode="text"
        enterKeyHint="done"
        autoComplete="off"
        spellCheck={false}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          setDraft(event.target.value);
          setRefused(false);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
            event.preventDefault();
            commit();
            const field = event.currentTarget;
            requestAnimationFrame(() => field.select());
          }
          if (event.key === "Escape" && draft !== null) {
            event.stopPropagation();
            setDraft(null);
            setRefused(false);
          }
        }}
        className={cn(
          "h-7 w-14 rounded-md px-2 text-center @md:w-[4.25rem] font-mono text-small outline-offset-2 transition-[background-color,color] duration-(--dur-press) ease-out placeholder:font-sans placeholder:text-faint-foreground",
          custom && draft === null
            ? "bg-brand text-brand-foreground focus:bg-foreground/[0.06] focus:text-foreground"
            : "bg-foreground/[0.06] text-foreground hover:bg-foreground/[0.1] focus:bg-foreground/[0.06]",
          refused && "animate-refuse text-negative",
        )}
      />
      <span role="status" className={cn("text-micro text-negative", !refused && "sr-only")}>
        {refused ? "Try 45, 1h30 or 1:30" : ""}
      </span>
      </div>
      {big && (
        <p className="col-start-[-2] flex flex-wrap items-center gap-x-2 gap-y-1 text-micro text-pretty text-muted-foreground">
          Big one. Split it into a Project?
          {onSteps && (
            <button
              type="button"
              onClick={onSteps}
              className="relative rounded-sm font-medium whitespace-nowrap text-brand transition-[opacity] duration-(--dur-press) ease-out before:absolute before:-inset-x-1 before:-inset-y-2 hover:opacity-80"
            >
              Break it into steps
            </button>
          )}
          {onProject && (
            <button
              type="button"
              onClick={onProject}
              className="relative rounded-sm font-medium whitespace-nowrap text-brand transition-[opacity] duration-(--dur-press) ease-out before:absolute before:-inset-x-1 before:-inset-y-2 hover:opacity-80"
            >
              Make it a Project
            </button>
          )}
        </p>
      )}
      {smart?.kind === "note" && (
        <p role="status" className="col-start-[-2] text-micro text-pretty text-faint-foreground">
          {smart.note}
        </p>
      )}
    </div>
  );
};
