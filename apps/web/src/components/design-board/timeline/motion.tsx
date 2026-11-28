"use client";

import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { Button } from "@/components/ui/action-button";
import { at, clock, clockRange, lookOf, type BlockEntry, type Day, type Entry, type Look } from "./model";
import { Block, DayTimeline, DayTrack, Rail, TimelineWorld, useWorld } from "./parts";
import { NOW, TODAY_INDEX, WEEK } from "./sample";

const SNAP = 15;

export const NowDemo = () => {
  const [now, setNow] = useState(NOW);
  const day = WEEK[TODAY_INDEX] as Day;
  return (
    <div className="w-full max-w-md">
      <label className="mb-5 flex items-center gap-3 text-small">
        <span className="w-24 shrink-0 text-muted-foreground">
          Now <span className="font-mono text-foreground">{clock(now)}</span>
        </span>
        <input
          type="range"
          name="now"
          min={at(9)}
          max={at(18)}
          step={5}
          value={now}
          onChange={(event) => setNow(Number(event.target.value))}
          aria-valuetext={clock(now)}
          className="h-6 min-w-0 flex-1 touch-manipulation accent-(--brand)"
        />
      </label>
      <DayTimeline day={day} from={at(9)} to={at(18)} scale={0.95} gutter={58} now={now} />
    </div>
  );
};

const DRAG_ID = "demo-papers";
const FIXED: readonly Entry[] = [
  { kind: "commitment", id: "demo-supervision", title: "Thesis supervision", start: at(13, 15), minutes: 45, calendar: "University", colour: "plum", place: "Woodside 3.07" },
  { kind: "block", id: "demo-copy", title: "Review the onboarding copy", area: "korvant", start: at(16, 30), minutes: 45, kept: true, done: false },
];
const HOME = at(14, 30);
const BOUNDS = { min: at(14, 5), max: at(15, 20) };

const clamp = (minute: number) => Math.max(BOUNDS.min, Math.min(BOUNDS.max, Math.round(minute / SNAP) * SNAP));

const DragStage = () => {
  const { kept, keep, reset } = useWorld();
  const [start, setStart] = useState(HOME);
  const [held, setHeld] = useState<{ y: number; start: number; moved: boolean } | null>(null);
  const from = at(13);
  const to = at(17, 30);
  const scale = 1.05;
  const entry = { kind: "block", id: DRAG_ID, title: "Read two papers on retrieval", area: "university", start, minutes: 60, kept: kept.has(DRAG_ID), done: false, guess: true } satisfies BlockEntry;
  const place = (minute: number) => {
    setStart(clamp(minute));
    keep([DRAG_ID]);
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    setHeld({ y: event.clientY, start, moved: false });
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!held) return;
    const delta = event.clientY - held.y;
    if (Math.abs(delta) < 4 && !held.moved) return;
    if (!held.moved) {
      event.currentTarget.setPointerCapture(event.pointerId);
      setHeld({ ...held, moved: true });
    }
    setStart(clamp(held.start + delta / scale));
  };
  const onPointerUp = () => {
    if (held?.moved) keep([DRAG_ID]);
    setHeld(null);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    place(start + (event.key === "ArrowUp" ? -SNAP : SNAP));
  };
  const lifted = held?.moved === true;
  return (
    <div className="w-full max-w-md">
      <div className="mb-5 flex items-center gap-3 text-small text-muted-foreground">
        <span className="min-w-0 flex-1 text-pretty">Click the hatched block to keep it, or drag it. Arrow keys move it by 15 minutes.</span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            reset();
            setStart(HOME);
          }}
        >
          Reset
        </Button>
      </div>
      <div className="relative" style={{ paddingLeft: 58 }}>
        <Rail from={from} to={to} scale={scale} now={Number.NEGATIVE_INFINITY} gutter={58} />
        <DayTrack entries={FIXED} from={from} to={to} scale={scale} density="full" now={Number.NEGATIVE_INFINITY}>
          <div
            className="absolute inset-x-0 touch-none select-none motion-reduce:transition-none!"
            style={{ top: (start - from) * scale + 1, transition: lifted ? "none" : "top 220ms var(--ease-out)" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onKeyDown}
          >
            {lifted && (
              <span className="absolute -top-6 left-0 z-10 rounded-full bg-foreground px-2 font-mono text-micro leading-5 whitespace-nowrap text-background">{clockRange(start, entry.minutes)}</span>
            )}
            <Block entry={entry} look={lookOf(entry, Number.NEGATIVE_INFINITY)} scale={scale} density="full" lifted={lifted} className="cursor-grab active:cursor-grabbing" />
          </div>
        </DayTrack>
      </div>
    </div>
  );
};

export const DragDemo = () => (
  <TimelineWorld>
    <DragStage />
  </TimelineWorld>
);

const base = { kind: "block", area: "university", start: at(14), minutes: 50, kept: true, done: false } as const;

const STATES: { name: string; rule: string; look: Look; entry: Entry }[] = [
  {
    name: "Predicted",
    rule: "Hollow and hatched in the Area colour. LifeOS expects the Task here. Nothing is saved yet.",
    look: "predicted",
    entry: { ...base, id: "state-predicted", title: "Read two papers on retrieval", kept: false, guess: true },
  },
  {
    name: "Kept",
    rule: "Filled with the Area colour. A real Work Block: you kept a prediction or placed it yourself.",
    look: "kept",
    entry: { ...base, id: "state-kept", title: "Read two papers on retrieval" },
  },
  {
    name: "Past, done",
    rule: "Graphite fill, a filled tick and a struck title.",
    look: "done",
    entry: { ...base, id: "state-done", title: "Read two papers on retrieval", done: true },
  },
  {
    name: "Past, not done",
    rule: "A graphite outline, an open box and the words Not done. No red.",
    look: "missed",
    entry: { ...base, id: "state-missed", title: "Read two papers on retrieval" },
  },
  {
    name: "External Commitment",
    rule: "A plain outlined card with the Calendar's dot and no box. It is not a Task, so it is never hatched or filled.",
    look: "commitment",
    entry: { kind: "commitment", id: "state-commitment", title: "Thesis supervision", start: at(14), minutes: 50, calendar: "University", colour: "plum", place: "Woodside 3.07" },
  },
  {
    name: "With a Trip",
    rule: "The drive there and back is folded into the block, with when to leave. The Task's own time stays the solid part.",
    look: "kept",
    entry: { kind: "block", id: "state-trip", title: "Pick up the parcel", area: "personal", start: at(14), minutes: 26, kept: true, done: false, trip: { place: "Australia Post, Clayton", minutes: 15 } },
  },
];

export const StateSwatches = () => (
  <ul className="grid w-full gap-x-6 gap-y-7 sm:grid-cols-2 xl:grid-cols-3">
    {STATES.map((state) => (
      <li key={state.name}>
        <Block entry={state.entry} look={state.look} scale={1.1} density="full" />
        <p className="mt-3 text-small font-medium">{state.name}</p>
        <p className="text-small text-pretty text-muted-foreground">{state.rule}</p>
      </li>
    ))}
  </ul>
);

export const CompactSwatches = () => (
  <div className="flex w-full flex-col gap-1.5">
    {STATES.slice(0, 5).map((state) => (
      <Block key={state.name} entry={{ ...state.entry, minutes: 20 }} look={state.look} scale={1.1} density="full" />
    ))}
  </div>
);
