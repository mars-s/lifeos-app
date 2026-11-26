"use client";

import {
  Archive,
  ArrowsOutSimple,
  BookOpen,
  CalendarDot,
  CheckSquare,
  Kanban,
  MagnifyingGlass,
  Note as NoteIcon,
  Notebook,
  NotePencil,
  Stack,
  Star,
  Tray,
  X,
  type Icon,
} from "@phosphor-icons/react";
import { use, useId, useState } from "react";
import { IconButton } from "@/components/ui/action-button";
import { Kbd, KeyCombo } from "@/components/ui/key-hint";
import { toast } from "@/components/ui/toast-stack";
import { AreaDot, areaVar } from "@/components/lifeos/area";
import { DayMeter, type MeterSlice } from "@/components/lifeos/capacity";
import { formatRange } from "@/components/lifeos/format";
import { ProgressPie } from "@/components/lifeos/progress-ring";
import { SidebarItem } from "@/components/lifeos/sidebar-item";
import { EstimateChip, StrikeTitle, TaskCheckbox } from "@/components/lifeos/task-row";
import { cn } from "@/lib/utils";
import { Specimen } from "../specimen";
import { bestMatches, NOTE_IDS, PROJECT_IDS, TASK_IDS, type NoteId, type ProjectId, type TaskId } from "./model";
import { SyncIndicator } from "./parts";
import { NOTE_TYPE, NoteProse, NotesContext } from "./prose";
import { AREAS, areaOf, excerptOf, NOTES, placeOf, PROJECTS, TASKS } from "./sample";
import { NoteMeta } from "./window";

const SidebarEntry = () => (
  <nav aria-label="Sidebar with Notes" className="flex w-full max-w-56 flex-col gap-4">
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
    </div>
    <SyncIndicator state={{ kind: "synced", devices: 3 }} className="px-2.5" />
  </nav>
);

type Result =
  | { kind: "note"; id: NoteId }
  | { kind: "task"; id: TaskId }
  | { kind: "project"; id: ProjectId }
  | { kind: "action"; id: string; label: string; icon: Icon; keys?: string };

const ACTIONS: Result[] = [
  { kind: "action", id: "today", label: "Open today’s note", icon: CalendarDot, keys: "mod+d" },
  { kind: "action", id: "notebook", label: "Type in from the notebook", icon: BookOpen, keys: "mod+shift+n" },
];

const resultKey = (result: Result) => `${result.kind}-${result.id}`;
const GROUPS = { note: "Notes", task: "Tasks", project: "Projects", action: "Actions" } as const satisfies Record<Result["kind"], string>;

const search = (query: string) => {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...(["retrieval", "day-19", "outline"] as const).map((id) => ({ kind: "note", id }) satisfies Result), ...ACTIONS];
  const byTitle = bestMatches(NOTE_IDS, (id) => NOTES[id].title, query);
  const byText = NOTE_IDS.filter((id) => !byTitle.includes(id) && excerptOf(id).toLowerCase().includes(needle));
  const notes = [...byTitle, ...byText].slice(0, 4).map((id) => ({ kind: "note", id }) satisfies Result);
  const tasks = bestMatches(TASK_IDS, (id) => TASKS[id].title, query)
    .slice(0, 2)
    .map((id) => ({ kind: "task", id }) satisfies Result);
  const projects = bestMatches(PROJECT_IDS, (id) => PROJECTS[id].title, query).map((id) => ({ kind: "project", id }) satisfies Result);
  const create: Result = { kind: "action", id: "create", label: `New note “${query.trim()}”`, icon: NotePencil };
  return [...notes, ...tasks, ...projects, create, ...ACTIONS.filter((action) => action.kind === "action" && action.label.toLowerCase().includes(needle))];
};

const Lit = ({ text, query }: { text: string; query: string }) => {
  const needle = query.trim();
  const at = needle ? text.toLowerCase().indexOf(needle.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <span className="font-semibold text-foreground">{text.slice(at, at + needle.length)}</span>
      {text.slice(at + needle.length)}
    </>
  );
};

const ResultRow = ({ result, query, active }: { result: Result; query: string; active: boolean }) => {
  const tint = active ? "text-brand" : "text-muted-foreground";
  if (result.kind === "note") {
    const area = areaOf(result.id);
    return (
      <>
        <NoteIcon weight="fill" className={cn("size-4 shrink-0", tint)} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">
          <span className="text-foreground/90">
            <Lit text={NOTES[result.id].title} query={query} />
          </span>
          <span className="ml-2 text-faint-foreground">
            <Lit text={excerptOf(result.id)} query={query} />
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-micro text-faint-foreground">
          {placeOf(result.id)}
          {area && <AreaDot colour={area.colour} className="size-1.5" />}
        </span>
      </>
    );
  }
  if (result.kind === "task")
    return (
      <>
        <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center">
          <span className="size-3.5 rounded-[4.5px] shadow-[inset_0_0_0_1.5px] shadow-foreground/35" />
        </span>
        <span className="min-w-0 flex-1 truncate text-foreground/90">
          <Lit text={TASKS[result.id].title} query={query} />
        </span>
        <span className="shrink-0 text-micro text-faint-foreground">{TASKS[result.id].when ?? "Anytime"}</span>
      </>
    );
  if (result.kind === "project")
    return (
      <>
        <ProgressPie value={PROJECTS[result.id].progress} colour={areaVar(AREAS[PROJECTS[result.id].area].colour)} />
        <span className="min-w-0 flex-1 truncate text-foreground/90">
          <Lit text={PROJECTS[result.id].title} query={query} />
        </span>
        <span className="shrink-0 text-micro text-faint-foreground">{AREAS[PROJECTS[result.id].area].name}</span>
      </>
    );
  return (
    <>
      <result.icon weight="fill" className={cn("size-4 shrink-0", tint)} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-foreground/90">{result.label}</span>
      {result.keys && <KeyCombo keys={result.keys} />}
    </>
  );
};

