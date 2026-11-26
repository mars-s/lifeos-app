"use client";

import {
  ArrowBendUpRight,
  ArrowRight,
  BookOpen,
  CalendarDot,
  CalendarDots,
  CaretLeft,
  CaretRight,
  Check,
  DotsThree,
  LinkSimple,
  ListBullets,
  MagnifyingGlass,
  Note as NoteIcon,
  Notebook,
  NotePencil,
  Stack,
  Star,
  TextH,
  X,
  type Icon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Segmented } from "@/components/ui/segmented-control";
import { Tag } from "@/components/ui/status-pill";
import { AreaDot } from "@/components/lifeos/area";
import { cn } from "@/lib/utils";
import { Specimen } from "../specimen";
import { MonthDots, WeekStrip } from "./daily";
import { Backlinks, LocalGraph, OutgoingLinks } from "./links";
import { NOTE_IDS, type AreaId, type NoteId } from "./model";
import { LinkDots } from "./parts";
import { Caret, LabelPill, NOTE_TYPE, NoteProse } from "./prose";
import { AREAS, areaOf, excerptOf, NOTES, placeOf } from "./sample";

const SCREEN = { width: 390, height: 800 } as const;

const GLASS_STYLE: CSSProperties = {
  background: "light-dark(rgb(255 255 255 / 0.72), rgb(64 66 74 / 0.66))",
  backdropFilter: "blur(26px) saturate(1.7)",
  WebkitBackdropFilter: "blur(26px) saturate(1.7)",
  boxShadow:
    "inset 0 1px 0 light-dark(rgb(255 255 255 / 0.85), rgb(255 255 255 / 0.16)), inset 0 0 0 0.5px light-dark(rgb(255 255 255 / 0.55), rgb(255 255 255 / 0.07)), 0 10px 28px -12px rgb(0 0 0 / 0.34)",
};
const SHEET_STYLE: CSSProperties = { ...GLASS_STYLE, background: "light-dark(rgb(253 252 249 / 0.9), rgb(44 46 52 / 0.9))" };
const GLASS_SOLID = "[@media(prefers-reduced-transparency:reduce)]:bg-popover!";

const Glass = ({ className, children, sheet = false, ...props }: React.ComponentProps<"div"> & { sheet?: boolean }) => (
  <div className={cn(GLASS_SOLID, className)} style={sheet ? SHEET_STYLE : GLASS_STYLE} {...props}>
    {children}
  </div>
);

const GlassButton = ({ icon: IconComponent, label, className }: { icon: Icon; label: string; className?: string }) => (
  <button
    type="button"
    aria-label={label}
    style={GLASS_STYLE}
    className={cn("grid size-11 shrink-0 place-items-center rounded-full text-foreground transition-[scale] duration-(--dur-press) ease-out active:scale-[0.94]", GLASS_SOLID, className)}
  >
    <IconComponent weight="bold" className="size-[1.125rem]" aria-hidden="true" />
  </button>
);

const DEPTH_PRIMARY =
  "border border-(--button-edge) bg-(image:--button) bg-origin-border text-(--button-foreground) shadow-[0_1px_2px_rgb(0_0_0/0.25),0_10px_22px_-10px_rgb(0_0_0/0.5)] transition-[scale,translate] duration-(--dur-press) ease-out active:translate-y-px active:scale-[0.97]";

const StatusBar = () => (
  <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-30 flex h-12 items-end justify-between px-9 pb-1">
    <span className="text-[0.9375rem] font-semibold">9:41</span>
    <span className="absolute top-3 left-1/2 h-[2.125rem] w-[7.5rem] -translate-x-1/2 rounded-full bg-black" />
    <span className="flex items-center gap-1.5">
      <span className="flex items-end gap-[2px]">
        {[4, 6, 8, 10].map((height) => (
          <span key={height} className="w-[3px] rounded-[1px] bg-foreground" style={{ height }} />
        ))}
      </span>
      <span className="relative h-3 w-[1.5rem] rounded-[4px] shadow-[inset_0_0_0_1px] shadow-foreground/45">
        <span className="absolute inset-[2px] right-[5px] rounded-[2px] bg-foreground" />
      </span>
    </span>
  </div>
);

