"use client";

import { CalendarDots, CaretLeft, DotsThree, MagnifyingGlass, Notebook, PushPin, Stack, Star, type Icon } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AiMark } from "@/components/lifeos/ai-mark";
import { AreaDot } from "@/components/lifeos/area";
import { formatMinutes } from "@/components/lifeos/format";
import { cn } from "@/lib/utils";
import { NOTE_TYPE } from "../notes/prose";
import { Specimen } from "../specimen";
import { Decision } from "./agent";
import { Ink, MarginBar, ModelTag, PencilChip } from "./parts";
import { MEETING, MEMORIES, MEMORY_GROUPS, NOTE_DRAFTS, NOTE_VERBS, RUN_ASK, RUN_OPTIONS } from "./sample";

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

const Phone = ({ label, note, children }: { label: string; note: string; children: ReactNode }) => {
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
    <div ref={frame} role="img" aria-label={`${label}, a picture of the iPhone screen. ${note}`} className="mx-auto w-full max-w-[24.375rem]">
      <div style={{ zoom }} inert>
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
  { label: "Today", icon: Star, active: true },
  { label: "Upcoming", icon: CalendarDots },
  { label: "Lists", icon: Stack },
  { label: "Notes", icon: Notebook },
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

const NoteTop = () => (
  <div className="absolute inset-x-4 top-14 z-20 flex items-center justify-between">
    <GlassButton icon={CaretLeft} label="Back to Notes" />
    <GlassButton icon={DotsThree} label="More" />
  </div>
);

const roughText = MEETING.rough.map((part) => (typeof part === "string" ? part : part.text)).join("");

const Grabber = () => <span aria-hidden="true" className="mx-auto mt-2 block h-[5px] w-9 rounded-full bg-foreground/20" />;

const AskScreen = () => (
  <>
    <NoteTop />
    <div className={cn("absolute inset-0 overflow-hidden px-6 pt-[7.5rem]", NOTE_TYPE.reading.body)}>
      <h4 className={cn(NOTE_TYPE.reading.title, "opacity-35")}>{MEETING.title}</h4>
      <p className="mt-4 text-pretty opacity-35">{MEETING.opening}</p>
      <div className="relative mt-4">
        <MarginBar tone="lit" className="-left-3" />
        <p className="-mx-1.5 rounded-lg bg-foreground/[0.045] px-1.5 text-pretty">{roughText}</p>
      </div>
    </div>
    <Glass sheet className="absolute inset-x-2 bottom-2 z-20 rounded-[2.25rem] px-2 pb-7">
      <Grabber />
      <div className="mt-2 flex h-12 items-center gap-3 px-3">
        <AiMark weight="bold" className="size-5 text-foreground/70" aria-hidden="true" />
        <span className="flex-1 text-[1.0625rem] text-faint-foreground">Ask, or pick below…</span>
      </div>
      <ul aria-label="What to do">
        {NOTE_VERBS.map((verb, index) => (
          <li key={verb.id}>
            <button type="button" className={cn("flex h-12 w-full items-center gap-3.5 rounded-[1.125rem] px-3 text-left text-[1.0625rem] transition-colors duration-(--dur-press) active:bg-foreground/[0.08]", index === 0 && "bg-foreground/[0.06]")}>
              <verb.icon weight="bold" className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{verb.label}</span>
              <span className="text-[0.8125rem] text-faint-foreground">{verb.found}</span>
            </button>
          </li>
        ))}
      </ul>
    </Glass>
  </>
);

const DraftScreen = () => (
  <>
    <NoteTop />
    <div className={cn("absolute inset-0 overflow-hidden px-6 pt-[7.5rem]", NOTE_TYPE.reading.body)}>
      <h4 className={cn(NOTE_TYPE.reading.title, "opacity-35")}>{MEETING.title}</h4>
      <p className="mt-4 text-pretty opacity-35">{MEETING.opening}</p>
      <div className="relative mt-4">
        <MarginBar tone="lit" className="-left-3" />
        <p className="-mx-1.5 rounded-lg bg-foreground/[0.045] px-1.5 text-pretty text-foreground/45 line-through decoration-foreground/25">{roughText}</p>
        <p className="mt-2 text-pretty">
          <Ink pencil>{NOTE_DRAFTS.tidy}</Ink>
        </p>
      </div>
    </div>
    <div className="absolute inset-x-4 bottom-8 z-20">
      <p className="mb-2.5 flex items-center justify-center">
        <ModelTag />
      </p>
      <div className="flex items-center gap-2.5">
        <Glass className="flex h-[3.25rem] flex-1 items-stretch rounded-full p-1">
          <button type="button" className="flex-1 rounded-full text-[1rem] font-medium transition-[scale] duration-(--dur-press) ease-out active:scale-[0.95]">
            Discard
          </button>
          <button type="button" className="flex-1 rounded-full text-[1rem] font-medium transition-[scale] duration-(--dur-press) ease-out active:scale-[0.95]">
            Try again
          </button>
        </Glass>
        <button type="button" className={cn("h-[3.25rem] rounded-full px-7 text-[1.0625rem] font-semibold", DEPTH_PRIMARY)}>
          Replace
        </button>
      </div>
    </div>
  </>
);

const TODAY: { title: string; area: string; colour: "violet" | "teal" | "orange"; estimate: number }[] = [
  { title: "Draft the thesis outline", area: "Honours thesis", colour: "violet", estimate: 90 },
  { title: "Rerun the hybrid on the small index", area: "Honours thesis", colour: "violet", estimate: 90 },
  { title: "Review the onboarding copy", area: "Korvant", colour: "teal", estimate: 45 },
];

const TodayList = () => (
  <>
    <h4 className="px-1 text-[2.125rem] leading-10 font-semibold tracking-[-0.03em]">Today</h4>
    <ul className="mt-3">
      {TODAY.map((task) => (
        <li key={task.title} className="flex items-start gap-3 px-1 py-2.5">
          <span aria-hidden="true" className="mt-0.5 size-[1.375rem] shrink-0 rounded-[7px] border-[1.5px] border-foreground/30" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[1.0625rem]">{task.title}</span>
            <span className="flex items-center gap-1.5 text-[0.875rem] text-muted-foreground">
              <AreaDot colour={task.colour} />
              {task.area}
            </span>
          </span>
          <PencilChip pencil={false}>{formatMinutes(task.estimate)}</PencilChip>
        </li>
      ))}
    </ul>
  </>
);

const RunScreen = () => (
  <>
    <div className="absolute inset-0 overflow-hidden px-4 pt-[4.25rem] opacity-45">
      <TodayList />
    </div>
    <Glass sheet className="absolute inset-x-2 bottom-2 z-20 rounded-[2.25rem] px-4 pb-8">
      <Grabber />
      <p className="mt-3 flex items-center gap-2 text-[0.8125rem] font-medium text-brand">
        <span aria-hidden="true" className="size-2 rounded-full bg-brand" />
        Needs you
      </p>
      <h4 className="mt-0.5 text-[1.25rem] leading-7 font-semibold tracking-[-0.015em]">{RUN_ASK}</h4>
      <div className="mt-3">
        <Decision part={{ kind: "decision", ask: "Two ways to make room", options: RUN_OPTIONS, advised: "move", chosen: undefined }} onChoose={() => undefined} />
      </div>
    </Glass>
  </>
);

const GROUP = "overflow-hidden rounded-[1.375rem] bg-surface-inset";
const GROUP_LABEL = "mt-6 mb-2 px-4 text-[0.8125rem] font-medium text-muted-foreground";

const MemoryList = ({ title, rows }: { title: string; rows: typeof MEMORIES }) => (
  <>
    <p className={GROUP_LABEL}>{title}</p>
    <ul className={GROUP}>
      {rows.map((memory, index) => (
        <li key={memory.id} className={cn("flex items-start gap-3 py-3 pr-4", index === 0 ? "pl-4" : "ml-4 border-t border-border")}>
          <span className="min-w-0 flex-1">
            <span className="block text-[1rem] leading-[1.375rem] text-pretty">{memory.text}</span>
            <span className="mt-0.5 block text-[0.8125rem] text-faint-foreground">{memory.from}</span>
          </span>
          {memory.pinned && <PushPin weight="fill" className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
        </li>
      ))}
    </ul>
  </>
);

const MemoryScreen = () => (
  <>
    <div className="absolute inset-x-4 top-14 z-20 flex items-center justify-between">
      <GlassButton icon={CaretLeft} label="Back to Settings" />
      <GlassButton icon={MagnifyingGlass} label="Search memory" />
    </div>
    <div className="absolute inset-0 overflow-y-auto overscroll-contain px-4 pt-[7.25rem] pb-16">
      <h4 className="px-1 text-[2.125rem] leading-10 font-semibold tracking-[-0.03em]">Memory</h4>
      <MemoryList title="New this week" rows={MEMORIES.filter((memory) => memory.fresh)} />
      <MemoryList title="Pinned, always used" rows={MEMORIES.filter((memory) => memory.pinned)} />
      <MemoryList title={MEMORY_GROUPS.work} rows={MEMORIES.filter((memory) => !memory.fresh && !memory.pinned && memory.group === "work")} />
      <MemoryList title={MEMORY_GROUPS.people} rows={MEMORIES.filter((memory) => memory.group === "people")} />
    </div>
  </>
);

const RunStripScreen = () => (
  <>
    <div className="absolute inset-0 overflow-hidden px-4 pt-[4.25rem]">
      <TodayList />
    </div>
    <Glass className="absolute inset-x-4 bottom-[6.25rem] z-20 flex h-[3.25rem] items-center gap-3 rounded-full pr-1.5 pl-4">
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-brand" />
      <span className="min-w-0 flex-1 truncate text-[0.9375rem] font-medium">Needs you: pick one</span>
      <span aria-hidden="true" className="flex items-center gap-[3px]">
        {["bg-foreground/65", "bg-foreground/65", "bg-brand", "bg-foreground/[0.14]", "bg-foreground/[0.14]"].map((tone, index) => (
          <span key={index} className={cn("size-1.5 rounded-full", tone)} />
        ))}
      </span>
      <button type="button" className="h-10 rounded-full bg-foreground/[0.08] px-4 text-[0.9375rem] font-medium transition-[scale] duration-(--dur-press) ease-out active:scale-[0.95]">
        Open
      </button>
    </Glass>
    <TabBar />
  </>
);

const PHONES: { name: string; note: string; screen: ReactNode }[] = [
  { name: "Ask sheet", note: "No Cmd+J on a phone. Select text, or press the AI mark in the bar above the keyboard, and the same list comes up as a sheet.", screen: <AskScreen /> },
  { name: "Draft bar", note: "The same pencil under the same line. One depth button does the main thing. The quiet pair sits in glass beside it.", screen: <DraftScreen /> },
  { name: "Run strip", note: "A run rides above the tab bar, like a track that is playing. It stays as you move between tabs.", screen: <RunStripScreen /> },
  { name: "Decision sheet", note: "Open the strip and the run comes up as a sheet. The decision card is the same part the Mac draws.", screen: <RunScreen /> },
  { name: "Memory list", note: "A grouped list in Settings, AI. New ones on top, pinned ones next. Swipe a row to pin it or forget it.", screen: <MemoryScreen /> },
];

export const PhoneSpecimens = () => (
  <>
    {PHONES.map((phone, index) => (
      <Specimen key={phone.name} name={phone.name} note={phone.note} className={cn("md:col-span-3 xl:col-span-4", index >= 3 && "xl:col-span-6")} stage="bg-surface px-3 py-6 sm:px-5">
        <Phone label={phone.name} note={phone.note}>
          {phone.screen}
        </Phone>
      </Specimen>
    ))}
  </>
);
