"use client";

import { EnergyLane } from "./energy";
import { at, BEDTIME, clock, DIP_AT, hourLabel, PEAK_AT, WAKE, type EnergyMode } from "./model";

const DAY = { from: at(6, 30), to: at(23, 15), scale: 0.52 } as const;
const top = (minute: number) => (minute - DAY.from) * DAY.scale;

const NOTES = [
  { minute: WAKE, title: "Wake", note: `Your usual wake, ${clock(WAKE)}` },
  { minute: PEAK_AT, title: "Peak", note: "Deep work is predicted here first" },
  { minute: DIP_AT, title: "Dip", note: "Admin, errands or a walk" },
  { minute: at(19, 30), title: "Second wind", note: "Fine for a light Task" },
  { minute: BEDTIME - 10, title: "Wind down", note: `Oura's bedtime, ${clock(BEDTIME)}` },
];

const FACTS = [
  { name: "Last night", value: "7:20 asleep" },
  { name: "Readiness", value: "84" },
  { name: "Sleep debt", value: "0:40 over 14 nights" },
  { name: "Peak", value: "9:45 to 11:30 am" },
  { name: "Dip", value: "2:15 to 3:45 pm" },
];

export const EnergyAnatomy = () => (
  <div className="grid w-full items-center gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,19rem)]">
    <div role="img" aria-label="Energy through one day: a rise after waking, a late-morning peak, an afternoon dip, a second wind and an evening wind down" className="relative mx-auto w-full max-w-sm" style={{ height: (DAY.to - DAY.from) * DAY.scale }}>
      {[8, 10, 12, 14, 16, 18, 20, 22].map((hour) => (
        <span key={hour} className="absolute left-0 -translate-y-1/2 font-mono text-[0.625rem] text-faint-foreground" style={{ top: top(at(hour)) }}>
          {hourLabel(at(hour))}
        </span>
      ))}
      <EnergyLane from={DAY.from} to={DAY.to} scale={DAY.scale} now={DAY.from} quality={0.95} mode="today" className="left-12" />
      {NOTES.map((item) => (
        <p key={item.title} className="absolute left-[8.75rem] -translate-y-1/2 text-small leading-4" style={{ top: top(item.minute) }}>
          <span className="font-medium">{item.title}</span>
          <span className="block text-micro text-muted-foreground">{item.note}</span>
        </p>
      ))}
    </div>
    <div className="rounded-2xl bg-popover p-4 shadow-lift ring-1 ring-foreground/[0.06]">
      <p className="flex items-center gap-2 text-heading font-medium">
        Energy
        <span className="rounded-full bg-foreground/[0.07] px-2 text-micro font-normal text-muted-foreground">Estimate</span>
      </p>
      <dl className="mt-3 space-y-1.5 text-small">
        {FACTS.map((fact) => (
          <div key={fact.name} className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{fact.name}</dt>
            <dd className="font-mono text-[0.75rem]">{fact.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 border-t border-border pt-3 text-micro text-pretty text-muted-foreground">
        Worked out from your Oura sleep and your usual wake time. It is not measured. It does not know about coffee, food, exercise or a hard conversation.
      </p>
    </div>
  </div>
);

const MINI = { from: at(7), to: at(23), scale: 0.3, width: 44 } as const;

const STATES: { name: string; note: string; mode?: EnergyMode; quality?: number }[] = [
  { name: "A good night", note: "7:20 asleep, readiness 84. Solid, from last night's real sleep.", mode: "today", quality: 0.95 },
  { name: "A short night", note: "5:10 asleep, readiness 61. Every row is shorter and paler, and the header says Low energy day.", mode: "today", quality: 0.64 },
  { name: "Usual pattern", note: "Coming days, and today when Oura has not synced since last night. Hollow ring dots in the same greens, like the outline of a predicted block.", mode: "usual", quality: 0.86 },
  { name: "Past", note: "Graphite. The estimate that day started with.", mode: "past", quality: 0.9 },
  { name: "No curve", note: "No Oura, or fewer than five nights: the plain dot rail, and Learning your pattern, 3 of 5 nights.", },
];

export const EnergyStates = () => (
  <ul className="grid w-full grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 xl:grid-cols-5">
    {STATES.map((state) => (
      <li key={state.name}>
        <div aria-hidden="true" className="relative" style={{ height: (MINI.to - MINI.from) * MINI.scale, width: MINI.width + 8 }}>
          <span
            className="tl-rail absolute inset-y-0 right-0 w-[5px] [--tl-dot:color-mix(in_oklab,var(--foreground)_38%,transparent)]"
            style={{ backgroundSize: `5px ${60 * MINI.scale}px, 5px ${15 * MINI.scale}px`, backgroundPosition: `0 ${-30 * MINI.scale}px, 0 ${-7.5 * MINI.scale}px` }}
          />
          {state.mode && <EnergyLane from={MINI.from} to={MINI.to} scale={MINI.scale} now={at(14)} quality={state.quality ?? 1} mode={state.mode} className="right-[2.5px]" />}
        </div>
        <p className="mt-3 text-small font-medium">{state.name}</p>
        <p className="text-small text-pretty text-muted-foreground">{state.note}</p>
      </li>
    ))}
  </ul>
);
