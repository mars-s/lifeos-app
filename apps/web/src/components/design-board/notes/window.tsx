"use client";

import {
  Archive,
  CalendarDot,
  CaretLeft,
  CaretRight,
  CheckSquare,
  DotsThree,
  Kanban,
  Notebook,
  NotePencil,
  SidebarSimple,
  Stack,
  Star,
  Trash,
  Tray,
} from "@phosphor-icons/react";
import { useState } from "react";
import { Button, IconButton } from "@/components/ui/action-button";
import { toast } from "@/components/ui/toast-stack";
import { Tooltip } from "@/components/ui/tooltip-hint";
import { AreaDot, areaVar } from "@/components/lifeos/area";
import { ProgressPie } from "@/components/lifeos/progress-ring";
import { SidebarItem } from "@/components/lifeos/sidebar-item";
import { cn } from "@/lib/utils";
import { NotebookPages } from "./daily";
import { Backlinks, LocalGraph, OutgoingLinks } from "./links";
import { backlinksOf, NOTE_IDS, type AreaId, type NoteId, type SyncState } from "./model";
import { Fold, LinkDots, NoteRow, SearchPill, SectionLabel, SyncIndicator, syncWords } from "./parts";
import { LabelPill, NOTE_TYPE, NoteProse } from "./prose";
import { AREAS, excerptOf, NOTES, PROJECTS, RECENT, TREE, UNFILED, type TreeBranch } from "./sample";
import { NotesProvider, type NotesWorld } from "./state";

const SYNCED: SyncState = { kind: "synced", devices: 3 };

const AppSidebar = () => (
  <nav aria-label="LifeOS" className="relative flex w-52 shrink-0 flex-col gap-4 px-2 pt-12 pb-2 @max-5xl/window:hidden">
    <span aria-hidden="true" className="absolute top-4 left-4 flex gap-2">
      {[0, 1, 2].map((dot) => (
        <span key={dot} className="size-3 rounded-full bg-foreground/[0.13]" />
      ))}
    </span>
    <div>
      <SidebarItem icon={Tray} label="Inbox" count={4} />
    </div>
    <div>
      <SidebarItem icon={Star} label="Today" count={8} />
      <SidebarItem icon={Kanban} label="Planner" />
      <SidebarItem icon={Stack} label="Anytime" />
      <SidebarItem icon={Archive} label="Someday" />
    </div>
    <div>
      <SidebarItem icon={Notebook} label="Notes" active />
    </div>
    <div>
      <SidebarItem icon={CheckSquare} label="Logbook" />
      <SidebarItem icon={Trash} label="Trash" />
    </div>
    <div>
      {(Object.keys(AREAS) as AreaId[]).map((id) => (
        <SidebarItem key={id} leading={<AreaDot colour={AREAS[id].colour} className="size-2.5" />} label={AREAS[id].name} />
      ))}
    </div>
    <SyncIndicator state={SYNCED} className="mt-auto px-2.5" />
  </nav>
);

const TreeNote = ({ id, active, deep, onOpen }: { id: NoteId; active: boolean; deep: boolean; onOpen: (id: NoteId) => void }) => (
  <button
    type="button"
    aria-current={active ? "page" : undefined}
    onClick={() => onOpen(id)}
    className={cn(
      "flex h-7 w-full items-center rounded-lg pr-2.5 text-left text-small transition-[background-color,scale] duration-(--dur-press) ease-out active:scale-[0.985]",
      deep ? "pl-[3.25rem]" : "pl-8",
      active ? "bg-foreground/[0.08] font-medium text-foreground" : "text-foreground/80 hover:bg-foreground/[0.04]",
    )}
  >
    <span className="truncate">{NOTES[id].title}</span>
  </button>
);

