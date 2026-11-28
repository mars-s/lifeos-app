"use client";

import {
  Archive,
  CalendarDot,
  CalendarDots,
  CheckSquare,
  Kanban,
  ListBullets,
  MagnifyingGlass,
  Note as NoteIcon,
  Notebook,
  Stack,
  Star,
  Tray,
  type Icon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { KeyCombo } from "@/components/ui/key-hint";
import { AiMark } from "@/components/lifeos/ai-orb";
import { AreaDot } from "@/components/lifeos/area";
import { formatMinutes } from "@/components/lifeos/format";
import { SidebarItem } from "@/components/lifeos/sidebar-item";
import { cn } from "@/lib/utils";
import { Specimen } from "../specimen";
import { SectionLabel, SyncIndicator } from "./parts";
import { AREAS, RECENT, titleOf } from "./sample";

type Mode = "planner" | "notes";

const MODES = [
  { mode: "planner", label: "Planner", icon: Kanban, keys: "mod+1" },
  { mode: "notes", label: "Notes", icon: Notebook, keys: "mod+2" },
] as const satisfies readonly { mode: Mode; label: string; icon: Icon; keys: string }[];

const ModeToggle = ({ mode, onMode, className }: { mode: Mode; onMode: (mode: Mode) => void; className?: string }) => (
  <div role="group" aria-label="Mode" className={cn("relative grid grid-cols-2 rounded-[0.625rem] bg-foreground/[0.06] p-0.5", className)}>
    <span
      aria-hidden="true"
      className={cn(
        "absolute inset-y-0.5 left-0.5 w-[calc(50%-0.125rem)] rounded-lg bg-surface-raised shadow-lift transition-transform duration-(--dur-press) ease-out motion-reduce:transition-none",
        mode === "notes" && "translate-x-full",
      )}
    />
    {MODES.map(({ mode: value, label, icon: ModeIcon }) => (
      <button
        key={value}
        type="button"
        aria-label={label}
        aria-pressed={mode === value}
        title={label}
        onClick={() => onMode(value)}
        className={cn(
          "relative grid h-7 w-9 place-items-center rounded-lg transition-[color,scale] duration-(--dur-press) ease-out active:scale-[0.94]",
          mode === value ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        <ModeIcon weight={mode === value ? "fill" : "regular"} className="size-4" aria-hidden="true" />
      </button>
    ))}
  </div>
);

const Lights = () => (
  <span aria-hidden="true" className="flex items-center gap-1.5">
    {[0, 1, 2].map((light) => (
      <span key={light} className="size-2.5 rounded-full bg-foreground/15" />
    ))}
  </span>
);

const SIDEBAR_AREAS = ["university", "personal", "paperless"] as const;

const PlannerSidebar = () => (
  <>
    <div>
      <SidebarItem icon={Tray} label="Inbox" count={4} />
    </div>
    <div>
      <SidebarItem icon={Star} label="Today" count={8} active />
      <SidebarItem icon={Kanban} label="Planner" />
      <SidebarItem icon={Stack} label="Anytime" />
      <SidebarItem icon={Archive} label="Someday" />
    </div>
    <div>
      {SIDEBAR_AREAS.map((area) => (
        <SidebarItem key={area} leading={<AreaDot colour={AREAS[area].colour} />} label={AREAS[area].name} />
      ))}
    </div>
    <div>
      <SidebarItem icon={CheckSquare} label="Logbook" />
    </div>
  </>
);

const NotesSidebar = () => (
  <>
    <div className="flex h-8 items-center gap-2 rounded-full bg-foreground/[0.05] px-3 text-small text-faint-foreground">
      <MagnifyingGlass weight="bold" className="size-3.5 text-muted-foreground" aria-hidden="true" />
      Search notes
    </div>
    <div>
      <SidebarItem icon={CalendarDot} label="Today" />
    </div>
    <div>
      <SectionLabel>Recent</SectionLabel>
      {RECENT.slice(0, 3).map((id, index) => (
        <SidebarItem key={id} icon={NoteIcon} label={titleOf(id)} active={index === 0} />
      ))}
    </div>
    <div>
      <SectionLabel>Areas</SectionLabel>
      {SIDEBAR_AREAS.map((area) => (
        <SidebarItem key={area} leading={<AreaDot colour={AREAS[area].colour} />} label={AREAS[area].name} />
      ))}
    </div>
  </>
);

const Box = ({ done = false }: { done?: boolean }) => (
  <span
    aria-hidden="true"
    className={cn("grid size-[1.125rem] shrink-0 place-items-center rounded-[6px]", done ? "bg-brand text-brand-foreground" : "shadow-[inset_0_0_0_1.5px] shadow-foreground/30")}
  >
    {done && (
      <svg viewBox="0 0 18 18" className="size-full">
        <path d="M5 9.5l2.7 2.7L13 6.7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )}
  </span>
);

const TODAY_TASKS = [
  { title: "Read two papers on retrieval", minutes: 60, note: "Retrieval experiments" },
  { title: "Rerun the baseline", minutes: 45 },
  { title: "Book the ferry to Naoshima", minutes: 15 },
  { title: "Review the onboarding copy", minutes: 30 },
] as const satisfies readonly { title: string; minutes: number; note?: string }[];

const Crossing = ({ children }: { children: React.ReactNode }) => (
  <p className="mt-auto flex items-start gap-2 pt-6 text-small text-pretty text-muted-foreground">
    <span aria-hidden="true" className="mt-[0.4375rem] size-1.5 shrink-0 rounded-full bg-foreground/25" />
    {children}
  </p>
);

const PlannerMain = () => (
  <>
    <h4 className="flex items-center gap-2 text-title font-semibold">
      <Star weight="fill" className="size-5 text-brand" aria-hidden="true" />
      Today
    </h4>
    <ul className="mt-4 -mx-2">
      {TODAY_TASKS.map((task) => (
        <li key={task.title} className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-2 py-1.5">
          <Box />
          <span className="min-w-40 flex-1 truncate">{task.title}</span>
          {"note" in task && (
            <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-(image:--button-secondary) pr-2.5 pl-2 text-small font-medium">
              <Notebook weight="fill" className="size-3.5 text-muted-foreground" aria-hidden="true" />
              {task.note}
            </span>
          )}
          <span className="font-mono text-small text-muted-foreground">{formatMinutes(task.minutes)}</span>
        </li>
      ))}
    </ul>
    <Crossing>A note chip on a Task opens the note beside the Planner. The mode does not change.</Crossing>
  </>
);

const NotesMain = () => (
  <>
    <p className="flex items-center gap-1.5 text-small text-muted-foreground">
      <AreaDot colour={AREAS.university.colour} className="size-1.5" />
      University
      <span aria-hidden="true" className="text-faint-foreground">
        /
      </span>
      Honours thesis
    </p>
    <h4 className="mt-2 text-title font-semibold">Retrieval experiments</h4>
    <p className="mt-3 max-w-prose text-pretty text-foreground/85">
      The dense retriever beats BM25 on the long questions and loses on the short ones. Rerun with the reranker before writing it up.
    </p>
    <p className="mt-3 inline-flex h-8 w-fit max-w-full items-center gap-2.5 rounded-lg bg-(image:--button-secondary) pr-3 pl-2 text-small">
      <Box />
      <span className="truncate font-medium">Rerun the baseline</span>
      <span className="font-mono text-muted-foreground">{formatMinutes(45)}</span>
    </p>
    <Crossing>A Task chip in a note ticks and opens the real Task, here on the page. The mode does not change.</Crossing>
  </>
);

const ModesWindow = () => {
  const [mode, setMode] = useState<Mode>("planner");
  return (
    <div data-mode={mode} className="flex w-full max-w-[62rem] flex-col overflow-hidden rounded-2xl bg-background shadow-float md:h-[27rem] md:flex-row">
      <aside className="flex shrink-0 flex-col bg-surface md:w-60">
        <div className="flex h-12 items-center justify-between pr-2.5 pl-4">
          <Lights />
          <ModeToggle mode={mode} onMode={setMode} />
        </div>
        <nav aria-label={mode === "planner" ? "Planner lists" : "Notes"} className="flex flex-1 flex-col gap-3 px-2.5 pb-2.5">
          {mode === "planner" ? <PlannerSidebar /> : <NotesSidebar />}
          <SyncIndicator state={{ kind: "synced", devices: 3 }} className="mt-auto px-2.5 pt-2 max-md:hidden" />
        </nav>
      </aside>
      <div className="flex min-h-64 min-w-0 flex-1 flex-col p-6 sm:p-8">{mode === "planner" ? <PlannerMain /> : <NotesMain />}</div>
    </div>
  );
};

const SwitchStates = () => {
  const [mode, setMode] = useState<Mode>("planner");
  return (
    <div className="flex w-full max-w-64 flex-col gap-5">
      <div className="flex items-center justify-between rounded-xl bg-surface py-2 pr-2.5 pl-4">
        <Lights />
        <ModeToggle mode={mode} onMode={setMode} />
      </div>
      <dl className="space-y-2 text-small">
        {MODES.map(({ mode: value, label, icon: ModeIcon, keys }) => (
          <div key={value} className="flex items-center gap-2.5">
            <ModeIcon weight={mode === value ? "fill" : "regular"} className={cn("size-4", mode === value ? "text-foreground" : "text-muted-foreground")} aria-hidden="true" />
            <dt className={cn("flex-1", mode === value ? "font-medium" : "text-muted-foreground")}>{label}</dt>
            <dd>
              <KeyCombo keys={keys} />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
};

const BRIDGES = [
  { icon: Notebook, line: "A note beside the Planner", detail: "The chip on a Task, or Cmd+Enter in the command bar." },
  { icon: CheckSquare, line: "Tasks inside a note", detail: "Chips tick, open the card and undo, in place." },
  { icon: MagnifyingGlass, line: "Cmd+K finds both", detail: "Enter goes there and switches mode if it must." },
  { icon: AiMark, line: "Cmd+J on what is in front", detail: "A Task or a note. It reads across both." },
  { icon: CalendarDot, line: "The day links both ways", detail: "The Planner’s day header opens that day’s note." },
] as const;

const Bridges = () => (
  <ul className="w-full max-w-sm space-y-3.5">
    {BRIDGES.map(({ icon: BridgeIcon, line, detail }) => (
      <li key={line} className="flex items-start gap-3">
        <BridgeIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="min-w-0 text-small text-pretty">
          <span className="font-medium">{line}</span>
          <span className="block text-muted-foreground">{detail}</span>
        </p>
      </li>
    ))}
  </ul>
);

const TABS = [
  { label: "Today", icon: Star },
  { label: "Upcoming", icon: CalendarDots },
  { label: "Lists", icon: ListBullets },
  { label: "Notes", icon: Notebook },
] as const;

const PhoneTabs = () => (
  <div className="flex w-full max-w-80 items-center gap-2">
    <div role="group" aria-label="iPhone tabs" className="flex h-14 flex-1 items-center rounded-full bg-surface-raised px-1.5 shadow-lift">
      {TABS.map(({ label, icon: TabIcon }) => (
        <span
          key={label}
          className={cn("flex h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-micro", label === "Notes" ? "bg-foreground/[0.07] font-medium text-foreground" : "text-muted-foreground")}
        >
          <TabIcon weight="fill" className="size-[1.125rem]" aria-hidden="true" />
          {label}
        </span>
      ))}
    </div>
    <span aria-hidden="true" className="grid size-14 shrink-0 place-items-center rounded-full bg-surface-raised text-muted-foreground shadow-lift">
      <MagnifyingGlass weight="bold" className="size-5" />
    </span>
  </div>
);

export const ModeSpecimens = () => (
  <>
    <Specimen
      name="Two modes, one window"
      note="Press the switch. The sidebar becomes the Planner’s lists or the notes column, and each mode comes back to where you left it. Nothing else in the window moves."
      className="md:col-span-6 xl:col-span-12"
      stage="items-stretch p-3 sm:p-4 md:items-center"
    >
      <ModesWindow />
    </Specimen>
    <Specimen
      name="The switch"
      note="Two glyphs in the title bar on the Mac, at the top of the sidebar on the web. Cmd+1 and Cmd+2 from anywhere, with no animation on the keys."
      className="md:col-span-3 xl:col-span-4"
    >
      <SwitchStates />
    </Specimen>
    <Specimen
      name="What crosses over"
      note="The switch changes the sidebar, not what you can reach. These five work the same in both modes."
      className="md:col-span-3 xl:col-span-4"
      stage="items-start justify-start"
    >
      <Bridges />
    </Specimen>
    <Specimen
      name="iPhone"
      note="No switch. The tab bar already is one, and Notes keeps its tab. A second control above it would be two ways to do one thing."
      className="md:col-span-6 xl:col-span-4"
    >
      <PhoneTabs />
    </Specimen>
  </>
);