const resultTitle = (result: Result) =>
  result.kind === "action" ? result.label : `Opens ${result.kind === "note" ? NOTES[result.id].title : result.kind === "task" ? TASKS[result.id].title : PROJECTS[result.id].title}`;
const run = (result: Result) => toast(resultTitle(result), { id: "command-bar" });

const CommandBarResults = () => {
  const listId = useId();
  const [query, setQuery] = useState("retr");
  const [index, setIndex] = useState(0);
  const results = search(query);
  const active = results[Math.min(index, results.length - 1)];
  const groups = [...new Set(results.map((result) => result.kind))];
  return (
    <div className="w-full max-w-[36rem] overflow-hidden rounded-2xl bg-popover shadow-float">
      <label className="flex h-12 items-center gap-3 px-4 transition-colors duration-(--dur-fast) focus-within:bg-foreground/[0.025]">
        <MagnifyingGlass weight="bold" className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          type="text"
          role="combobox"
          name="command-bar"
          aria-label="Search notes, Tasks and actions"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={active ? `${listId}-${resultKey(active)}` : undefined}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : -1;
              setIndex((Math.min(index, results.length - 1) + step + results.length) % Math.max(1, results.length));
            }
            if (event.key === "Enter" && active) run(active);
            if (event.key === "Escape") setQuery("");
          }}
          placeholder="Search Tasks, notes, Areas and actions…"
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-faint-foreground"
        />
        <Kbd>Esc</Kbd>
      </label>
      <div id={listId} role="listbox" aria-label="Results" className="bg-foreground/[0.03] p-1.5">
        {groups.map((group) => (
          <div key={group} role="group" aria-label={GROUPS[group]}>
            <p className="px-2.5 pt-2 pb-1 text-small text-faint-foreground">{query.trim() || group !== "note" ? GROUPS[group] : "Recent notes"}</p>
            {results
              .filter((result) => result.kind === group)
              .map((result) => (
                <div
                  key={resultKey(result)}
                  id={`${listId}-${resultKey(result)}`}
                  role="option"
                  aria-selected={result === active}
                  onPointerMove={() => setIndex(results.indexOf(result))}
                  onClick={() => run(result)}
                  className={cn("flex h-9 cursor-default items-center gap-3 rounded-lg px-2.5 text-small", result === active && "bg-foreground/[0.07]")}
                >
                  <ResultRow result={result} query={query} active={result === active} />
                </div>
              ))}
          </div>
        ))}
      </div>
      <p className="flex h-10 items-center gap-4 px-4 text-micro text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Kbd>↵</Kbd> Open
        </span>
        <span className="flex items-center gap-1.5">
          <KeyCombo keys="mod+enter" /> Open beside
        </span>
        <span className="ml-auto flex items-center gap-1.5 @max-sm:hidden">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> Move
        </span>
      </p>
    </div>
  );
};

const DAY_TASKS: TaskId[] = ["outline-draft", "papers", "copy-review"];
const HOURS = ["9 am", "10 am", "11 am", "12 pm", "1 pm", "2 pm"];