const TreeArea = ({ branch, open, onToggle, current, onOpen }: { branch: TreeBranch; open: boolean; onToggle: () => void; current: NoteId; onOpen: (id: NoteId) => void }) => {
  const area = AREAS[branch.area];
  const count = branch.loose.length + branch.folders.reduce((sum, folder) => sum + folder.notes.length, 0);
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
        <span className="min-w-0 flex-1 truncate">{area.name}</span>
        <span className="font-mono text-micro text-faint-foreground">{count}</span>
      </button>
      <Fold open={open}>
        {branch.folders.map((folder) => (
          <div key={folder.project}>
            <div className="flex h-7 items-center gap-2 pr-2.5 pl-8 text-small text-muted-foreground">
              <ProgressPie value={PROJECTS[folder.project].progress} colour={areaVar(area.colour)} className="size-3.5" />
              <span className="truncate">{PROJECTS[folder.project].title}</span>
            </div>
            {folder.notes.map((id) => (
              <TreeNote key={id} id={id} deep active={id === current} onOpen={onOpen} />
            ))}
          </div>
        ))}
        {branch.loose.map((id) => (
          <TreeNote key={id} id={id} deep={false} active={id === current} onOpen={onOpen} />
        ))}
      </Fold>
    </li>
  );
};

const matches = (id: NoteId, query: string) => `${NOTES[id].title} ${excerptOf(id)}`.toLowerCase().includes(query.toLowerCase());

