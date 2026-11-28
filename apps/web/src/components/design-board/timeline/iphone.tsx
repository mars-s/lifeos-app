"use client";

import { CalendarDots, ListBullets, MagnifyingGlass, Notebook, Plus, Rows, Stack, Star, type Icon } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { EnergySpark } from "./energy";
import { at, capacityOf, clock, energyModeOf, loadOf, span, type Day } from "./model";
import { CapacityRing, DayTimeline, DayTrack, HatchSwatch, LoadDots, NowLine, Rail, useDayFacts, useEntries, useWorld } from "./parts";
import { NOW, TODAY_INDEX, WEEK } from "./sample";

const SCREEN = { width: 390, height: 800 } as const;

const GLASS_STYLE: CSSProperties = {
  background: "light-dark(rgb(255 255 255 / 0.72), rgb(64 66 74 / 0.66))",
  backdropFilter: "blur(26px) saturate(1.7)",
  WebkitBackdropFilter: "blur(26px) saturate(1.7)",
  boxShadow:
    "inset 0 1px 0 light-dark(rgb(255 255 255 / 0.85), rgb(255 255 255 / 0.16)), inset 0 0 0 0.5px light-dark(rgb(255 255 255 / 0.55), rgb(255 255 255 / 0.07)), 0 10px 28px -12px rgb(0 0 0 / 0.34)",
};
const GLASS_SOLID = "[@media(prefers-reduced-transparency:reduce)]:bg-popover!";
const PRESS = "touch-manipulation transition-[scale] duration-(--dur-press) ease-out active:scale-[0.94] outline-none focus-visible:ring-2 focus-visible:ring-ring";
const DEPTH_PRIMARY =
  "border border-(--button-edge) bg-(image:--button) bg-origin-border text-(--button-foreground) shadow-[0_1px_2px_rgb(0_0_0/0.25),0_10px_22px_-10px_rgb(0_0_0/0.5)]";

const GlassButton = ({ icon: IconComponent, label, className }: { icon: Icon; label: string; className?: string }) => (
  <button type="button" aria-label={label} style={GLASS_STYLE} className={cn("grid size-11 shrink-0 place-items-center rounded-full text-foreground", PRESS, GLASS_SOLID, className)}>
    <IconComponent weight="bold" className="size-[1.125rem]" aria-hidden="true" />
  </button>
);