const Phone = ({ label, children }: { label: string; children: ReactNode }) => {
  const frame = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(0.8);
  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const fit = () => setZoom(Math.min(1, node.clientWidth / SCREEN.width));
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    fit();
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={frame} role="group" aria-label={label} className="mx-auto w-full max-w-[24.375rem]">
      <div style={{ zoom }}>
        <div className="relative overflow-hidden rounded-[3rem] bg-background shadow-lift ring-1 ring-foreground/[0.09]" style={SCREEN}>
          <StatusBar />
          {children}
          <span aria-hidden="true" className="pointer-events-none absolute bottom-2 left-1/2 z-30 h-[5px] w-[8.5rem] -translate-x-1/2 rounded-full bg-foreground/85" />
        </div>
      </div>
    </div>
  );
};

const TABS: { label: string; icon: Icon; active?: boolean }[] = [
  { label: "Today", icon: Star },
  { label: "Upcoming", icon: CalendarDots },
  { label: "Lists", icon: Stack },
  { label: "Notes", icon: Notebook, active: true },
];

const TabBar = () => (
  <div className="absolute inset-x-4 bottom-6 z-20 flex items-center gap-2.5">
    <Glass role="navigation" aria-label="Tabs" className="flex h-[3.75rem] flex-1 items-stretch rounded-full p-1">
      {TABS.map((tab) => (
        <button
          key={tab.label}
          type="button"
          aria-current={tab.active ? "page" : undefined}
          className={cn(
            "flex flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[0.625rem] font-medium transition-[scale] duration-(--dur-press) ease-out active:scale-[0.95]",
            tab.active ? "bg-foreground/[0.08] text-brand" : "text-foreground/75",
          )}
        >
          <tab.icon weight="fill" className="size-[1.375rem]" aria-hidden="true" />
          {tab.label}
        </button>
      ))}
    </Glass>
    <GlassButton icon={MagnifyingGlass} label="Search" className="size-[3.75rem]" />
  </div>
);

const GROUP = "overflow-hidden rounded-[1.375rem] bg-surface-inset";
const GROUP_LABEL = "mt-6 mb-2 px-4 text-[0.8125rem] font-medium text-muted-foreground";

