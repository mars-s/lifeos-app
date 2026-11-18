"use client";

import { useState } from "react";
import { parseEstimateText } from "@lifeos/backend/estimate";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { formatMinutes } from "./format";

const ESTIMATE_CHIPS = [10, 15, 30, 60, 120] as const;

const isChip = (minutes: number | undefined) => ESTIMATE_CHIPS.some((chip) => chip === minutes);

export const EstimateField = ({
  minutes,
  onChange,
  className,
}: {
  minutes: number | undefined;
  onChange: (minutes: number | null) => void;
  className?: string;
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  const custom = minutes !== undefined && !isChip(minutes);

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
      {ESTIMATE_CHIPS.map((chip) => {
        const selected = minutes === chip;
        return (
          <button
            key={chip}
            type="button"
            aria-pressed={selected}
            onClick={(event) => {
              if (event.detail > 0) haptic("toggle");
              setDraft(null);
              setRefused(false);
              onChange(selected ? null : chip);
            }}
            className={cn(
              "relative h-7 rounded-md px-2 font-mono text-small transition-[background-color,color,scale] duration-(--dur-press) ease-out before:absolute before:-inset-x-0.5 before:-inset-y-2 active:scale-[0.94]",
              selected ? "bg-brand text-brand-foreground" : "bg-foreground/[0.06] text-foreground/80 hover:bg-foreground/[0.1]",
            )}
          >
            {formatMinutes(chip)}
          </button>
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
