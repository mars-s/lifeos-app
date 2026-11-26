"use client";

import { MagnifyingGlass } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Kbd } from "@/components/ui/key-hint";
import { MorphText } from "@/components/ui/morph-text";
import { areaVar } from "@/components/lifeos/area";
import { cn } from "@/lib/utils";
import type { NoteId, SyncState } from "./model";
import { areaOf, excerptOf, NOTES, placeOf } from "./sample";

export const GLASS =
  "bg-popover/75 shadow-float backdrop-blur-xl backdrop-saturate-150 [@media(prefers-reduced-transparency:reduce)]:bg-popover [@media(prefers-reduced-transparency:reduce)]:backdrop-blur-none";

export const syncWords = (state: SyncState) => {
  if (state.kind === "synced") return state.devices > 1 ? `Synced across ${state.devices} devices` : "Synced";
  if (state.kind === "offline") return state.waiting > 0 ? `Offline. ${state.waiting} ${state.waiting === 1 ? "edit" : "edits"} kept here` : "Offline";
  return `Merging ${state.edits} ${state.edits === 1 ? "edit" : "edits"} from ${state.from}`;
};

const SyncGlyph = ({ state }: { state: SyncState }) => {
  if (state.kind === "merging")
    return (
      <span aria-hidden="true" className="flex w-3.5 items-center justify-between">
        {[0, 160, 320].map((delay) => (
          <span key={delay} className="size-[3px] animate-pending rounded-full bg-brand motion-reduce:animate-none" style={{ animationDelay: `${delay}ms` }} />
        ))}
      </span>
    );
  return (
    <span aria-hidden="true" className="grid w-3.5 place-items-center">
      <span
        className={cn(
          "size-1.5 rounded-full transition-[background-color,box-shadow] duration-(--dur-base) ease-out",
          state.kind === "synced" ? "bg-positive/80" : "shadow-[inset_0_0_0_1.5px] shadow-muted-foreground",
        )}
      />
    </span>
  );
};

export const SyncIndicator = ({ state, words = true, className }: { state: SyncState; words?: boolean; className?: string }) => (
  <span role="status" className={cn("inline-flex h-6 items-center gap-1.5 text-micro text-muted-foreground", className)}>
    <SyncGlyph state={state} />
    {words ? <MorphText>{syncWords(state)}</MorphText> : <span className="sr-only">{syncWords(state)}</span>}
  </span>
);

export const LinkDots = ({ from, className }: { from: NoteId[]; className?: string }) => (
  <span aria-hidden="true" className={cn("inline-flex items-center gap-[3px]", className)}>
    {from.slice(0, 6).map((id) => {
      const area = areaOf(id);
      return <span key={id} className="size-1.5 rounded-full" style={{ backgroundColor: area ? areaVar(area.colour) : "var(--faint-foreground)" }} />;
    })}
  </span>
);

export const SearchPill = ({
  value,
  onChange,
  placeholder,
  label,
  hint,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  hint?: string;
  className?: string;
}) => (
  <label className={cn("flex h-8 items-center gap-2 rounded-full bg-foreground/[0.05] px-3 transition-colors duration-(--dur-fast) focus-within:bg-foreground/[0.08]", className)}>
    <MagnifyingGlass weight="bold" className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
    <input
      type="search"
      name="notes-search"
      aria-label={label}
      autoComplete="off"
      spellCheck={false}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape") onChange("");
      }}
      placeholder={placeholder}
      className="min-w-0 flex-1 bg-transparent text-small outline-none placeholder:text-faint-foreground [&::-webkit-search-cancel-button]:hidden"
    />
    {hint && value === "" && <Kbd>{hint}</Kbd>}
  </label>
);

export const SectionLabel = ({ children, aside }: { children: ReactNode; aside?: ReactNode }) => (
  <div className="flex h-7 items-center justify-between px-2.5">
    <h4 className="text-micro font-medium text-faint-foreground">{children}</h4>
    {aside}
  </div>
);

const highlight = (text: string, query: string) => {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-[3px] bg-brand/15 text-foreground">{text.slice(at, at + query.length)}</mark>
      {text.slice(at + query.length)}
    </>
  );
};

export const NoteRow = ({
  id,
  active = false,
  query = "",
  place = false,
  onOpen,
}: {
  id: NoteId;
  active?: boolean;
  query?: string;
  place?: boolean;
  onOpen: (id: NoteId) => void;
}) => {
  const area = areaOf(id);
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={() => onOpen(id)}
      className={cn(
        "block w-full rounded-lg px-2.5 py-1.5 text-left transition-[background-color,scale] duration-(--dur-press) ease-out active:scale-[0.985]",
        active ? "bg-foreground/[0.08]" : "hover:bg-foreground/[0.04]",
      )}
    >
      <span className="flex items-center gap-2">
        <span className={cn("min-w-0 flex-1 truncate text-small", active ? "font-medium text-foreground" : "text-foreground/90")}>{highlight(NOTES[id].title, query)}</span>
        {area && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: areaVar(area.colour) }} />}
      </span>
      <span className="mt-px block truncate text-micro text-muted-foreground">
        <span className="text-faint-foreground">{place ? placeOf(id) : NOTES[id].edited}</span>
        <span aria-hidden="true" className="mx-1.5 text-faint-foreground">
          ·
        </span>
        {highlight(excerptOf(id), query)}
      </span>
    </button>
  );
};

export const Fold = ({ open, children }: { open: boolean; children: ReactNode }) => (
  <div className={cn("grid transition-[grid-template-rows] duration-(--dur-base) ease-out motion-reduce:transition-none", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
    <div className="overflow-hidden" inert={!open}>
      {children}
    </div>
  </div>
);
