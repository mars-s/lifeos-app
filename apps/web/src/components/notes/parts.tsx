"use client";

import { MagnifyingGlass } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Kbd } from "@/components/ui/key-hint";
import { areaVar, type AreaColour } from "@/components/lifeos/area";
import { cn } from "@/lib/utils";
import type { NoteItem } from "./data";

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
        if (event.key !== "Escape" || value === "") return;
        event.stopPropagation();
        onChange("");
      }}
      placeholder={placeholder}
      className="min-w-0 flex-1 bg-transparent text-small outline-none placeholder:text-faint-foreground [&::-webkit-search-cancel-button]:hidden"
    />
    {hint && value === "" && <Kbd>{hint}</Kbd>}
  </label>
);

export const SectionLabel = ({ children, aside }: { children: ReactNode; aside?: ReactNode }) => (
  <div className="flex h-7 items-center justify-between px-2.5">
    <h3 className="text-micro font-medium text-faint-foreground">{children}</h3>
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
  item,
  meta,
  active = false,
  query = "",
  colour,
  onOpen,
}: {
  item: NoteItem;
  meta: string;
  active?: boolean;
  query?: string;
  colour?: AreaColour | undefined;
  onOpen: (docId: string) => void;
}) => (
  <button
    type="button"
    aria-current={active ? "page" : undefined}
    onClick={() => onOpen(item.docId)}
    className={cn(
      "block w-full rounded-lg px-2.5 py-1.5 text-left transition-[background-color,scale] duration-(--dur-press) ease-out active:scale-[0.985]",
      active ? "bg-foreground/[0.08]" : "hover:bg-foreground/[0.04]",
    )}
  >
    <span className="flex items-center gap-2">
      <span className={cn("min-w-0 flex-1 truncate text-small", active ? "font-medium text-foreground" : "text-foreground/90")}>{highlight(item.title, query)}</span>
      {colour && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: areaVar(colour) }} />}
    </span>
    <span className="mt-px block truncate text-micro text-muted-foreground">
      <span className="text-faint-foreground">{meta}</span>
      {item.excerpt && (
        <>
          <span aria-hidden="true" className="mx-1.5 text-faint-foreground">
            ·
          </span>
          {highlight(item.excerpt, query)}
        </>
      )}
    </span>
  </button>
);

export const Fold = ({ open, children }: { open: boolean; children: ReactNode }) => (
  <div className={cn("grid transition-[grid-template-rows] duration-(--dur-base) ease-out motion-reduce:transition-none", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
    <div className="overflow-hidden" inert={!open}>
      {children}
    </div>
  </div>
);
