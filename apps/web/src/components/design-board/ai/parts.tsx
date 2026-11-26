"use client";

import { BookmarkSimple, CalendarBlank, Note as NoteIcon } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";
import { toast } from "@/components/ui/toast-stack";
import { areaVar } from "@/components/lifeos/area";
import { cn } from "@/lib/utils";
import { AREAS, areaOf, TASKS, titleOf } from "../notes/sample";
import { sourceKey, type SourceRef } from "./model";
import { memoryText, MODEL } from "./sample";

export const INK_SHIFT = "transition-colors duration-(--dur-slow) ease-out";

export const AI_RING = "[--ring:color-mix(in_oklab,var(--foreground)_50%,transparent)]";

export const Ink = ({ pencil, say = false, className, children }: { pencil: boolean; say?: boolean; className?: string; children: ReactNode }) => (
  <span data-ink={pencil ? "pencil" : "ink"} className={cn(INK_SHIFT, pencil ? "text-muted-foreground" : "text-foreground", className)}>
    {pencil && say && <span className="sr-only">Suggested: </span>}
    {children}
  </span>
);

export type BarTone = "lit" | "here" | "pencil" | "off";

const BAR_TONE: Record<BarTone, string> = {
  lit: "border-foreground/70",
  here: "border-foreground/15",
  pencil: "border-dashed border-foreground/30",
  off: "border-transparent opacity-0",
};

export const MarginBar = ({ tone, className }: { tone: BarTone; className?: string }) => (
  <span
    aria-hidden="true"
    data-bar={tone}
    className={cn("pointer-events-none absolute inset-y-1 -left-4 w-0 border-l-[3px] transition-[opacity,border-color] duration-(--dur-fast) ease-out", BAR_TONE[tone], className)}
  />
);

export const wordCount = (text: string) => text.split(" ").length;

export const StreamWords = ({ text, shown }: { text: string; shown: number }) => (
  <>
    {text
      .split(" ")
      .slice(0, shown)
      .map((word, index) => (
        <span key={index} className="animate-fade-in">
          {index > 0 && " "}
          {word}
        </span>
      ))}
  </>
);

export const PencilBox = ({ round = false, className }: { round?: boolean; className?: string }) => (
  <span aria-hidden="true" className={cn("block size-[18px] shrink-0 border-[1.5px] border-dashed border-foreground/35", round ? "size-4 rounded-full" : "rounded-[6px]", className)} />
);

export const PencilChip = ({ pencil, className, children }: { pencil: boolean; className?: string; children: ReactNode }) => (
  <span
    data-ink={pencil ? "pencil" : "ink"}
    className={cn(
      "inline-flex h-6 shrink-0 items-center rounded-md border px-1.5 font-mono text-small transition-[background-color,border-color,color] duration-(--dur-slow) ease-out",
      pencil ? "border-dashed border-foreground/35 text-muted-foreground" : "border-transparent bg-foreground/[0.06] text-foreground/80",
      className,
    )}
  >
    {pencil && <span className="sr-only">Suggested: </span>}
    {children}
  </span>
);

export const ModelTag = ({ className }: { className?: string }) => (
  <span translate="no" className={cn("shrink-0 text-micro whitespace-nowrap text-faint-foreground", className)}>
    {MODEL}
  </span>
);

const sourceTitle = (source: SourceRef) => {
  if (source.kind === "note") return titleOf(source.id);
  if (source.kind === "task") return TASKS[source.id].title;
  if (source.kind === "day") return source.label;
  return memoryText(source.id);
};

const sourceTint = (source: SourceRef) => {
  if (source.kind === "note") {
    const area = areaOf(source.id);
    return area ? areaVar(area.colour) : undefined;
  }
  return source.kind === "task" ? areaVar(AREAS[TASKS[source.id].area].colour) : undefined;
};

const SOURCE_WORD = { note: "Note", task: "Task", day: "Day", memory: "From memory" } as const satisfies Record<SourceRef["kind"], string>;

const SourceGlyph = ({ source }: { source: SourceRef }) => {
  if (source.kind === "note") return <NoteIcon weight="fill" className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />;
  if (source.kind === "day") return <CalendarBlank weight="fill" className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />;
  if (source.kind === "memory") return <BookmarkSimple weight="fill" className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />;
  return <span aria-hidden="true" className="size-3 shrink-0 rounded-[4px] shadow-[inset_0_0_0_1.5px] shadow-foreground/40" />;
};

export const SourceChip = ({ source, pencil = false, className }: { source: SourceRef; pencil?: boolean; className?: string }) => {
  const tint = sourceTint(source);
  const title = sourceTitle(source);
  return (
    <button
      type="button"
      title={source.kind === "memory" ? title : undefined}
      onClick={() => toast(source.kind === "memory" ? "Opens this memory, to edit or forget" : `${title} opens beside this`, { id: "open-source" })}
      className={cn(
        "relative inline-flex h-6 max-w-[13rem] min-w-0 items-center gap-1.5 rounded-full border px-2 text-micro font-medium text-muted-foreground transition-[background-color,border-color,color,scale] duration-(--dur-press) ease-out before:absolute before:-inset-y-2 before:inset-x-0 hover:text-foreground active:scale-[0.97]",
        pencil ? "border-dashed border-foreground/30" : "border-transparent bg-foreground/[0.05] hover:bg-foreground/[0.08]",
        AI_RING,
        className,
      )}
    >
      <SourceGlyph source={source} />
      <span className="sr-only">
        {pencil && "Suggested "}
        {SOURCE_WORD[source.kind]}:{" "}
      </span>
      <span className="truncate">{title}</span>
      {tint && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: tint }} />}
    </button>
  );
};

export const SourceDots = ({ sources, of, className }: { sources: SourceRef[]; of?: number; className?: string }) => (
  <span aria-hidden="true" className={cn("inline-flex items-center gap-[3px]", className)}>
    {sources.map((source) => (
      <span key={sourceKey(source)} className="size-1.5 animate-dot-in rounded-full" style={{ backgroundColor: sourceTint(source) ?? "var(--muted-foreground)" }} />
    ))}
    {Array.from({ length: Math.max(0, (of ?? 0) - sources.length) }, (_, index) => (
      <span key={index} className="size-1.5 rounded-full bg-foreground/[0.11]" />
    ))}
  </span>
);

export const Sources = ({ sources, label = "Looked at", startOpen = false, className }: { sources: SourceRef[]; label?: string; startOpen?: boolean; className?: string }) => {
  const [open, setOpen] = useState(startOpen);
  if (sources.length === 0) return null;
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-1.5", AI_RING, className)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="relative inline-flex h-6 shrink-0 items-center gap-2 rounded-full px-1.5 text-micro text-muted-foreground transition-[background-color,color,scale] duration-(--dur-press) ease-out before:absolute before:-inset-y-2 before:inset-x-0 hover:bg-foreground/[0.05] hover:text-foreground active:scale-[0.97]"
      >
        <SourceDots sources={sources} />
        {label} {sources.length}
        <span className="sr-only"> sources</span>
      </button>
      {open && sources.map((source) => <SourceChip key={sourceKey(source)} source={source} className="animate-fade-in" />)}
    </div>
  );
};