const NotesColumn = ({ current, onOpen, className }: { current: NoteId; onOpen: (id: NoteId) => void; className?: string }) => {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<AreaId>>(new Set(["university"]));
  const found = query.trim() ? NOTE_IDS.filter((id) => matches(id, query.trim())) : [];
  const toggle = (id: AreaId) => setExpanded((open) => new Set(open.has(id) ? [...open].filter((other) => other !== id) : [...open, id]));
  return (
    <section aria-label="Notes" className={cn("flex min-h-0 w-64 shrink-0 flex-col", className)}>
      <div className="flex h-12 items-center justify-between pr-2 pl-4">
        <h3 className="text-heading font-semibold">Notes</h3>
        <IconButton icon={NotePencil} label="New note" variant="quiet" tooltip="New note" onClick={() => toast("A new note opens here, filed where you were", { id: "new-note" })} />
      </div>
      <div className="px-2 pb-2">
        <SearchPill value={query} onChange={setQuery} placeholder="Search notes…" label="Search notes" hint="/" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
        {query.trim() ? (
          found.length > 0 ? (
            <ul className="animate-fade-in">
              <SectionLabel>{found.length === 1 ? "1 note" : `${found.length} notes`}</SectionLabel>
              {found.map((id) => (
                <li key={id}>
                  <NoteRow id={id} active={id === current} query={query.trim()} place onOpen={onOpen} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="animate-fade-in px-2.5 pt-6 text-center">
              <p className="text-small font-medium">No notes match</p>
              <p className="mt-1 text-small text-pretty text-muted-foreground">Nothing has “{query.trim()}” in its title or text.</p>
              <Button
                size="sm"
                icon={NotePencil}
                className="mt-4 max-w-full"
                onClick={() => {
                  toast(`A new note called “${query.trim()}” opens, ready to type`, { id: "new-note" });
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
              aria-current={current === "day-19" ? "page" : undefined}
              onClick={() => onOpen("day-19")}
              className={cn(
                "flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-small transition-[background-color,scale] duration-(--dur-press) ease-out active:scale-[0.985]",
                current === "day-19" ? "bg-foreground/[0.08] font-medium" : "hover:bg-foreground/[0.04]",
              )}
            >
              <CalendarDot weight="fill" className={cn("size-4 shrink-0", current === "day-19" ? "text-brand" : "text-muted-foreground")} aria-hidden="true" />
              <span className="flex-1">Today</span>
              <span className="text-micro text-faint-foreground">Thu 19 Nov</span>
            </button>
            <div className="mt-3">
              <SectionLabel>Recent</SectionLabel>
              <ul>
                {RECENT.filter((id) => id !== "day-19").map((id) => (
                  <li key={id}>
                    <NoteRow id={id} active={id === current} onOpen={onOpen} />
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-3">
              <SectionLabel>Areas</SectionLabel>
              <ul>
                {TREE.map((branch) => (
                  <TreeArea key={branch.area} branch={branch} open={expanded.has(branch.area)} onToggle={() => toggle(branch.area)} current={current} onOpen={onOpen} />
                ))}
              </ul>
            </div>
            <div className="mt-3">
              <SectionLabel>Unfiled</SectionLabel>
              {UNFILED.map((id) => (
                <NoteRow key={id} id={id} active={id === current} onOpen={onOpen} />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
};

export const NoteMeta = ({ id, onShowLinks }: { id: NoteId; onShowLinks?: (() => void) | undefined }) => {
  const note = NOTES[id];
  const back = backlinksOf(id, NOTES).map((link) => link.from);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-small text-muted-foreground">
      {note.labels.map((label) => (
        <LabelPill key={label} name={label} />
      ))}
      <span>Edited {note.edited.toLowerCase()}</span>
      {back.length > 0 && (
        <button
          type="button"
          onClick={onShowLinks}
          className="inline-flex h-6 items-center gap-1.5 rounded-full px-2 transition-[background-color,color,scale] duration-(--dur-press) ease-out hover:bg-foreground/[0.06] hover:text-foreground active:scale-[0.97]"
        >
          <LinkDots from={back} />
          <span>
            <span className="font-mono">{back.length}</span> linked from
          </span>
        </button>
      )}
    </div>
  );
};

const Breadcrumb = ({ id }: { id: NoteId }) => {
  const { area, project, day } = NOTES[id];
  const crumbs = day ? ["Journal"] : [area ? AREAS[area].name : "Unfiled", ...(project ? [PROJECTS[project].title] : [])];
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-small text-muted-foreground">
      {area && <AreaDot colour={AREAS[area].colour} />}
      {crumbs.map((crumb, index) => (
        <span key={crumb} className="flex min-w-0 items-center gap-1.5">
          {index > 0 && <CaretRight weight="bold" className="size-2.5 shrink-0 text-faint-foreground" aria-hidden="true" />}
          <span className="truncate">{crumb}</span>
        </span>
      ))}
    </p>
  );
};

const Editor = ({
  world,
  sync,
  linksOpen,
  onToggleLinks,
  onBack,
  fontFamily,
  className,
}: {
  world: NotesWorld;
  sync: SyncState;
  linksOpen: boolean;
  onToggleLinks: () => void;
  onBack: () => void;
  fontFamily: string | undefined;
  className?: string;
}) => {
  const [active, setActive] = useState<number | undefined>(4);
  const note = NOTES[world.open];
  return (
    <article aria-label={note.title} className={cn("relative flex min-w-0 flex-1 flex-col", className)}>
      <header className="absolute inset-x-0 top-0 z-10 flex h-14 items-start gap-2 rounded-t-2xl bg-surface-inset/75 px-3 pt-2 backdrop-blur-md [mask-image:linear-gradient(to_bottom,black_62%,transparent)]">
        <Button variant="quiet" size="sm" icon={CaretLeft} iconWeight="bold" onClick={onBack} className="-ml-1 px-2 @2xl/window:hidden">
          Notes
        </Button>
        <div className="flex h-8 min-w-0 flex-1 items-center pl-1.5 @max-2xl/window:hidden">
          <Breadcrumb id={world.open} />
        </div>
        <div className="ml-auto flex items-center gap-0.5">
          <Tooltip content={syncWords(sync)} side="bottom" align="end">
            <button type="button" aria-label={syncWords(sync)} className="grid size-8 place-items-center rounded-full transition-colors duration-(--dur-fast) hover:bg-foreground/[0.06]">
              <SyncIndicator state={sync} words={false} />
            </button>
          </Tooltip>
          <IconButton icon={SidebarSimple} label={linksOpen ? "Hide links" : "Show links"} aria-pressed={linksOpen} onClick={onToggleLinks} className={cn("-scale-x-100 @max-4xl/window:hidden", linksOpen && "text-foreground")} />
          <IconButton icon={DotsThree} iconWeight="bold" label="More" />
        </div>
      </header>
      <div key={world.open} className="min-h-0 flex-1 animate-fade-in overflow-y-auto overscroll-contain" style={fontFamily ? { fontFamily } : undefined}>
        <div className="mx-auto w-full max-w-[43.75rem] px-6 pt-[4.5rem] pb-24 @2xl/window:px-12">
          <h3 className={cn("text-balance", NOTE_TYPE.reading.title)}>{note.title}</h3>
          <NoteMeta id={world.open} onShowLinks={linksOpen ? undefined : onToggleLinks} />
          <NoteProse
            blocks={note.blocks}
            className="mt-7"
            editor={{
              active: world.open === "retrieval" ? active : undefined,
              onActivate: world.open === "retrieval" ? setActive : undefined,
              todoDone: world.todoDone,
              onToggleTodo: world.toggleTodo,
              onMakeTask: world.makeTask,
              taskFor: world.taskFor,
            }}
          />
          {note.notebook && <NotebookPages pages={note.notebook} className="mt-8" />}
        </div>
      </div>
    </article>
  );
};

const LinksPanel = ({ id }: { id: NoteId }) => (
  <aside aria-label="Links" className="m-1.5 ml-0 flex w-64 shrink-0 animate-fade-in flex-col gap-2 overflow-y-auto overscroll-contain rounded-xl bg-foreground/[0.03] p-1.5 @max-4xl/window:hidden">
    <LocalGraph id={id} />
    <Backlinks id={id} />
    <OutgoingLinks id={id} />
  </aside>
);

export const NotesWindow = ({ world, sync = SYNCED, fontFamily }: { world: NotesWorld; sync?: SyncState; fontFamily?: string | undefined }) => {
  const [linksOpen, setLinksOpen] = useState(true);
  const [pane, setPane] = useState<"list" | "note">("list");
  const open = (id: NoteId) => {
    world.setOpen(id);
    setPane("note");
  };
  return (
    <NotesProvider world={{ ...world, actions: { ...world.actions, openNote: open } }}>
      <div className="@container/window relative overflow-hidden rounded-[1.375rem]">
        <img src="/art/blur/afternoon.webp" alt="" width={1536} height={1024} draggable={false} className="absolute inset-0 size-full object-cover opacity-90 saturate-[0.8] select-none @max-3xl/window:hidden dark:hidden" />
        <img src="/art/blur/night.webp" alt="" width={1536} height={1024} draggable={false} className="absolute inset-0 hidden size-full object-cover select-none @3xl/window:dark:block" />
        <div className="relative @3xl/window:p-5">
          <div className="flex h-[42rem] overflow-hidden bg-surface/[0.86] backdrop-blur-2xl backdrop-saturate-150 @3xl/window:h-[46rem] @3xl/window:rounded-2xl @3xl/window:shadow-float [@media(prefers-reduced-transparency:reduce)]:bg-surface">
            <AppSidebar />
            <div className="flex min-w-0 flex-1 rounded-2xl bg-surface-inset @3xl/window:m-1.5 @5xl/window:ml-0">
              <NotesColumn current={world.open} onOpen={open} className={cn("@max-2xl/window:w-full", pane === "note" && "@max-2xl/window:hidden")} />
              <Editor
                world={world}
                sync={sync}
                linksOpen={linksOpen}
                onToggleLinks={() => setLinksOpen((shown) => !shown)}
                onBack={() => setPane("list")}
                fontFamily={fontFamily}
                className={cn(pane === "list" && "@max-2xl/window:hidden")}
              />
              {linksOpen && <LinksPanel id={world.open} />}
            </div>
          </div>
        </div>
      </div>
    </NotesProvider>
  );
};
