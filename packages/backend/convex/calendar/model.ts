import { err, ok } from "neverthrow";
import type { IsoDate } from "../../shared/date";
import type { Availability, CalendarKind, Response } from "./tables";

export type CalendarError =
  | { readonly kind: "invalid_window" }
  | { readonly kind: "invalid_range" }
  | { readonly kind: "invalid_time_zone"; readonly timeZone: string }
  | { readonly kind: "invalid_hours" }
  | { readonly kind: "not_found" };

export type Interval = { readonly start: number; readonly end: number };

export type Blocking = { readonly availability: Availability; readonly allDay: boolean; readonly response?: Response };

export type WorkingHours = { readonly startMinute: number; readonly endMinute: number };

export const DEFAULT_WORKING_HOURS: WorkingHours = { startMinute: 9 * 60, endMinute: 17 * 60 + 30 };

export const MINUTE_MS = 60_000;
export const DAY_MS = 86_400_000;
export const MAX_COMMITMENT_SPAN_MS = 14 * DAY_MS;

const BUSY_AVAILABILITIES = new Set<Availability>(["busy", "tentative", "unavailable"]);

export const blocksTime = ({ availability, allDay, response }: Blocking) =>
  response !== "declined" && (BUSY_AVAILABILITIES.has(availability) || (availability === "unknown" && !allDay));

export const includedByDefault = (kind: CalendarKind) => kind !== "subscription" && kind !== "birthday";

export const busyMs = (window: Interval, intervals: readonly Interval[]) => {
  const clipped = intervals
    .map(({ start, end }) => ({ start: Math.max(start, window.start), end: Math.min(end, window.end) }))
    .filter(({ start, end }) => end > start)
    .toSorted((a, b) => a.start - b.start);
  let busy = 0;
  let reach = window.start;
  for (const { start, end } of clipped) {
    const from = Math.max(start, reach);
    if (end > from) {
      busy += end - from;
      reach = end;
    }
  }
  return busy;
};

export const capacityOfDay = (window: Interval, commitments: readonly (Interval & Blocking)[]) => {
  const workingMinutes = Math.round((window.end - window.start) / MINUTE_MS);
  const busyMinutes = Math.round(busyMs(window, commitments.filter(blocksTime)) / MINUTE_MS);
  return { workingMinutes, busyMinutes, freeMinutes: workingMinutes - busyMinutes };
};

const formatters = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timeZone: string) => {
  const known = formatters.get(timeZone);
  if (known) return known;
  const made = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatters.set(timeZone, made);
  return made;
};

export const parseTimeZone = (timeZone: string) => {
  try {
    formatterFor(timeZone);
    return ok<string, CalendarError>(timeZone);
  } catch {
    return err<string, CalendarError>({ kind: "invalid_time_zone", timeZone });
  }
};

const offsetAt = (instant: number, timeZone: string) => {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((each) => each.type === type)?.value ?? 0);
  const wall = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
  return wall - Math.floor(instant / 1000) * 1000;
};

export const zonedIso = (instant: number, timeZone: string) => {
  const offsetMinutes = Math.round(offsetAt(instant, timeZone) / MINUTE_MS);
  const wall = new Date(instant + offsetMinutes * MINUTE_MS).toISOString().slice(0, 16);
  const size = Math.abs(offsetMinutes);
  const hours = String(Math.floor(size / 60)).padStart(2, "0");
  const minutes = String(size % 60).padStart(2, "0");
  return `${wall}${offsetMinutes < 0 ? "-" : "+"}${hours}:${minutes}`;
};

export const zonedDate = (instant: number, timeZone: string) => zonedIso(instant, timeZone).slice(0, 10) as IsoDate;

export const zonedMoment = (date: IsoDate, minute: number, timeZone: string) => {
  const wall = Date.parse(`${date}T00:00:00Z`) + minute * MINUTE_MS;
  const guess = wall - offsetAt(wall, timeZone);
  return wall - offsetAt(guess, timeZone);
};

export const workingWindow = (date: IsoDate, hours: WorkingHours, timeZone: string) =>
  ({
    start: zonedMoment(date, hours.startMinute, timeZone),
    end: zonedMoment(date, hours.endMinute, timeZone),
  }) satisfies Interval;

export const parseWorkingHours = (hours: WorkingHours) => {
  const { startMinute, endMinute } = hours;
  const valid =
    Number.isInteger(startMinute) && Number.isInteger(endMinute) && startMinute >= 0 && endMinute <= 24 * 60 && startMinute < endMinute;
  return valid ? ok<WorkingHours, CalendarError>(hours) : err<WorkingHours, CalendarError>({ kind: "invalid_hours" });
};

const channel = (value: number) =>
  Math.round(Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)) * 255)
    .toString(16)
    .padStart(2, "0");

export const hexColour = ({ red, green, blue }: { red: number; green: number; blue: number }) =>
  `#${channel(red)}${channel(green)}${channel(blue)}`;
