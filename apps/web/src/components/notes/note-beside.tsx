"use client";

import { ArrowsOut, Notebook, X } from "@phosphor-icons/react";
import { useQuery } from "convex/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { titleKey } from "@lifeos/notes/markdown";
import { api } from "@lifeos/backend/api";
import type { Id } from "@lifeos/backend/dataModel";
import type { SidebarView } from "@lifeos/backend/types";
import { IconButton } from "@/components/ui/action-button";
import { cn } from "@/lib/utils";
import { useShell } from "../app/shell-context";
import { useNoteItems } from "./data";
import { newDocId, openNote, textOf } from "./library";
import { NotePage } from "./notes-screen";

let current: string | null = null;
const listeners = new Set<() => void>();

const set = (docId: string | null) => {
  current = docId;
  for (const listener of listeners) listener();
};

export const openBeside = (docId: string) => set(docId);
export const closeBeside = () => set(null);

const useBeside = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => null,
  );

export const NoteBeside = ({ sidebar }: { sidebar: SidebarView | undefined }) => {
  const docId = useBeside();
  const shell = useShell();
  const reduce = useReducedMotion();
  const items = useNoteItems(sidebar);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!docId) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = setTimeout(() => panel.current?.querySelector<HTMLElement>(".cm-content")?.focus(), 60);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], [role="menu"], [cmdk-root], .cm-tooltip-autocomplete')) return;
      closeBeside();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [docId]);
  useEffect(() => {
    if (shell.route.kind === "notes") closeBeside();
  }, [shell.route.kind]);
  return (
    <AnimatePresence>
      {docId && (
        <motion.aside
          key={docId}
          ref={panel}
          aria-label="Note beside the Planner"
          initial={reduce ? { opacity: 0 } : { opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0, transition: { duration: 0.32, ease: [0.32, 0.72, 0, 1] } }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, x: 24, transition: { duration: 0.16, ease: [0.32, 0.72, 0, 1] } }}
          className="fixed inset-y-1.5 right-1.5 z-40 flex w-[min(28rem,calc(100vw-0.75rem))] flex-col overflow-hidden rounded-2xl bg-surface-inset shadow-float"
        >
          <NotePage
            docId={docId}
            items={items}
            sidebar={sidebar}
            size="compact"
            onOpenTitle={(title) => {
              const known = items.find((item) => titleKey(item.title) === titleKey(title));
              if (known) return openBeside(known.docId);
              const created = newDocId();
              const { doc, ready } = openNote(created);
              void ready.then(() => {
                doc.transact(() => textOf(doc).insert(0, `${title}\n`));
                openBeside(created);
              });
            }}
            onTrashed={closeBeside}
            autoFocus={false}
            className="min-h-0"
            extra={
              <>
                <IconButton
              icon={ArrowsOut}
              label="Open in Notes"
              tooltip
              onClick={() => {
                    shell.navigate({ kind: "notes", id: docId }, "pointer");
                    closeBeside();
                  }}
                />
                <IconButton icon={X} iconWeight="bold" label="Close the note" tooltip onClick={closeBeside} />
              </>
            }
          />
        </motion.aside>
      )}
    </AnimatePresence>
  );
};

export const TaskNotes = ({ taskId, className }: { taskId: Id<"tasks">; className?: string }) => {
  const notes = useQuery(api.notes.notes.forEntity, { entity: { table: "tasks", id: taskId } });
  if (!notes || notes.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {notes.map((note) => (
        <button
          key={note.docId}
          type="button"
          onClick={() => openBeside(note.docId)}
          className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-full bg-(image:--button-secondary) pr-2.5 pl-2 text-small font-medium transition-[scale,background-image] duration-(--dur-press) ease-out hover:bg-(image:--button-secondary-hover) active:scale-[0.97]"
        >
          <Notebook weight="fill" className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate">{note.title}</span>
        </button>
      ))}
    </div>
  );
};
