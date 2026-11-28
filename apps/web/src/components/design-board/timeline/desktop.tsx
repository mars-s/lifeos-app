"use client";

import { Archive, CaretLeft, CaretRight, CheckSquare, SquaresFour, Stack, Star, Tray, type Icon } from "@phosphor-icons/react";
import { useState, type CSSProperties } from "react";
import { AreaDot } from "@/components/lifeos/area";
import { Button, IconButton } from "@/components/ui/action-button";
import { KeyCombo } from "@/components/ui/key-hint";
import { Segmented } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";
import { Fit } from "../widgets/parts";
import { EnergySpark } from "./energy";
import { at, clock, energyModeOf, lookOf, span, visibleAt, type Day } from "./model";
import { DayTimeline, DayTrack, HatchSwatch, LoadDots, NowLine, Rail, useDayFacts, useEntries, useWorld } from "./parts";
import { AREAS, BRAIN_DUMP, NOW, TODAY_INDEX, WEEK } from "./sample";

type Mode = "day" | "week";

const NAV: { label: string; icon: Icon; count?: number; active?: boolean }[] = [
  { label: "Inbox", icon: Tray, count: 4 },
  { label: "Today", icon: Star, count: 8 },
  { label: "Planner", icon: SquaresFour, active: true },
  { label: "Anytime", icon: Stack },
  { label: "Someday", icon: Archive },
  { label: "Logbook", icon: CheckSquare },
];

const nowFor = (index: number) => (index < TODAY_INDEX ? Number.POSITIVE_INFINITY : index === TODAY_INDEX ? NOW : Number.NEGATIVE_INFINITY);

const Sidebar = () => (
  <div className="flex w-44 shrink-0 flex-col gap-0.5 px-2 pt-12 text-small">
    {NAV.map((item) => (
      <span key={item.label} className={cn("flex h-8 items-center gap-2.5 rounded-lg px-2.5", item.active && "bg-foreground/[0.07] font-medium")}>
        <item.icon weight="fill" aria-hidden="true" className={cn("size-4", item.active ? "text-brand" : "text-muted-foreground")} />
        {item.label}
        {item.count && <span className="ml-auto font-mono text-micro text-faint-foreground">{item.count}</span>}
      </span>
    ))}
    <span className="mt-4" />
    {Object.values(AREAS).map((area) => (
      <span key={area.name} className="flex h-8 items-center gap-3 px-3">
        <AreaDot colour={area.colour} />
        {area.name}
      </span>
    ))}
  </div>
);

const CARD = "rounded-xl bg-surface px-3 py-2.5";
const BOX = "mt-0.5 size-4 shrink-0 rounded-[5px] shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--foreground)_22%,transparent)]";
const CHIP = "rounded-md bg-foreground/[0.06] px-1.5 font-mono text-micro leading-5 text-muted-foreground";

const BrainDump = () => (
  <section aria-label="Brain Dump" className="w-52 shrink-0">
    <h4 className="flex h-9 items-baseline gap-2 px-1 text-heading font-semibold">
      Brain Dump <span className="font-mono text-micro font-normal text-faint-foreground">{BRAIN_DUMP.length}</span>
    </h4>
    <ul className="mt-[3.25rem] space-y-1.5">
      {BRAIN_DUMP.map((title) => (
        <li key={title} className={cn(CARD, "flex gap-2.5 text-small")}>
          <span aria-hidden="true" className={BOX} />
          <span className="line-clamp-2">{title}</span>
        </li>
      ))}
    </ul>
  </section>
);