const BesidePlanner = () => {
  const { taskDone, toggleTask } = use(NotesContext);
  const [open, setOpen] = useState(true);
  const slices: MeterSlice[] = DAY_TASKS.map((id) => ({ id, colour: AREAS[TASKS[id].area].colour, minutes: TASKS[id].estimate ?? 0, guess: false }));
  return (
    <div className="relative flex h-[31rem] w-full overflow-hidden rounded-xl">
      <section aria-label="Thursday in the Planner" className="flex w-full shrink-0 flex-col gap-2 p-1 @2xl:w-72">
        <h4 className="flex items-baseline gap-2 px-1 text-heading">
          <span className="font-semibold">Thu</span>
          <span>19 Nov</span>
          <span className="text-small text-brand">Today</span>
        </h4>
        <DayMeter slices={slices} goal={300} free={300} className="px-1" />
        <ul className="mt-1 space-y-1.5">
          {DAY_TASKS.map((id) => {
            const task = TASKS[id];
            const linked = task.notes[0];
            return (
              <li key={id} className="rounded-xl bg-foreground/[0.04] p-3">
                <div className="flex items-start gap-2.5">
                  <TaskCheckbox checked={taskDone(id)} onCheckedChange={() => toggleTask(id)} label={`Complete ${task.title}`} className="mt-[3px]" />
                  <StrikeTitle struck={taskDone(id)} className="min-w-0 flex-1 text-body whitespace-normal">
                    {task.title}
                  </StrikeTitle>
                  {task.estimate !== undefined && <EstimateChip minutes={task.estimate} />}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-7 text-small text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <AreaDot colour={AREAS[task.area].colour} />
                    {task.project ? PROJECTS[task.project].title : AREAS[task.area].name}
                  </span>
                  {linked && (
                    <button
                      type="button"
                      aria-expanded={id === "papers" ? open : undefined}
                      onClick={id === "papers" ? () => setOpen((shown) => !shown) : undefined}
                      className={cn(
                        "-mx-1.5 inline-flex h-6 max-w-full items-center gap-1 rounded-full px-1.5 transition-[background-color,color,scale] duration-(--dur-press) ease-out hover:bg-foreground/[0.06] hover:text-foreground active:scale-[0.97]",
                        id === "papers" && open && "bg-foreground/[0.06] text-foreground",
                      )}
                    >
                      <NoteIcon weight="fill" className="size-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">{NOTES[linked].title}</span>
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      <div aria-hidden="true" className="relative min-w-0 flex-1 @max-2xl:hidden">
        {HOURS.map((hour, index) => (
          <div key={hour} className="absolute inset-x-0 flex items-start gap-2" style={{ top: `${index * 4.5 + 0.75}rem` }}>
            <span className="w-10 shrink-0 -translate-y-2 text-right font-mono text-micro text-faint-foreground">{hour}</span>
            <span className="h-px flex-1 border-t border-dashed border-foreground/15" />
          </div>
        ))}
        <div className="absolute right-1 left-12 rounded-lg p-2" style={{ top: "5.25rem", height: "6.5rem", backgroundColor: "color-mix(in oklab, var(--area-violet) 22%, var(--surface-inset))" }}>
          <p className="text-small font-medium">Draft the thesis outline</p>
          <p className="font-mono text-micro text-muted-foreground">{formatRange(600, 690)}</p>
        </div>
        <div className="absolute right-1 left-12 rounded-lg p-2" style={{ top: "18.75rem", height: "4.25rem", backgroundColor: "color-mix(in oklab, var(--area-violet) 22%, var(--surface-inset))" }}>
          <p className="text-small font-medium">Read two papers on retrieval</p>
          <p className="font-mono text-micro text-muted-foreground">{formatRange(780, 840)}</p>
        </div>
      </div>
      <aside
        aria-label="Retrieval experiments, beside the Planner"
        inert={!open}
        className={cn(
          "absolute inset-y-0 right-0 flex w-full flex-col rounded-xl bg-popover shadow-lift transition-[translate,opacity] ease-drawer motion-reduce:transition-opacity @2xl:w-[23rem]",
          open ? "translate-x-0 opacity-100 duration-(--dur-slow)" : "translate-x-6 opacity-0 duration-(--dur-fast) motion-reduce:translate-x-0",
        )}
      >
        <div className="flex h-11 shrink-0 items-center gap-1 pr-1.5 pl-4">
          <p className="flex min-w-0 flex-1 items-center gap-1.5 text-small text-muted-foreground">
            <AreaDot colour="violet" />
            <span className="truncate">Honours thesis</span>
          </p>
          <IconButton icon={ArrowsOutSimple} iconWeight="bold" label="Open in Notes" />
          <IconButton icon={X} iconWeight="bold" label="Close note" onClick={() => setOpen(false)} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6">
          <h4 className={NOTE_TYPE.compact.title}>{NOTES.retrieval.title}</h4>
          <NoteMeta id="retrieval" />
          <NoteProse blocks={NOTES.retrieval.blocks.slice(0, 5)} size="compact" className="mt-5" editor={{ todoDone: (id) => id === "recall" || id === "negatives", onToggleTodo: () => {} }} />
        </div>
      </aside>
    </div>
  );
};

export const ShellSpecimens = () => (
  <>
    <Specimen
      name="Sidebar entry"
      note="Notes is one row of its own, between the lists and the Logbook. The same quiet sync line sits at the foot."
      className="md:col-span-2 xl:col-span-3"
      stage="bg-surface items-stretch justify-start"
    >
      <SidebarEntry />
    </Specimen>
    <Specimen
      name="Command bar"
      note="Cmd+K finds notes by title and by text, next to Tasks and Projects. Enter opens, Cmd+Enter opens beside what you are doing."
      className="md:col-span-4 xl:col-span-9"
    >
      <CommandBarResults />
    </Specimen>
    <Specimen
      name="A note beside the Planner"
      note="A Task that links to a note shows it as a small chip. Press it and the note slides in over the calendar, so the day stays in view."
      className="md:col-span-6 xl:col-span-12"
      stage="items-stretch p-3 sm:p-4"
    >
      <BesidePlanner />
    </Specimen>
  </>
);
