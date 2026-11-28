"use client";

import { CalendarDot, CaretLeft, CaretRight, DotsThree, Notebook, NotePencil, SidebarSimple } from "@phosphor-icons/react";
import { useAtom } from "@effect/atom-react";
import { Schema } from "effect";
import { Atom } from "effect/reactivity";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Id } from "@lifeos/backend/dataModel";
import type { SidebarView } from "@lifeos/backend/types";
import { projectNote, titleKey, type FolderRef } from "@lifeos/notes/markdown";
import { Button, IconButton } from "@/components/ui/action-button";
import { Menu, type MenuItem } from "@/components/ui/action-menu";
import { Tooltip } from "@/components/ui/tooltip-hint";
import { AreaDot, areaVar } from "@/components/lifeos/area";
import { EmptyState } from "@/components/lifeos/states";
import { AiMark } from "@/components/lifeos/ai-orb";
import { cn } from "@/lib/utils";
import { atomRuntime } from "../../lib/runtime";
import { AskBox, NOTE_ASK_VERBS } from "../app/ai/ask-box";
import { useNoteAsk } from "../app/ai/task-ask";
import { useShell } from "../app/shell-context";
import { useNoteActions } from "./actions";
import { DayHeader, NotebookCapture } from "./daily";
import { useChips, useDocText, useFolder, useNoteItems, useNoteLookup, useSuggest, type NoteItem } from "./data";
import { NoteEditor, type NoteEditorHost } from "@lifeos/notes/editor";
import { dailyDocId, ensureDaily, newDocId, openNote, setFolder, textOf } from "./library";
import { LinksPanel } from "./links-panel";
import { NoteRow, SearchPill, SectionLabel, Fold } from "./parts";
import { SyncIndicator, syncWords } from "./sync-indicator";
import { useNote } from "./use-note";

type Place = { area?: SidebarView["areas"][number]; project?: { _id: Id<"projects">; title: string } };

const placeOf = (sidebar: SidebarView | undefined, folder: FolderRef | null | undefined) => {
  if (!folder || !sidebar) return {} satisfies Place;
  if (folder.table === "areas") {
    const area = sidebar.areas.find((entry) => entry._id === folder.id);
    return (area ? { area } : {}) satisfies Place;
  }
  for (const area of sidebar.areas) {
    const project = area.projects.find((entry) => entry._id === folder.id);
    if (project) return { area, project } satisfies Place;
  }
  const project = sidebar.projects.find((entry) => entry._id === folder.id);
  return (project ? { project } : {}) satisfies Place;
};

const placeWords = (item: NoteItem, sidebar: SidebarView | undefined) => {
  if (item.day) return "Journal";
  const place = placeOf(sidebar, item.projectId ? { table: "projects", id: item.projectId } : item.areaId ? { table: "areas", id: item.areaId } : null);
  return [place.area?.title, place.project?.title].filter(Boolean).join(" › ") || "Unfiled";
};

const edited = (at: number) => {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const date = new Date(at);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
  return date.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
};

const dayWords = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });

const TreeNote = ({ item, active, deep, onOpen }: { item: NoteItem; active: boolean; deep: boolean; onOpen: (docId: string) => void }) => (
  <button
    type="button"
    aria-current={active ? "page" : undefined}
    onClick={() => onOpen(item.docId)}
    className={cn(
      "flex h-7 w-full items-center rounded-lg pr-2.5 text-left text-small transition-[background-color,scale] duration-(--dur-press) ease-out active:scale-[0.985]",
      deep ? "pl-[3.25rem]" : "pl-8",
      active ? "bg-foreground/[0.08] font-medium text-foreground" : "text-foreground/80 hover:bg-foreground/[0.04]",
    )}
  >
    <span className="truncate">{item.title}</span>
  </button>
);

