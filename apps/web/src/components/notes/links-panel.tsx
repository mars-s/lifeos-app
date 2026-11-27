"use client";

import { Plus } from "@phosphor-icons/react";
import { useQuery } from "convex/react";
import type { ReactNode } from "react";
import { api } from "@lifeos/backend/api";
import { projectNote, titleKey } from "@lifeos/notes/markdown";
import { AreaDot } from "@/components/lifeos/area";
import { StrikeTitle, TaskCheckbox } from "@/components/lifeos/task-row";
import { cn } from "@/lib/utils";
import { useNoteActions } from "./actions";
import { useChips, useDocText, type NoteItem } from "./data";
import { openNote } from "./library";

const PanelHeading = ({ children, count }: { children: ReactNode; count: number }) => (
  <h3 className="flex h-7 items-center justify-between px-2 text-micro font-medium text-faint-foreground">
    {children}
    <span className="font-mono">{count}</span>
  </h3>
);

const PanelRow = ({ onClick, children }: { onClick?: () => void; children: ReactNode }) => (
  <button
    type="button"
    onClick={onClick}
    className="block w-full rounded-lg px-2 py-1.5 text-left transition-[background-color,scale] duration-(--dur-press) ease-out hover:bg-foreground/[0.04] active:scale-[0.985]"
  >
    {children}
  </button>
);

export const LinksPanel = ({
  docId,
  items,
  onOpen,
  onOpenTitle,
  className,
}: {
  docId: string;
  items: NoteItem[];
  onOpen: (docId: string) => void;
  onOpenTitle: (title: string) => void;
  className?: string;
}) => {
  const text = useDocText(openNote(docId).doc);
  const chips = useChips(text);
  const actions = useNoteActions();
  const links = useQuery(api.notes.notes.links, { docId });
  const projection = projectNote(text);
  const known = new Set(items.map((item) => titleKey(item.title)));
  const missing = projection.noteTitles.filter((title) => !known.has(titleKey(title)));
  const linkedNotes = projection.noteTitles
    .map((title) => items.find((item) => titleKey(item.title) === titleKey(title)))
    .filter((item): item is NoteItem => item !== undefined);
  const tasks = projection.entities.filter((entity) => entity.table === "tasks");
  const others = projection.entities.filter((entity) => entity.table !== "tasks");
  const linkedFrom = links?.linkedFrom ?? [];
  const outCount = linkedNotes.length + others.length + missing.length;
  return (
    <aside aria-label="Links" className={cn("m-1.5 ml-0 flex w-64 shrink-0 animate-fade-in flex-col gap-2 overflow-y-auto overscroll-contain rounded-xl bg-foreground/[0.03] p-1.5", className)}>
      {tasks.length > 0 && (
        <section aria-label="Tasks">
          <PanelHeading count={tasks.length}>Tasks</PanelHeading>
          <ul>
            {tasks.map((task) => {
              const info = chips.get(task.id);
              const done = info?.done ?? false;
              const title = info?.title ?? task.alias ?? "Task";
              return (
                <li key={task.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
                  <TaskCheckbox checked={done} onCheckedChange={(next) => actions.toggleTask(task.id, next)} label={title} />
                  <button type="button" onClick={() => void actions.openEntity("tasks", task.id)} className="min-w-0 flex-1 truncate rounded-[4px] text-left text-small">
                    <StrikeTitle struck={done}>{title}</StrikeTitle>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <section aria-label="Linked from">
        <PanelHeading count={linkedFrom.length}>Linked from</PanelHeading>
        {linkedFrom.length === 0 && <p className="px-2 pb-2 text-small text-pretty text-muted-foreground">Nothing links here yet. Type [[ in another note to connect it.</p>}
        <ul>
          {linkedFrom.map((note) => (
            <li key={note.docId}>
              <PanelRow onClick={() => onOpen(note.docId)}>
                <span className="block truncate text-small font-medium">{note.title}</span>
                {note.excerpt && <span className="mt-0.5 line-clamp-2 text-micro text-pretty text-muted-foreground">{note.excerpt}</span>}
              </PanelRow>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="Links out">
        <PanelHeading count={outCount}>Links out</PanelHeading>
        {outCount === 0 && <p className="px-2 pb-2 text-small text-pretty text-muted-foreground">This note does not link anywhere yet.</p>}
        <ul>
          {linkedNotes.map((note) => (
            <li key={note.docId}>
              <PanelRow onClick={() => onOpen(note.docId)}>
                <span className="block truncate text-small">{note.title}</span>
              </PanelRow>
            </li>
          ))}
          {others.map((entity) => {
            const info = chips.get(entity.id);
            return (
              <li key={entity.id}>
                <PanelRow onClick={() => void actions.openEntity(entity.table, entity.id)}>
                  <span className="flex items-center gap-2 text-small">
                    {info?.colour ? <AreaDot colour={info.colour as never} className="size-1.5" /> : <span className="size-1.5 rounded-full bg-faint-foreground" aria-hidden="true" />}
                    <span className="min-w-0 flex-1 truncate">{info?.title ?? entity.alias ?? (entity.table === "projects" ? "Project" : "Area")}</span>
                    <span className="text-micro text-faint-foreground">{entity.table === "projects" ? "Project" : "Area"}</span>
                  </span>
                </PanelRow>
              </li>
            );
          })}
          {missing.map((title) => (
            <li key={title}>
              <PanelRow onClick={() => onOpenTitle(title)}>
                <span className="flex items-center gap-2 text-small text-muted-foreground">
                  <span className="min-w-0 flex-1 truncate underline decoration-foreground/25 decoration-dashed underline-offset-[3px]">{title}</span>
                  <span className="inline-flex items-center gap-1 text-micro text-faint-foreground">
                    <Plus weight="bold" className="size-3" aria-hidden="true" />
                    Create
                  </span>
                </span>
              </PanelRow>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
};