const DayHeader = ({ day, index, compact = false }: { day: Day; index: number; compact?: boolean }) => {
  const { load, capacity } = useDayFacts(day);
  const planned = load.done + load.kept + load.predicted;
  const today = index === TODAY_INDEX;
  return (
    <div className={cn("px-1", compact ? "pb-2" : "pb-3")}>
      <h4 className={cn("flex items-baseline gap-1.5", compact ? "h-7 text-small" : "h-9 text-heading")}>
        <span className="font-semibold">{day.weekday}</span>
        <span className={cn(today && compact ? "font-semibold text-brand" : "text-muted-foreground")}>
          {day.number}
          {!compact && " Nov"}
        </span>
        {today && !compact && <span className="text-small text-brand">Today</span>}
      </h4>
      <LoadDots load={index < TODAY_INDEX ? { done: planned, kept: 0, predicted: 0 } : load} capacity={capacity} unit={compact ? 30 : 15} dot={compact ? 4 : 5} className={compact ? "flex-nowrap" : undefined} />
      <p className={cn("mt-1.5 text-micro text-muted-foreground", compact && "truncate")}>
        <span className="font-mono text-foreground">{span(Math.max(0, capacity - planned))}</span> left{!compact && " of "}
        {!compact && <span className="font-mono">{span(capacity)}</span>}
        {!compact && " free"}
      </p>
      {compact && <EnergySpark quality={day.energy} mode={energyModeOf(nowFor(index))} now={NOW} className="mt-1.5 pr-2" />}
    </div>
  );
};

const DayList = ({ index }: { index: number }) => {
  const day = WEEK[index];
  const entries = useEntries(day ?? { date: "", weekday: "", number: 0, energy: 1, entries: [] });
  if (!day) return null;
  const now = nowFor(index);
  return (
    <section aria-label={`${day.weekday} ${day.number} November`} className="w-60 shrink-0">
      <DayHeader day={day} index={index} />
      <ul className="space-y-1.5">
        {entries.flatMap((entry) =>
          entry.kind === "block" ? (
            <li key={entry.id} className={cn(CARD, entry.done && "opacity-55")}>
              <div className="flex gap-2.5 text-small">
                <span aria-hidden="true" className={cn(BOX, entry.done && "bg-foreground/50 shadow-none")} />
                <span className={cn("line-clamp-2 min-w-0 flex-1", entry.done && "line-through")}>{entry.title}</span>
                <span className={CHIP}>
                  {entry.guess && "~"}
                  {span(entry.minutes)}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-1.5 pl-[1.625rem] text-micro text-muted-foreground">
                <AreaDot colour={AREAS[entry.area].colour} className="size-1.5" />
                {AREAS[entry.area].name}
                {visibleAt(entry, now) && (
                  <span className="ml-auto flex items-center gap-1.5 font-mono">
                    <span aria-hidden="true" data-look={lookOf(entry, now)} className="tl-block size-2.5 rounded-[3px]" style={{ "--a": `var(--area-${AREAS[entry.area].colour})` } as CSSProperties} />
                    {clock(entry.start)}
                  </span>
                )}
              </div>
            </li>
          ) : (
            []
          ),
        )}
      </ul>
    </section>
  );
};

const PaneBar = ({ title, mode, onMode }: { title: string; mode: Mode; onMode: (mode: Mode) => void }) => (
  <div className="flex h-9 items-center gap-1">
    <h4 className="mr-auto px-1 text-heading font-semibold whitespace-nowrap">{title}</h4>
    <IconButton variant="quiet" size="sm" label="Earlier" icon={CaretLeft} />
    <IconButton variant="quiet" size="sm" label="Later" icon={CaretRight} />
    <Segmented
      label="Timeline range"
      size="sm"
      className="ml-1"
      value={mode}
      onValueChange={onMode}
      options={[
        { value: "day", label: "Day" },
        { value: "week", label: "Week" },
      ]}
    />
  </div>
);