const TreeArea = ({
  area,
  notes,
  open,
  onToggle,
  current,
  onOpen,
}: {
  area: SidebarView["areas"][number];
  notes: NoteItem[];
  open: boolean;
  onToggle: () => void;
  current: string | null;
  onOpen: (docId: string) => void;
}) => {
  const loose = notes.filter((note) => !note.projectId);
  const folders = area.projects
    .map((project) => ({ project, notes: notes.filter((note) => note.projectId === project._id) }))
    .filter((folder) => folder.notes.length > 0);
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex h-7 w-full items-center gap-2 rounded-lg pr-2.5 pl-2 text-left text-small text-foreground/90 transition-[background-color,scale] duration-(--dur-press) ease-out hover:bg-foreground/[0.04] active:scale-[0.985]"
      >
        <CaretRight weight="bold" aria-hidden="true" className={cn("size-2.5 shrink-0 text-faint-foreground transition-transform duration-(--dur-fast) ease-out", open && "rotate-90")} />
        <AreaDot colour={area.colour} />
        <span className="min-w-0 flex-1 truncate">{area.title}</span>
        <span className="font-mono text-micro text-faint-foreground">{notes.length}</span>
      </button>
      <Fold open={open}>
        {folders.map((folder) => (
          <div key={folder.project._id}>
            <div className="flex h-7 items-center gap-2 pr-2.5 pl-8 text-small text-muted-foreground">
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ boxShadow: `inset 0 0 0 1.5px ${areaVar(area.colour)}` }} />
              <span className="truncate">{folder.project.title}</span>
            </div>
            {folder.notes.map((note) => (
              <TreeNote key={note.docId} item={note} deep active={note.docId === current} onOpen={onOpen} />
            ))}
          </div>
        ))}
        {loose.map((note) => (
          <TreeNote key={note.docId} item={note} deep={false} active={note.docId === current} onOpen={onOpen} />
        ))}
      </Fold>
    </li>
  );
};

