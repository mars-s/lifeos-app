"use client";

import { Check, MagnifyingGlass, Plus, Tag as TagIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Popover } from "@/components/ui/popover-panel";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { AREA_COLOURS, AreaDot, areaVar, type AreaColour } from "./area";
import { ToolButton } from "./tool-button";

export type PickerLabel = { id: string; name: string; colour: AreaColour };

const fold = (name: string) => name.trim().toLowerCase();

const leastUsedColour = (labels: PickerLabel[]) =>
  AREA_COLOURS.toSorted(
    (a, b) => labels.filter((label) => label.colour === a).length - labels.filter((label) => label.colour === b).length,
  )[0] ?? "slate";

const Swatches = ({ value, name, onPick }: { value: AreaColour; name: string; onPick: (colour: AreaColour) => void }) => (
  <div role="radiogroup" aria-label={`Colour for ${name}`} className="flex items-center justify-between px-2 pt-1 pb-2">
    {AREA_COLOURS.map((colour) => (
      <button
        key={colour}
        type="button"
        role="radio"
        aria-checked={colour === value}
        aria-label={colour}
        title={colour}
        onClick={(event) => {
          if (event.detail > 0) haptic("toggle");
          onPick(colour);
        }}
        className={cn(
          "relative grid size-6 place-items-center rounded-full transition-[scale,box-shadow] duration-(--dur-press) ease-out before:absolute before:-inset-1 active:scale-[0.88]",
          colour === value ? "shadow-[0_0_0_2px_var(--popover),0_0_0_3.5px_var(--foreground)]" : "hover:scale-110",
        )}
        style={{ backgroundColor: areaVar(colour) }}
      />
    ))}
  </div>
);

const LabelPanel = ({
  labels,
  selected,
  onToggle,
  onCreate,
  onColour,
}: {
  labels: PickerLabel[];
  selected: readonly string[];
  onToggle: (label: PickerLabel) => void;
  onCreate: (name: string, colour: AreaColour) => void;
  onColour: (label: PickerLabel, colour: AreaColour) => void;
}) => {
  const [query, setQuery] = useState("");
  const [colouring, setColouring] = useState<string | null>(null);
  const [pickedColour, setPickedColour] = useState<AreaColour | null>(null);
  const wanted = fold(query);
  const shown = labels.filter((label) => fold(label.name).includes(wanted));
  const exact = labels.find((label) => fold(label.name) === wanted);
  const creating = wanted !== "" && !exact;
  const newColour = pickedColour ?? leastUsedColour(labels);

  const create = () => {
    onCreate(query.trim(), newColour);
    setQuery("");
    setPickedColour(null);
  };

  return (
    <div data-arrow-scope>
      <label className="mb-1 flex h-8 items-center gap-2 rounded-lg bg-foreground/[0.05] px-2 text-small transition-colors duration-(--dur-fast) ease-out focus-within:bg-foreground/[0.09]">
        <MagnifyingGlass className="size-3.5 shrink-0 text-faint-foreground" aria-hidden="true" />
        <input
          aria-label="Find or create a Label"
          value={query}
          placeholder="Find or create…"
          name="label"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (exact) {
                onToggle(exact);
                setQuery("");
              } else if (creating) create();
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              event.currentTarget.closest("[data-arrow-scope]")?.querySelector<HTMLElement>("[data-arrow-item]")?.focus();
            }
            if (event.key === "Escape" && query !== "") {
              event.stopPropagation();
              setQuery("");
            }
          }}
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-faint-foreground"
        />
      </label>
      <ul aria-label="Labels" className="max-h-64 overflow-y-auto overscroll-contain">
        {shown.map((label) => {
          const ticked = selected.includes(label.id);
          return (
            <li key={label.id}>
              <div className="flex h-8 items-center rounded-lg transition-colors duration-(--dur-press) hover:bg-foreground/[0.06] has-[[data-arrow-item]:focus-visible]:bg-foreground/[0.06]">
                <button
                  type="button"
                  aria-label={`Change the colour of ${label.name}`}
                  aria-expanded={colouring === label.id}
                  onClick={() => setColouring(colouring === label.id ? null : label.id)}
                  className="grid size-8 shrink-0 place-items-center rounded-lg -outline-offset-2 transition-[scale] duration-(--dur-press) ease-out active:scale-[0.86]"
                >
                  <AreaDot colour={label.colour} className="size-2.5 transition-[background-color] duration-(--dur-fast)" />
                </button>
                <button
                  type="button"
                  data-arrow-item
                  role="checkbox"
                  aria-checked={ticked}
                  onClick={(event) => {
                    if (event.detail > 0) haptic("toggle");
                    onToggle(label);
                  }}
                  className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg pr-2 text-left text-small outline-none"
                >
                  <span className={cn("min-w-0 flex-1 truncate", ticked && "font-medium")}>{label.name}</span>
                  <Check
                    weight="bold"
                    aria-hidden="true"
                    className={cn(
                      "size-3.5 shrink-0 text-brand transition-[opacity,scale] duration-(--dur-fast) ease-out",
                      ticked ? "scale-100 opacity-100" : "scale-75 opacity-0",
                    )}
                  />
                </button>
              </div>
              {colouring === label.id && (
                <Swatches
                  value={label.colour}
                  name={label.name}
                  onPick={(colour) => {
                    if (colour !== label.colour) onColour(label, colour);
                    setColouring(null);
                  }}
                />
              )}
            </li>
          );
        })}
        {creating && (
          <li>
            <button
              type="button"
              data-arrow-item
              onClick={create}
              className="flex h-8 w-full items-center gap-2 rounded-lg pr-2 text-left text-small outline-none transition-colors duration-(--dur-press) hover:bg-foreground/[0.06] focus-visible:bg-foreground/[0.06]"
            >
              <span className="grid size-8 shrink-0 place-items-center">
                <Plus weight="bold" className="size-3" style={{ color: areaVar(newColour) }} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1 truncate">
                Create <span className="font-medium">{query.trim()}</span>
              </span>
              <span className="text-micro text-faint-foreground">Enter</span>
            </button>
            <Swatches value={newColour} name={query.trim()} onPick={setPickedColour} />
          </li>
        )}
        {shown.length === 0 && !creating && <li className="px-2 py-3 text-small text-muted-foreground">No Labels yet. Type a name to make one.</li>}
      </ul>
    </div>
  );
};

export const LabelPicker = ({
  labels,
  selected,
  ...panel
}: {
  labels: PickerLabel[];
  selected: readonly string[];
  onToggle: (label: PickerLabel) => void;
  onCreate: (name: string, colour: AreaColour) => void;
  onColour: (label: PickerLabel, colour: AreaColour) => void;
}) => (
  <Popover align="end" className="w-60 p-1.5" trigger={<ToolButton icon={TagIcon} label="Labels" />}>
    <LabelPanel labels={labels} selected={selected} {...panel} />
  </Popover>
);