const HomeScreen = () => (
  <>
    <div className="absolute inset-0 overflow-y-auto overscroll-contain px-4 pt-[3.75rem] pb-44">
      <div className="flex justify-end">
        <GlassButton icon={DotsThree} label="More" />
      </div>
      <h4 className="mt-1 px-1 text-[2.125rem] leading-10 font-semibold tracking-[-0.03em]">Notes</h4>
      <button type="button" className={cn(GROUP, "mt-4 block w-full p-4 text-left transition-[scale] duration-(--dur-press) ease-out active:scale-[0.985]")}>
        <span className="flex items-center gap-2">
          <CalendarDot weight="fill" className="size-[1.125rem] text-brand" aria-hidden="true" />
          <span className="flex-1 text-[1.0625rem] font-medium">Today</span>
          <span className="text-[0.8125rem] text-muted-foreground">Thu 19 Nov</span>
        </span>
        <span className="mt-1.5 line-clamp-2 text-[0.9375rem] leading-[1.375rem] text-muted-foreground">{excerptOf("day-19")}</span>
        <MonthDots className="mt-3" />
      </button>
      <p className={GROUP_LABEL}>Recent</p>
      <ul className={GROUP}>
        {(["retrieval", "outline", "japan"] as const).map((id, index) => {
          const area = areaOf(id);
          return (
            <li key={id} className={cn(index > 0 && "ml-4 border-t border-border")}>
              <button type="button" className={cn("block w-full py-3 pr-4 text-left transition-colors duration-(--dur-press) active:bg-foreground/[0.05]", index === 0 && "pl-4")}>
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[1.0625rem] font-medium">{NOTES[id].title}</span>
                  {area && <AreaDot colour={area.colour} />}
                </span>
                <span className="mt-0.5 block truncate text-[0.875rem] text-muted-foreground">
                  <span className="text-faint-foreground">{NOTES[id].edited}</span> · {excerptOf(id)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className={GROUP_LABEL}>Areas</p>
      <ul className={GROUP}>
        {(Object.keys(AREAS) as AreaId[]).map((id, index) => (
          <li key={id} className={cn(index > 0 && "ml-4 border-t border-border")}>
            <button type="button" className={cn("flex h-12 w-full items-center gap-3 pr-4 text-left text-[1.0625rem] transition-colors duration-(--dur-press) active:bg-foreground/[0.05]", index === 0 && "pl-4")}>
              <AreaDot colour={AREAS[id].colour} className="size-2.5" />
              <span className="flex-1">{AREAS[id].name}</span>
              <span className="font-mono text-[0.8125rem] text-faint-foreground">{NOTE_IDS.filter((note) => NOTES[note].area === id).length}</span>
              <CaretRight weight="bold" className="size-3 text-faint-foreground" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </div>
    <button type="button" aria-label="New note" className={cn("absolute right-5 bottom-[6.5rem] z-20 grid size-[3.625rem] place-items-center rounded-full", DEPTH_PRIMARY)}>
      <NotePencil weight="fill" className="size-6" aria-hidden="true" />
    </button>
    <TabBar />
  </>
);

const NoteTop = ({ links }: { links?: number }) => (
  <div className="absolute inset-x-4 top-14 z-20 flex items-center justify-between">
    <GlassButton icon={CaretLeft} label="Back to Notes" />
    <Glass className="flex h-11 items-center gap-1 rounded-full px-1.5">
      {links !== undefined && (
        <button type="button" aria-label={`${links} links`} className="flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[0.875rem] font-medium active:bg-foreground/[0.08]">
          <LinkSimple weight="bold" className="size-4" aria-hidden="true" />
          <span className="font-mono">{links}</span>
        </button>
      )}
      <button type="button" aria-label="More" className="grid size-8 place-items-center rounded-full active:bg-foreground/[0.08]">
        <DotsThree weight="bold" className="size-5" aria-hidden="true" />
      </button>
    </Glass>
  </div>
);

const idle = { todoDone: (id: string) => id === "recall" || id === "negatives", onToggleTodo: () => {} };

const NoteHead = ({ id }: { id: NoteId }) => (
  <>
    <h4 className={NOTE_TYPE.reading.title}>{NOTES[id].title}</h4>
    <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.875rem] text-muted-foreground">
      {NOTES[id].labels.map((label) => (
        <LabelPill key={label} name={label} />
      ))}
      <span>{placeOf(id)}</span>
      <LinkDots from={["outline", "dense-sparse", "supervision", "day-19"]} />
    </p>
  </>
);

const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const TOOLS: { label: string; icon: Icon }[] = [
  { label: "To-do", icon: Check },
  { label: "Make Task", icon: ArrowBendUpRight },
  { label: "Heading", icon: TextH },
  { label: "List", icon: ListBullets },
];
const SUGGESTIONS: NoteId[] = ["retrieval", "reading-list"];

const EditorScreen = () => (
  <>
    <NoteTop links={7} />
    <div className="absolute inset-0 overflow-hidden px-6 pt-[7.5rem]">
      <NoteHead id="retrieval" />
      <NoteProse blocks={NOTES.retrieval.blocks.slice(0, 1)} className="mt-5" editor={idle} />
      <p className={cn("mt-4", NOTE_TYPE.reading.body)}>
        The numbers are in <span className="font-mono text-[0.8125em] text-faint-foreground">[[</span>
        <span className="text-brand">re</span>
        <Caret />
      </p>
    </div>
    <div className="absolute inset-x-0 bottom-0 z-20">
      <Glass className="mx-3 rounded-[1.375rem] p-1">
        {SUGGESTIONS.map((id, index) => {
          const area = areaOf(id);
          return (
            <div key={id} className={cn("flex h-11 items-center gap-3 rounded-[1.125rem] px-3 text-[1rem]", index === 0 && "bg-foreground/[0.07]")}>
              <NoteIcon weight="fill" className="size-[1.125rem] shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">
                <span className="font-semibold">{NOTES[id].title.slice(0, 2)}</span>
                {NOTES[id].title.slice(2)}
              </span>
              <span className="flex shrink-0 items-center gap-1.5 text-[0.8125rem] text-faint-foreground">
                {placeOf(id)}
                {area && <AreaDot colour={area.colour} className="size-1.5" />}
              </span>
            </div>
          );
        })}
      </Glass>
      <div className="mx-3 mt-2 flex items-center gap-2">
        <Glass role="toolbar" aria-label="Formatting" className="flex h-12 flex-1 items-center justify-between rounded-full px-2">
          <button type="button" aria-label="Link a note" className="grid h-9 w-11 place-items-center rounded-full bg-foreground/[0.08] font-mono text-[0.9375rem] font-medium text-brand">
            [[
          </button>
          {TOOLS.map((tool) => (
            <button key={tool.label} type="button" aria-label={tool.label} className="grid h-9 w-11 place-items-center rounded-full text-foreground/80 active:bg-foreground/[0.08]">
              <tool.icon weight="bold" className="size-5" aria-hidden="true" />
            </button>
          ))}
        </Glass>
        <button type="button" aria-label="Done" className={cn("grid size-12 shrink-0 place-items-center rounded-full", DEPTH_PRIMARY)}>
          <Check weight="bold" className="size-5" aria-hidden="true" />
        </button>
      </div>
      <div aria-hidden="true" className="mt-2 space-y-2.5 rounded-t-[1.75rem] bg-foreground/[0.07] px-1.5 pt-3 pb-9">
        {KEY_ROWS.map((row, index) => (
          <div key={row} className={cn("flex justify-center gap-1.5", index === 1 && "px-5", index === 2 && "px-14")}>
            {[...row].map((key) => (
              <span key={key} className="grid h-[2.625rem] flex-1 place-items-center rounded-[0.5rem] bg-popover text-[1.25rem] shadow-[0_1px_0_rgb(0_0_0/0.18)]">
                {key}
              </span>
            ))}
          </div>
        ))}
        <div className="flex gap-1.5">
          <span className="grid h-[2.625rem] w-24 place-items-center rounded-[0.5rem] bg-foreground/[0.1] text-[0.9375rem]">123</span>
          <span className="grid h-[2.625rem] flex-1 place-items-center rounded-[0.5rem] bg-popover text-[0.9375rem] text-muted-foreground shadow-[0_1px_0_rgb(0_0_0/0.18)]">space</span>
          <span className="grid h-[2.625rem] w-24 place-items-center rounded-[0.5rem] bg-foreground/[0.1] text-[0.9375rem]">return</span>
        </div>
      </div>
    </div>
  </>
);

type LinksTab = "from" | "out" | "graph";

const LinksScreen = () => {
  const [tab, setTab] = useState<LinksTab>("from");
  return (
    <>
      <div aria-hidden="true" inert className="absolute inset-0 px-6 pt-[7.5rem]">
        <NoteHead id="retrieval" />
        <NoteProse blocks={NOTES.retrieval.blocks.slice(0, 2)} className="mt-5" editor={idle} />
      </div>
      <div aria-hidden="true" className="absolute inset-0 bg-black/20 dark:bg-black/45" />
      <Glass sheet role="dialog" aria-label="Links" className="absolute inset-x-2 top-[14.5rem] bottom-2 z-20 flex flex-col rounded-[2.5rem]">
        <span aria-hidden="true" className="mx-auto mt-2 h-[5px] w-9 shrink-0 rounded-full bg-foreground/20" />
        <div className="flex items-center justify-between pt-2 pr-3 pl-6">
          <h4 className="text-[1.0625rem] font-semibold">Links</h4>
          <button type="button" aria-label="Close links" className="grid size-8 place-items-center rounded-full bg-foreground/[0.08] transition-[scale] duration-(--dur-press) ease-out active:scale-[0.94]">
            <X weight="bold" className="size-3.5" aria-hidden="true" />
          </button>
        </div>
        <div className="px-4 pt-3">
          <Segmented
            label="Which links"
            size="md"
            className="w-full [&>*]:flex-1"
            value={tab}
            onValueChange={setTab}
            options={[
              { value: "from", label: "Linked from" },
              { value: "out", label: "Links out" },
              { value: "graph", label: "Graph" },
            ]}
          />
        </div>
        <div key={tab} className="min-h-0 flex-1 animate-fade-in overflow-y-auto overscroll-contain px-3 pt-3 pb-8">
          {tab === "from" && <Backlinks id="retrieval" />}
          {tab === "out" && <OutgoingLinks id="retrieval" />}
          {tab === "graph" && <LocalGraph id="retrieval" className="mt-4" />}
        </div>
      </Glass>
    </>
  );
};

const NotebookScreen = () => {
  const [selected, setSelected] = useState<NoteId>("day-19");
  return (
    <>
      <NoteTop />
      <div className="absolute inset-0 overflow-y-auto overscroll-contain px-5 pt-[7.25rem] pb-32">
        <WeekStrip selected={selected} onSelect={setSelected} />
        <h4 className={cn("mt-5 flex flex-wrap items-baseline gap-x-2.5 px-1", NOTE_TYPE.compact.title)}>
          {NOTES[selected].title}
          {selected === "day-19" && <span className="text-[0.875rem] font-normal tracking-normal text-brand">Today</span>}
        </h4>
        <NoteProse blocks={NOTES[selected].blocks.slice(0, 1)} className="mt-3 px-1" editor={idle} />
        <section aria-label="From the notebook" className="mt-5 overflow-hidden rounded-[1.375rem] bg-surface-inset">
          <div className="bg-[radial-gradient(circle,color-mix(in_oklab,var(--foreground)_11%,transparent)_1px,transparent_1.5px)] bg-[size:16px_16px] px-4 pt-3.5 pb-4">
            <p className="flex items-center gap-2 text-[0.875rem] font-medium text-muted-foreground">
              <BookOpen weight="fill" className="size-[1.125rem]" aria-hidden="true" />
              <span className="flex-1">From the notebook</span>
              <Tag className="h-6 bg-foreground/[0.06] text-[0.8125rem]">p. 43</Tag>
            </p>
            <ul className="mt-2.5 space-y-2 text-[1.0625rem] leading-6">
              <li className="flex items-start gap-3">
                <span aria-hidden="true" className="mt-[0.5625rem] size-[5px] shrink-0 rounded-full bg-foreground/35" />
                Reading group moves to Fridays
              </li>
              <li className="flex items-start gap-3">
                <span aria-hidden="true" className="mt-[3px] -ml-[6.5px] size-[18px] shrink-0 rounded-[6px] shadow-[inset_0_0_0_1.5px] shadow-foreground/30" />
                <span className="-ml-[6.5px] min-w-0 flex-1">Email Dr Nguyen the small-index numbers</span>
                <span className="rounded-full bg-(image:--button-secondary) px-2 text-[0.75rem] leading-6 font-medium text-muted-foreground">Task</span>
              </li>
              <li className="flex items-start gap-3">
                <span aria-hidden="true" className="mt-[0.5625rem] size-[5px] shrink-0 rounded-full bg-foreground/35" />
                <span>
                  Walked home the long way
                  <Caret />
                </span>
              </li>
            </ul>
          </div>
        </section>
      </div>
      <div className="absolute inset-x-4 bottom-7 z-20">
        <button type="button" className={cn("flex h-14 w-full items-center justify-center gap-2 rounded-full text-[1.0625rem] font-medium", DEPTH_PRIMARY)}>
          Add page
          <ArrowRight weight="bold" className="size-[1.125rem]" aria-hidden="true" />
        </button>
      </div>
    </>
  );
};

const SCREENS = [
  { name: "Notes home", note: "A fifth tab. Today’s note first, then recent notes and the Areas, in grouped lists. The depth button starts a note.", label: "iPhone, Notes home", screen: <HomeScreen /> },
  { name: "Writing", note: "A glass bar above the keyboard holds the brackets, the to-do, Make Task and headings. Suggestions float just above it.", label: "iPhone, writing a note", screen: <EditorScreen /> },
  { name: "Links", note: "Links live in a glass sheet you pull up. Linked from, Links out and the small graph share one switch.", label: "iPhone, links sheet", screen: <LinksScreen /> },
  { name: "From the notebook", note: "The daily note with the week on top. Lines go in one after another, the page number stays in view, and one big button finishes the page.", label: "iPhone, typing in a notebook page", screen: <NotebookScreen /> },
];

export const PhoneSpecimens = () => (
  <>
    {SCREENS.map((item) => (
      <Specimen key={item.name} name={item.name} note={item.note} className="md:col-span-3 xl:col-span-3" stage="bg-surface p-3 sm:p-3">
        <Phone label={item.label}>{item.screen}</Phone>
      </Specimen>
    ))}
  </>
);
