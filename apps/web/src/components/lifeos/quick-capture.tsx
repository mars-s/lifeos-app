"use client";

import { X } from "@phosphor-icons/react";
import type { ReactNode, Ref } from "react";
import { KeyCombo } from "@/components/ui/key-hint";
import { MorphText } from "@/components/ui/morph-text";
import { cn } from "@/lib/utils";

export type CaptureChipView = { id: string; label: string; leading?: ReactNode; tone?: "deadline" | "figure"; note?: string };

const EXAMPLES = ["tomorrow", "30m", "#label", "!fri", "@project"];

const chipTone = {
  deadline: "bg-[color-mix(in_oklab,var(--deadline)_16%,transparent)] font-medium text-deadline",
  figure: "bg-foreground/[0.06] font-mono text-foreground/80 hover:bg-foreground/[0.1]",
  plain: "bg-foreground/[0.06] text-foreground/85 hover:bg-foreground/[0.1]",
} as const;

const CaptureChipButton = ({ chip, onDismiss }: { chip: CaptureChipView; onDismiss: () => void }) => (
  <button
    type="button"
    onClick={onDismiss}
    aria-label={`${chip.note ? `${chip.note} ` : ""}${chip.label}. Remove and keep the words in the title`}
    className={cn(
      "group/chip inline-flex h-7 shrink-0 animate-fade-in items-center gap-1.5 rounded-full pr-2 pl-2.5 text-small outline-none transition-[background-color,scale] duration-(--dur-press) ease-out focus-visible:ring-2 focus-visible:ring-brand/50 active:scale-[0.97] motion-reduce:animate-none",
      chipTone[chip.tone ?? "plain"],
    )}
  >
    {chip.leading}
    {chip.note && <span className="text-faint-foreground">{chip.note}</span>}
    <span className="max-w-40 truncate">{chip.label}</span>
    <X weight="bold" aria-hidden="true" className="size-3 text-faint-foreground transition-colors duration-(--dur-fast) group-hover/chip:text-foreground" />
  </button>
);

export const QuickCapturePanel = ({
  value,
  onValueChange,
  onSave,
  chips,
  onDismissChip,
  destination,
  failed,
  refused,
  inputRef,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  onSave: (another: boolean) => void;
  chips: readonly CaptureChipView[];
  onDismissChip: (id: string) => void;
  destination: string;
  failed: boolean;
  refused: boolean;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
}) => (
  <div className={cn("w-full overflow-hidden rounded-2xl bg-popover text-foreground shadow-float", refused && "animate-refuse motion-reduce:animate-none", className)}>
    <label className="flex h-14 items-center gap-3 px-4">
      <span aria-hidden="true" className="size-[1.125rem] shrink-0 rounded-[0.375rem] border-[1.5px] border-foreground/25" />
      <input
        ref={inputRef}
        name="capture"
        aria-label="New Task"
        aria-describedby="capture-status"
        autoComplete="off"
        autoCapitalize="sentences"
        spellCheck={false}
        enterKeyHint="done"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
          event.preventDefault();
          onSave(event.shiftKey);
        }}
        placeholder="New Task…"
        className="min-w-0 flex-1 bg-transparent text-heading outline-none placeholder:text-faint-foreground"
      />
    </label>
    <div className="flex min-h-11 flex-wrap items-center gap-1.5 px-4 pb-3">
      {chips.length === 0 ? (
        <p className="flex flex-wrap items-center gap-1.5 text-small text-faint-foreground">
          <span>Try</span>
          {EXAMPLES.map((example) => (
            <span key={example} translate="no" className="rounded-md bg-foreground/[0.05] px-1.5 py-0.5 font-mono text-micro text-muted-foreground">
              {example}
            </span>
          ))}
        </p>
      ) : (
        chips.map((chip) => <CaptureChipButton key={chip.id} chip={chip} onDismiss={() => onDismissChip(chip.id)} />)
      )}
    </div>
    <div className="flex h-10 items-center gap-3 bg-foreground/[0.03] px-4 text-small text-muted-foreground">
      <p id="capture-status" aria-live="polite" className={cn("min-w-0 flex-1 truncate", failed && "text-negative")}>
        {failed ? (
          "That did not save. Press Enter to try again."
        ) : (
          <>
            Lands in <MorphText className="font-medium text-foreground">{destination}</MorphText>
          </>
        )}
      </p>
      <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
        Save <KeyCombo keys="enter" />
      </span>
      <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
        Save and add another <KeyCombo keys="shift+enter" />
      </span>
    </div>
  </div>
);
