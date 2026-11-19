"use client";

import { Sparkle } from "@phosphor-icons/react";
import { useState } from "react";
import { parseEstimateText } from "@lifeos/backend/estimate";
import { Tooltip } from "@/components/ui/tooltip-hint";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { formatMinutes } from "./format";

const ESTIMATE_CHIPS = [10, 15, 30, 60, 120] as const;

const isChip = (minutes: number | undefined) => ESTIMATE_CHIPS.some((chip) => chip === minutes);

export type EstimateSuggestion = { minutes: number; reason: string };

const CHIP =
  "relative h-7 rounded-md px-2 font-mono text-small transition-[background-color,color,scale,opacity] duration-(--dur-press) ease-out before:absolute before:-inset-x-0.5 before:-inset-y-2 active:scale-[0.94]";

const SUGGESTED =
  "outline-1 outline-dashed -outline-offset-1 outline-brand/55 text-foreground starting:opacity-0 motion-safe:duration-(--dur-fast) focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring";

const Spark = () => (
  <Sparkle weight="fill" aria-hidden="true" className="pointer-events-none absolute -top-1 -right-1 size-2.5 text-brand" />
);

export const EstimateField = ({
  minutes,
  suggestion,
  onChange,
  className,
}: {
  minutes: number | undefined;
  suggestion?: EstimateSuggestion | undefined;
  onChange: (minutes: number | null) => void;
  className?: string;
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  const custom = minutes !== undefined && !isChip(minutes);
  const suggested = minutes === undefined ? suggestion : undefined;
  const extra = suggested && !isChip(suggested.minutes) ? suggested.minutes : undefined;
  const chips = extra === undefined ? ESTIMATE_CHIPS : [...ESTIMATE_CHIPS, extra].toSorted((a, b) => a - b);

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
    <div role="group" aria-label="Estimate" className={cn("flex flex-wrap items-center gap-1 @md:gap-1.5", className)}>
      <span className="hidden w-[3.75rem] text-small text-muted-foreground @md:inline">Estimate</span>
      {chips.map((chip) => {
        const selected = minutes === chip;
        const hint = suggested?.minutes === chip ? suggested : undefined;
        const button = (
          <button
            key={chip}
            type="button"
            aria-pressed={selected}
            aria-label={hint ? `${formatMinutes(chip)}, suggested` : undefined}
            onClick={(event) => {
              if (event.detail > 0) haptic("toggle");
              setDraft(null);
              setRefused(false);
              onChange(selected ? null : chip);
            }}
            className={cn(
              CHIP,
              selected ? "bg-brand text-brand-foreground" : "bg-foreground/[0.06] text-foreground/80 hover:bg-foreground/[0.1]",
              hint && SUGGESTED,
            )}
          >
            {formatMinutes(chip)}
            {hint && <Spark />}
          </button>
        );
        return hint ? (
          <Tooltip key={chip} content={hint.reason} side="top" align="start">
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
  );
};
