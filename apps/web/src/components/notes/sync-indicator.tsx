"use client";

import type { SyncStatus } from "@lifeos/notes/client";
import { MorphText } from "@/components/ui/morph-text";
import { cn } from "@/lib/utils";
import { useNotesStatus } from "./use-note";

export const syncWords = (status: SyncStatus) => {
  switch (status.kind) {
    case "synced":
      return "Synced";
    case "connecting":
      return "Connecting";
    case "offline":
      return status.waiting > 0 ? `Offline. ${status.waiting} ${status.waiting === 1 ? "edit" : "edits"} kept here` : "Offline";
    case "merging":
      return `Merging ${status.edits} ${status.edits === 1 ? "edit" : "edits"}`;
  }
};

const SyncGlyph = ({ status }: { status: SyncStatus }) => {
  if (status.kind === "merging")
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
          status.kind === "synced" ? "bg-positive/80" : "shadow-[inset_0_0_0_1.5px] shadow-muted-foreground",
        )}
      />
    </span>
  );
};

export const SyncIndicator = ({ status, words = true, className }: { status: SyncStatus; words?: boolean; className?: string }) => (
  <span role="status" className={cn("inline-flex h-6 items-center gap-1.5 text-micro text-muted-foreground", className)}>
    <SyncGlyph status={status} />
    {words ? <MorphText>{syncWords(status)}</MorphText> : <span className="sr-only">{syncWords(status)}</span>}
  </span>
);

export const NotesSyncDot = () => {
  const status = useNotesStatus();
  return (
    <span aria-hidden="true" title={syncWords(status)} className="relative ml-auto inline-flex h-6 items-center">
      <SyncGlyph status={status} />
    </span>
  );
};
