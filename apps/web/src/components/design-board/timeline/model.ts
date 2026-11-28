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

export type Day = { date: string; weekday: string; number: number; entries: readonly Entry[] };

export type Look = "predicted" | "kept" | "done" | "missed" | "commitment" | "commitment-past";
export type Density = "full" | "week" | "mini";
export type Load = { done: number; kept: number; predicted: number };

export const WORKING = { start: 9 * 60, end: 17 * 60 + 30 } as const;

export const at = (hour: number, minute = 0) => hour * 60 + minute;

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