const StatusBar = () => (
  <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-30 flex h-12 items-end justify-between px-9 pb-1">
    <span className="text-[0.9375rem] font-semibold">{clock(NOW, true)}</span>
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
        <div className="relative overflow-hidden rounded-[3rem] bg-background shadow-lift ring-1 ring-foreground/[0.09] [--tl-ground:var(--background)]" style={SCREEN}>
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

const Bars = () => (
  <>
    <button type="button" aria-label="New Task" className={cn("absolute right-4 bottom-[6.25rem] z-20 grid size-[3.25rem] place-items-center rounded-full", DEPTH_PRIMARY, PRESS)}>
      <Plus weight="bold" className="size-5" aria-hidden="true" />
    </button>
    <div className="absolute inset-x-4 bottom-6 z-20 flex items-center gap-2.5">
      <div role="navigation" aria-label="Tabs" style={GLASS_STYLE} className={cn("flex h-[3.75rem] flex-1 items-stretch rounded-full p-1", GLASS_SOLID)}>
        {TABS.map((tab) => (
          <button
            key={tab.label}
            type="button"
            aria-current={tab.active ? "page" : undefined}
            className={cn("flex flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[0.625rem] font-medium", PRESS, tab.active ? "bg-foreground/[0.08] text-brand" : "text-foreground/75")}
          >
            <tab.icon weight="fill" className="size-[1.375rem]" aria-hidden="true" />
            {tab.label}
          </button>
        ))}
      </div>
      <GlassButton icon={MagnifyingGlass} label="Search" className="size-[3.75rem]" />
    </div>
  </>
);

const nowFor = (index: number) => (index < TODAY_INDEX ? Number.POSITIVE_INFINITY : index === TODAY_INDEX ? NOW : Number.NEGATIVE_INFINITY);

const StripDay = ({ day, index, selected, detail }: { day: Day; index: number; selected: number | undefined; detail: boolean }) => {
  const entries = useEntries(day);
  const load = loadOf(entries);
  const today = index === TODAY_INDEX;
  const planned = load.done + load.kept + load.predicted;
  return (
    <button
      type="button"
      aria-current={index === selected ? "date" : undefined}
      aria-label={`${day.weekday} ${day.number}, ${span(planned)} planned of ${span(capacityOf(day))}`}
      className={cn("flex min-w-0 flex-col items-center gap-1 rounded-xl py-1", PRESS)}
    >
      <span className={cn("text-[0.625rem] leading-none font-medium", today ? "text-brand" : "text-faint-foreground")}>{day.weekday.slice(0, 1)}</span>
      <span
        className={cn(
          "grid size-7 place-items-center rounded-full text-[0.9375rem] leading-none font-semibold",
          index === selected ? "bg-foreground text-background" : today ? "text-brand" : index < TODAY_INDEX ? "text-muted-foreground" : "",
        )}
      >
        {day.number}
      </span>
      <LoadDots load={index < TODAY_INDEX ? { done: planned, kept: 0, predicted: 0 } : load} capacity={capacityOf(day)} unit={90} className="h-1 flex-nowrap" />
      {detail && <span className="font-mono text-[0.5625rem] leading-none text-muted-foreground">{planned ? span(planned) : "Free"}</span>}
      {detail && <EnergySpark quality={day.energy} mode={energyModeOf(nowFor(index))} now={NOW} className="mt-0.5 h-2.5 px-1" />}
    </button>
  );
};

const WeekStrip = ({ selected, detail = false, className }: { selected?: number; detail?: boolean; className?: string }) => (
  <div role="group" aria-label="This week" className={cn("grid grid-cols-7", className)}>
    {WEEK.map((day, index) => (
      <StripDay key={day.date} day={day} index={index} selected={selected} detail={detail} />
    ))}
  </div>
);

const Header = ({ day, title, sub, toggle, toggleLabel, children }: { day: Day; title: string; sub: string; toggle: Icon; toggleLabel: string; children: ReactNode }) => {
  const facts = useDayFacts(day);
  return (
    <header className="absolute inset-x-0 top-0 z-20 bg-background/85 pt-12 backdrop-blur-xl [@media(prefers-reduced-transparency:reduce)]:bg-background">
      <div className="flex h-[3.25rem] items-center gap-2.5 pr-4 pl-5">
        <h4 className="text-[1.5rem] leading-none font-semibold tracking-[-0.02em]">{title}</h4>
        <span className="mt-1 text-small text-muted-foreground">{sub}</span>
        <GlassButton icon={toggle} label={toggleLabel} className="ml-auto size-9" />
        <CapacityRing load={facts.load} capacity={facts.capacity} />
      </div>
      {children}
    </header>
  );
};

const OPEN_AT = 104;
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const RELATIVE: Record<number, string> = { [-1]: "Yesterday", 0: "Today", 1: "Tomorrow" };

const Summary = ({ day, index }: { day: Day; index: number }) => {
  const { entries, predicted } = useDayFacts(day);
  const { keep } = useWorld();
  const blocks = entries.filter((entry) => entry.kind === "block");
  const done = blocks.filter((entry) => entry.done).length;
  const minutes = predicted.reduce((sum, entry) => sum + entry.minutes, 0);
  if (index < TODAY_INDEX) {
    const missed = blocks.length - done;
    return (
      <p className="flex h-8 items-center gap-2 px-5 text-[0.75rem] text-muted-foreground">
        {done} done{missed > 0 && `, ${missed} not done`}
        {missed > 0 && (
          <button type="button" className={cn("ml-auto rounded-full px-2 py-1 font-medium text-foreground", PRESS)}>
            Move to today
          </button>
        )}
      </p>
    );
  }
  return (
    <p className="flex h-8 items-center gap-2 px-5 text-[0.75rem] text-muted-foreground">
      {predicted.length > 0 ? (
        <>
          <HatchSwatch />
          <span>
            {predicted.length} predicted{index === TODAY_INDEX && " later"}, <span className="font-mono">{span(minutes)}</span>
          </span>
          <button type="button" onClick={() => keep(predicted.map((entry) => entry.id))} className={cn("ml-auto rounded-full px-2 py-1 font-medium text-foreground", PRESS)}>
            Keep all
          </button>
        </>
      ) : (
        "Every block is kept"
      )}
    </p>
  );
};

export const PhoneDay = ({ index }: { index: number }) => {
  const day = WEEK[index];
  if (!day) return null;
  const title = RELATIVE[index - TODAY_INDEX] ?? DAY_NAMES[index] ?? day.weekday;
  return (
    <Phone label={`iPhone day view, ${title.toLowerCase()}`}>
      <div
        ref={(node) => {
          if (node && index === TODAY_INDEX) node.scrollTop = OPEN_AT;
        }}
        className="absolute inset-0 overflow-y-auto overscroll-contain pt-[12.25rem] pb-28 [scrollbar-width:none]"
        tabIndex={0}
        role="region"
        aria-label={`${title} timeline`}
      >
        <DayTimeline day={day} from={at(8)} to={at(23)} scale={1.1} gutter={88} lane={26} now={nowFor(index)} className="mr-4" />
      </div>
      <Header day={day} title={title} sub={`${day.weekday} ${day.number} Nov`} toggle={ListBullets} toggleLabel="Show as a list">
        <WeekStrip selected={index} className="px-3" />
        <Summary day={day} index={index} />
      </Header>
      <Bars />
    </Phone>
  );
};

const WeekColumn = ({ day, index, from, to, scale }: { day: Day; index: number; from: number; to: number; scale: number }) => {
  const entries = useEntries(day);
  const now = nowFor(index);
  return (
    <div className={cn("rounded-md", index === TODAY_INDEX && "bg-foreground/[0.045]")}>
      <DayTrack entries={entries} from={from} to={to} scale={scale} density="mini" now={now} className="mx-[2px]">
        {index === TODAY_INDEX && <NowLine from={from} scale={scale} now={now} />}
      </DayTrack>
    </div>
  );
};

const KEY = [
  { look: "done", name: "Past" },
  { look: "kept", name: "Kept" },
  { look: "predicted", name: "Predicted" },
  { look: "commitment", name: "Calendar" },
] as const;

export const PhoneWeek = () => {
  const from = at(8);
  const to = at(17, 30);
  const scale = 0.8;
  const gutter = 64;
  return (
    <Phone label="iPhone week view">
      <div className="absolute inset-0 overflow-y-auto overscroll-contain pt-[12.75rem] pb-28 [scrollbar-width:none]" tabIndex={0} role="region" aria-label="Week timeline">
        <div className="relative mr-3" style={{ paddingLeft: gutter }}>
          <Rail from={from} to={to} scale={scale} now={NOW} gutter={gutter} compact lane={14} energy={WEEK[TODAY_INDEX]?.energy ?? 1} />
          <div className="grid grid-cols-7">
            {WEEK.map((day, index) => (
              <WeekColumn key={day.date} day={day} index={index} from={from} to={to} scale={scale} />
            ))}
          </div>
        </div>
        <ul className="mt-4 flex gap-3.5 pl-16 text-[0.6875rem] text-muted-foreground">
          {KEY.map((item) => (
            <li key={item.name} className="flex items-center gap-1.5">
              <span aria-hidden="true" data-look={item.look} className="tl-block size-3 rounded-[3px]" style={{ "--a": "var(--area-violet)" } as CSSProperties} />
              {item.name}
            </li>
          ))}
        </ul>
      </div>
      <Header day={WEEK[TODAY_INDEX] as Day} title="Week" sub="23 to 29 Nov" toggle={Rows} toggleLabel="Show one day">
        <WeekStrip selected={TODAY_INDEX} detail className="pr-3 pl-16" />
      </Header>
      <Bars />
    </Phone>
  );
};