const DayPane = ({ mode, onMode }: { mode: Mode; onMode: (mode: Mode) => void }) => {
  const day = WEEK[TODAY_INDEX] as Day;
  const { predicted } = useDayFacts(day);
  const { keep } = useWorld();
  return (
    <section aria-label="Timeline, today" className="flex min-w-0 flex-1 flex-col">
      <PaneBar title={`${day.weekday} ${day.number} Nov`} mode={mode} onMode={onMode} />
      <p className="flex h-[3.25rem] items-center gap-2 px-1 text-micro text-muted-foreground">
        {predicted.length > 0 ? (
          <>
            <HatchSwatch />
            {predicted.length} predicted later
            <Button variant="secondary" size="sm" className="ml-auto" onClick={() => keep(predicted.map((entry) => entry.id))}>
              Keep all <KeyCombo keys="mod+enter" />
            </Button>
          </>
        ) : (
          "Every block is kept"
        )}
      </p>
      <DayTimeline day={day} from={at(8)} to={at(18, 30)} scale={0.95} gutter={84} lane={26} now={NOW} />
    </section>
  );
};

const WeekTrack = ({ day, index, from, to, scale }: { day: Day; index: number; from: number; to: number; scale: number }) => {
  const entries = useEntries(day);
  const now = nowFor(index);
  return (
    <div className={cn("min-w-0 rounded-lg px-[3px]", index === TODAY_INDEX && "bg-foreground/[0.04]")}>
      <DayTrack entries={entries} from={from} to={to} scale={scale} density="week" now={now}>
        {index === TODAY_INDEX && <NowLine from={from} scale={scale} now={now} />}
        {entries.length === 0 && <span className="absolute inset-x-0 top-6 text-center text-micro text-faint-foreground">Nothing planned</span>}
      </DayTrack>
    </div>
  );
};

const WeekPane = ({ mode, onMode }: { mode: Mode; onMode: (mode: Mode) => void }) => {
  const from = at(8);
  const to = at(18, 30);
  const scale = 0.95;
  const gutter = 84;
  return (
    <section aria-label="Timeline, this week" className="flex min-w-0 flex-1 flex-col">
      <PaneBar title="23 to 29 Nov" mode={mode} onMode={onMode} />
      <div className="grid grid-cols-7 pt-1" style={{ paddingLeft: gutter }}>
        {WEEK.map((day, index) => (
          <DayHeader key={day.date} day={day} index={index} compact />
        ))}
      </div>
      <div className="relative" style={{ paddingLeft: gutter }}>
        <Rail from={from} to={to} scale={scale} now={NOW} gutter={gutter} lane={26} energy={WEEK[TODAY_INDEX]?.energy ?? 1} />
        <div className="grid grid-cols-7">
          {WEEK.map((day, index) => (
            <WeekTrack key={day.date} day={day} index={index} from={from} to={to} scale={scale} />
          ))}
        </div>
      </div>
    </section>
  );
};

export const PlannerWindow = ({ start }: { start: Mode }) => {
  const [mode, setMode] = useState(start);
  return (
    <Fit width={1240}>
      <div role="group" aria-label={`Mac Planner, ${mode} timeline`} className="flex h-[49rem] overflow-hidden rounded-2xl bg-background shadow-lift ring-1 ring-foreground/[0.08]">
        <div className="relative">
          <span aria-hidden="true" className="absolute top-4 left-4 flex gap-2">
            {["bg-[#ff5f57]", "bg-[#febc2e]", "bg-[#28c840]"].map((light) => (
              <span key={light} className={cn("size-3 rounded-full", light)} />
            ))}
          </span>
          <Sidebar />
        </div>
        <div className="m-2 ml-0 flex min-w-0 flex-1 gap-5 overflow-hidden rounded-[1.25rem] bg-surface-inset px-5 pt-5 [--tl-ground:var(--surface-inset)]">
          <BrainDump />
          {mode === "day" && <DayList index={TODAY_INDEX} />}
          {mode === "day" && <DayList index={TODAY_INDEX + 1} />}
          {mode === "day" ? <DayPane mode={mode} onMode={setMode} /> : <WeekPane mode={mode} onMode={setMode} />}
        </div>
      </div>
    </Fit>
  );
};
