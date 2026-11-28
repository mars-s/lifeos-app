import type { AreaColour } from "@/components/lifeos/area";

export type AreaId = "university" | "paperless" | "korvant" | "personal";
export type Area = { name: string; colour: AreaColour };

export type Trip = { place: string; minutes: number };

export type BlockEntry = {
  kind: "block";
  id: string;
  title: string;
  area: AreaId;
  start: number;
  minutes: number;
  kept: boolean;
  done: boolean;
  guess?: boolean;
  trip?: Trip;
  fit?: "peak" | "dip";
};

export type CommitmentEntry = {
  kind: "commitment";
  id: string;
  title: string;
  start: number;
  minutes: number;
  calendar: string;
  colour: AreaColour;
  place?: string;
};

export type Entry = BlockEntry | CommitmentEntry;

export type Day = { date: string; weekday: string; number: number; energy: number; entries: readonly Entry[] };
export type EnergyMode = "past" | "today" | "usual";

export type Look = "predicted" | "kept" | "done" | "missed" | "commitment" | "commitment-past";
export type Density = "full" | "week" | "mini";
export type Load = { done: number; kept: number; predicted: number };

export const WORKING = { start: 9 * 60, end: 17 * 60 + 30 } as const;

export const at = (hour: number, minute = 0) => hour * 60 + minute;

export const WAKE = at(7, 5);
export const BEDTIME = at(22, 45);

export const energyAt = (minute: number, quality = 1) => {
  const hour = minute / 60;
  const awake = Math.max(0, (minute - WAKE) / 60);
  const rhythm = 0.3 * Math.cos((2 * Math.PI * (hour - 16.5)) / 24) + 0.24 * Math.cos((4 * Math.PI * (hour - 9)) / 24);
  const pressure = 0.7 * (1 - Math.exp(-awake / 16)) + 0.45 * Math.exp(-awake / 0.8);
  return Math.max(0.06, Math.min(1, ((rhythm - pressure + 0.5) / 0.62) * quality));
};

export const energyWord = (minute: number) => {
  const shape = energyAt(minute);
  if (shape >= 0.85 && minute < at(13)) return "peak, good for deep work";
  if (shape <= 0.56 && minute >= at(13) && minute <= at(16)) return "dip, good for admin or a walk";
  return undefined;
};

const extreme = (from: number, to: number, pick: (a: number, b: number) => boolean) =>
  Array.from({ length: (to - from) / 5 + 1 }, (_, index) => from + index * 5).reduce((best, minute) => (pick(energyAt(minute), energyAt(best)) ? minute : best), from);

export const PEAK_AT = extreme(WAKE + 55, at(13), (a, b) => a > b);
export const DIP_AT = extreme(at(13), at(17), (a, b) => a < b);

export const energyModeOf = (now: number) => (now === Number.POSITIVE_INFINITY ? "past" : now === Number.NEGATIVE_INFINITY ? "usual" : "today") satisfies EnergyMode;

export const outerOf = (entry: Entry) => {
  const travel = entry.kind === "block" && entry.trip ? entry.trip.minutes : 0;
  return { start: entry.start - travel, end: entry.start + entry.minutes + travel };
};

export const lookOf = (entry: Entry, now: number) => {
  const past = outerOf(entry).end <= now;
  if (entry.kind === "commitment") return past ? "commitment-past" : "commitment";
  if (past) return entry.done ? "done" : "missed";
  return entry.kept ? "kept" : "predicted";
};

export const visibleAt = (entry: Entry, now: number) => entry.kind === "commitment" || entry.kept || entry.start >= now;

const hour12 = (minute: number) => {
  const hour = Math.floor(minute / 60) % 24;
  return { hour: hour % 12 === 0 ? 12 : hour % 12, minute: minute % 60, suffix: hour < 12 ? "am" : "pm" };
};

export const clock = (minute: number, bare = false) => {
  const time = hour12(minute);
  const text = `${time.hour}:${String(time.minute).padStart(2, "0")}`;
  return bare ? text : `${text} ${time.suffix}`;
};

export const hourLabel = (minute: number) => {
  const time = hour12(minute);
  return `${time.hour} ${time.suffix}`;
};

export const clockRange = (start: number, minutes: number) => {
  const end = start + minutes;
  const sameHalf = start < 720 === end < 720;
  return `${clock(start, sameHalf)} – ${clock(end)}`;
};

export const span = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

export const capacityOf = (day: Day) =>
  WORKING.end -
  WORKING.start -
  day.entries
    .filter((entry) => entry.kind === "commitment")
    .reduce((sum, entry) => sum + Math.max(0, Math.min(entry.start + entry.minutes, WORKING.end) - Math.max(entry.start, WORKING.start)), 0);

export const loadOf = (entries: readonly Entry[]) =>
  entries.reduce<Load>(
    (load, entry) => {
      if (entry.kind !== "block") return load;
      const key = entry.done ? "done" : entry.kept ? "kept" : "predicted";
      return { ...load, [key]: load[key] + entry.minutes };
    },
    { done: 0, kept: 0, predicted: 0 },
  );

export const gapsOf = (entries: readonly Entry[], from: number, until: number) => {
  const spans = entries.map(outerOf).toSorted((a, b) => a.start - b.start);
  return spans.flatMap((current, index) => {
    const next = spans[index + 1];
    if (!next || current.end < from || next.start > until) return [];
    const minutes = next.start - current.end;
    return minutes >= 15 ? [{ start: current.end, minutes }] : [];
  });
};