export const NotesColumn = ({
  items,
  sidebar,
  current,
  today,
  onOpen,
  onCreate,
  heading,
  className,
}: {
  items: NoteItem[];
  sidebar: SidebarView | undefined;
  current: string | null;
  today: string;
  onOpen: (docId: string) => void;
  onCreate: (title?: string) => void;
  heading: boolean;
  className?: string;
}) => {
  const [query, setQuery] = useState("");
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const wanted = query.trim().toLowerCase();
  const writing = items.filter((item) => !item.day);
  const found = wanted ? writing.filter((item) => `${item.title} ${item.excerpt}`.toLowerCase().includes(wanted)) : [];
  const recent = writing.slice(0, 5);
  const areas = (sidebar?.areas ?? []).map((area) => ({ area, notes: writing.filter((item) => item.areaId === area._id) })).filter((branch) => branch.notes.length > 0);
  const unfiled = writing.filter((item) => !item.areaId && !item.projectId);
  const todayId = dailyDocId(today);
  const toggle = (id: string) => setClosed((shut) => new Set(shut.has(id) ? [...shut].filter((other) => other !== id) : [...shut, id]));
  return (
    <section aria-label="Notes" className={cn("flex min-h-0 shrink-0 flex-col", className)}>
      {heading && (
        <div className="flex h-12 items-center justify-between pr-2 pl-4">
          <h2 className="text-heading font-semibold">Notes</h2>
          <IconButton icon={NotePencil} label="New note" variant="quiet" tooltip="New note" onClick={() => onCreate()} />
        </div>
      )}
      <div className={cn("flex items-center gap-1 pb-2", heading ? "px-2" : "pr-0.5")}>
        <SearchPill value={query} onChange={setQuery} placeholder="Search notes…" label="Search notes" className="min-w-0 flex-1" />
        {!heading && <IconButton icon={NotePencil} label="New note" variant="quiet" tooltip="New note" onClick={() => onCreate()} />}
      </div>
      <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3", heading && "px-2")}>
        {wanted ? (
          found.length > 0 ? (
            <ul className="animate-fade-in">
              <div role="status">
                <SectionLabel>{found.length === 1 ? "1 note" : `${found.length} notes`}</SectionLabel>
              </div>
              {found.map((item) => (
                <li key={item.docId}>
                  <NoteRow item={item} meta={placeWords(item, sidebar)} active={item.docId === current} query={query.trim()} colour={colourOf(item, sidebar)} onOpen={onOpen} />
                </li>
              ))}
            </ul>
          ) : (
            <div role="status" className="animate-fade-in px-2.5 pt-6 text-center">
              <p className="text-small font-medium">No notes match</p>
              <p className="mt-1 text-small text-pretty text-muted-foreground">Nothing has “{query.trim()}” in its title or text.</p>
              <Button
                size="sm"
                icon={NotePencil}
                className="mt-4 max-w-full"
                onClick={() => {
                  onCreate(query.trim());
                  setQuery("");
                }}
              >
                <span className="truncate">New note “{query.trim()}”</span>
              </Button>
            </div>
          )
        ) : (
          <>
            <button
              type="button"
              aria-current={current === todayId ? "page" : undefined}
              onClick={() => onOpen(todayId)}
              className={cn(
                "flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-small transition-[background-color,scale] duration-(--dur-press) ease-out active:scale-[0.985]",
                current === todayId ? "bg-foreground/[0.08] font-medium" : "hover:bg-foreground/[0.04]",
              )}
            >
              <CalendarDot weight="fill" className={cn("size-4 shrink-0", current === todayId ? "text-brand" : "text-muted-foreground")} aria-hidden="true" />
              <span className="flex-1">Today</span>
              <span className="text-micro text-faint-foreground">{dayWords(today)}</span>
            </button>
            {recent.length > 0 && (
              <div className="mt-3">
                <SectionLabel>Recent</SectionLabel>
                <ul>
                  {recent.map((item) => (
                    <li key={item.docId}>
                      <NoteRow item={item} meta={edited(item.editedAt)} active={item.docId === current} colour={colourOf(item, sidebar)} onOpen={onOpen} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {areas.length > 0 && (
              <div className="mt-3">
                <SectionLabel>Areas</SectionLabel>
                <ul>
                  {areas.map(({ area, notes }) => (
                    <TreeArea key={area._id} area={area} notes={notes} open={!closed.has(area._id)} onToggle={() => toggle(area._id)} current={current} onOpen={onOpen} />
                  ))}
                </ul>
              </div>
            )}
            {unfiled.length > 0 && (
              <div className="mt-3">
                <SectionLabel>Unfiled</SectionLabel>
                {unfiled.map((item) => (
                  <NoteRow key={item.docId} item={item} meta={edited(item.editedAt)} active={item.docId === current} onOpen={onOpen} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
};

const colourOf = (item: NoteItem, sidebar: SidebarView | undefined) => sidebar?.areas.find((area) => area._id === item.areaId)?.colour;

const Breadcrumb = ({ place, day }: { place: Place; day: string | undefined }) => {
  const crumbs = day ? ["Journal"] : [place.area?.title ?? (place.project ? undefined : "Unfiled"), place.project?.title].filter((crumb): crumb is string => Boolean(crumb));
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-small text-muted-foreground">
      {place.area && <AreaDot colour={place.area.colour} />}
      {crumbs.map((crumb, index) => (
        <span key={crumb} className="flex min-w-0 items-center gap-1.5">
          {index > 0 && <CaretRight weight="bold" className="size-2.5 shrink-0 text-faint-foreground" aria-hidden="true" />}
          <span className="truncate">{crumb}</span>
        </span>
      ))}
    </p>
  );
};

const folderItems = (sidebar: SidebarView | undefined, current: FolderRef | null, choose: (folder: FolderRef | null) => void) => {
  const unfiled: MenuItem = { id: "unfiled", label: "Unfiled", onSelect: () => choose(null), ...(current ? {} : { description: "Here now" }) };
  const inAreas = (sidebar?.areas ?? []).flatMap((area) => {
    const row: MenuItem = { id: area._id, label: area.title, leading: <AreaDot colour={area.colour} />, onSelect: () => choose({ table: "areas", id: area._id }) };
    const projects = area.projects.map((project) => ({ id: project._id, label: project.title, indent: true, onSelect: () => choose({ table: "projects", id: project._id }) }) satisfies MenuItem);
    return [row, ...projects];
  });
  const loose = (sidebar?.projects ?? []).map((project) => ({ id: project._id, label: project.title, onSelect: () => choose({ table: "projects", id: project._id }) }) satisfies MenuItem);
  return [unfiled, ...inAreas, ...loose];
};

export const NotePage = ({
  docId,
  items,
  sidebar,
  size = "reading",
  linksOpen,
  onToggleLinks,
  onBack,
  onOpenTitle,
  autoFocus,
  extra,
  onTrashed,
  className,
}: {
  docId: string;
  items: NoteItem[];
  sidebar: SidebarView | undefined;
  size?: "reading" | "compact";
  linksOpen?: boolean;
  onToggleLinks?: () => void;
  onBack?: () => void;
  onOpenTitle: (title: string) => void;
  autoFocus: boolean;
  extra?: ReactNode;
  onTrashed?: () => void;
  className?: string;
}) => {
  const note = useNote(docId);
  const actions = useNoteActions();
  const text = useDocText(note?.doc);
  const folder = useFolder(note?.doc);
  const chips = useChips(text);
  const lookup = useNoteLookup(items);
  const suggest = useSuggest(items, docId);
  const item = items.find((entry) => entry.docId === docId);
  const day = docId.startsWith("day-") ? docId.slice(4) : undefined;
  const place = placeOf(sidebar, folder);
  const [notebook, setNotebook] = useState(false);
  useEffect(() => {
    if (note?.ready && day) ensureDaily(note.doc, day);
  }, [note?.ready, note?.doc, day]);

  const host = useMemo<NoteEditorHost>(
    () => ({
      openNote: onOpenTitle,
      openEntity: (table, id) => void actions.openEntity(table, id),
      toggleTask: actions.toggleTask,
      noteExists: (title) => lookup.has(titleKey(title)),
      suggest,
      makeTask: (title, done) => actions.makeTask(title, folder ?? undefined, done),
    }),
    [actions, folder, lookup, onOpenTitle, suggest],
  );

  const title = projectNote(text).title;
  const ask = useNoteAsk(day ? `Journal for ${day}` : title, text);
  const [askVia, setAskVia] = useState<"keys" | "pointer">("keys");
  const openAsk = ask.open;
  useEffect(() => {
    if (!ask.available) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "j") return;
      if (document.querySelector("li[data-open-card]")) return;
      event.preventDefault();
      setAskVia("keys");
      openAsk();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ask.available, openAsk]);
  const more: MenuItem[] = [
    { type: "submenu", id: "move", label: "Move to", items: folderItems(sidebar, folder, (next) => note && setFolder(note.doc, next)) },
    ...(day ? [{ id: "notebook", label: "Add a notebook page", onSelect: () => setNotebook(true) } satisfies MenuItem] : []),
    {
      id: "trash",
      label: "Move to Trash",
      destructive: true,
      onSelect: () => {
        actions.trash(item?.id, docId, () => {});
        onTrashed?.();
      },
    },
  ];

  return (
    <article aria-label={title} className={cn("relative flex min-w-0 flex-1 flex-col", className)}>
      <header className="absolute inset-x-0 top-0 z-10 flex h-14 items-start gap-2 rounded-t-2xl bg-surface-inset/75 px-3 pt-2 backdrop-blur-md [mask-image:linear-gradient(to_bottom,black_62%,transparent)]">
        {onBack && (
          <Button variant="quiet" size="sm" icon={CaretLeft} iconWeight="bold" onClick={onBack} className="-ml-1 px-2 md:hidden">
            Notes
          </Button>
        )}
        <div className={cn("flex h-8 min-w-0 flex-1 items-center pl-1.5", onBack && "max-md:hidden")}>
          <Breadcrumb place={place} day={day} />
        </div>
        <div className="ml-auto flex items-center gap-0.5">
          <Tooltip content={note ? syncWords(note.status) : "Opening"} side="bottom" align="end">
            <button type="button" className="grid size-8 place-items-center rounded-full transition-colors duration-(--dur-fast) hover:bg-foreground/[0.06]">
              {note && <SyncIndicator status={note.status} words={false} />}
            </button>
          </Tooltip>
          {ask.available && (
            <IconButton
              icon={AiMark}
              label="Ask AI"
              tooltip
              aria-keyshortcuts="Meta+J"
              aria-expanded={ask.phase.kind !== "idle"}
              onClick={() => {
                setAskVia("pointer");
                ask.open();
              }}
            />
          )}
          {day && <IconButton icon={Notebook} label="Add a notebook page" tooltip onClick={() => setNotebook(true)} />}
          {onToggleLinks && (
            <IconButton
              icon={SidebarSimple}
              label="Links"
              aria-pressed={linksOpen}
              onClick={onToggleLinks}
              className={cn("-scale-x-100 max-[1023px]:hidden", linksOpen && "text-foreground")}
            />
          )}
          <Menu groups={[{ items: more }]} align="end" trigger={<IconButton icon={DotsThree} iconWeight="bold" label="More" />} />
          {extra}
        </div>
      </header>
      {ask.phase.kind !== "idle" && (
        <div className="absolute inset-x-0 top-12 z-20 flex justify-center px-3">
          <AskBox ask={ask} via={askVia} verbs={NOTE_ASK_VERBS} reads="Reads this note. Nothing changes in it." label="LifeOS AI on this note" />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-12">
        {day && <DayHeader date={day} size={size} />}
        {note?.ready ? (
          <NoteEditor
            key={docId}
            doc={note.doc}
            awareness={note.awareness}
            host={host}
            chips={chips}
            notesVersion={items.length}
            size={size}
            autoFocus={autoFocus}
            titled={!day}
            label={day ? `Journal for ${day}` : title}
            placeholder={day ? "Write about the day" : "Start with a title"}
          />
        ) : (
          <div className="mx-auto h-40 max-w-[43.75rem]" />
        )}
      </div>
      {notebook && note && day && <NotebookCapture doc={note.doc} date={day} folder={folder} onClose={() => setNotebook(false)} />}
    </article>
  );
};

const LINKS_KEY = "lifeos-notes-links-open";

const linksOpenAtom = Atom.kvs({ runtime: atomRuntime, key: LINKS_KEY, schema: Schema.Literals([0, 1]), defaultValue: () => 1 as const }).pipe(
  Atom.withServerValue(() => 1),
);

let freshDoc: string | null = null;

export const useNotesNav = (sidebar: SidebarView | undefined) => {
  const shell = useShell();
  const items = useNoteItems(sidebar);
  const open = (next: string) => shell.navigate({ kind: "notes", id: next }, "pointer");
  const create = (title?: string) => {
    const id = newDocId();
    const { doc, ready } = openNote(id);
    void ready.then(() => {
      if (title) doc.transact(() => textOf(doc).insert(0, `${title}\n`));
      freshDoc = id;
      open(id);
    });
  };
  const openTitle = (title: string) => {
    const known = items.find((item) => titleKey(item.title) === titleKey(title));
    if (known) open(known.docId);
    else create(title);
  };
  return { items, open, create, openTitle };
};

export const NotesScreen = ({ docId, sidebar }: { docId: string | null; sidebar: SidebarView | undefined }) => {
  const shell = useShell();
  const { items, open, create, openTitle } = useNotesNav(sidebar);
  const [shown, showLinks] = useAtom(linksOpenAtom);
  const linksOpen = shown === 1;
  const toggleLinks = () => showLinks(linksOpen ? 0 : 1);

  return (
    <div className="flex h-[calc(100dvh-0.75rem)] max-md:h-[calc(100dvh-3rem)]">
      <title>Notes · LifeOS</title>
      {docId ? (
        <>
          <NotePage
            key={docId}
            docId={docId}
            items={items}
            sidebar={sidebar}
            linksOpen={linksOpen}
            onToggleLinks={toggleLinks}
            onBack={() => shell.navigate({ kind: "notes" }, "pointer")}
            onTrashed={() => shell.navigate({ kind: "notes" }, "pointer")}
            onOpenTitle={openTitle}
            autoFocus={freshDoc === docId || shell.via === "keyboard"}
            className="animate-fade-in"
          />
          {linksOpen && <LinksPanel docId={docId} items={items} onOpen={open} onOpenTitle={openTitle} className="max-[1023px]:hidden" />}
        </>
      ) : (
        <>
          <NotesColumn items={items} sidebar={sidebar} current={null} today={shell.today} onOpen={open} onCreate={create} heading className="w-full md:hidden" />
          <div className="grid min-w-0 flex-1 place-items-center max-md:hidden">
            <EmptyState title="Pick a note, or start one" hint="Notes save on this device as you type and sync when you are online." />
          </div>
        </>
      )}
    </div>
  );
};
