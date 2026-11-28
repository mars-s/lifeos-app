import { Result } from "effect";
import type { MonthDay, RepeatEnd, Schedule } from "../../convex/planner/tables";
import { parseIsoDate } from "./date";
import { InvalidSchedule } from "./errors";

type Kind = Schedule["kind"];
type Of<K extends Kind> = Extract<Schedule, { kind: K }>;
type EndOf<K extends RepeatEnd["kind"]> = Extract<RepeatEnd, { kind: K }>;
type Fault = (typeof InvalidSchedule.fields.reason)["Type"];

export const MAX_REPEAT_COUNT = 999;
export const MAX_EVERY = { days: 99, weeks: 52, months: 24, years: 10, afterCompletion: 99 } as const;

export const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

const zonedFormatters = new Map<string, Intl.DateTimeFormat>();

export const zonedFormatter = (timeZone: string) => {
  const known = zonedFormatters.get(timeZone);
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
  zonedFormatters.set(timeZone, made);
  return made;
};

const fault = (reason: Fault) => Result.fail(new InvalidSchedule({ reason }));

export const parseTimeZone = (timeZone: string) => {
  const parsed: Result.Result<string, InvalidSchedule> = Result.try({
    try: () => {
      zonedFormatter(timeZone);
      return timeZone;
    },
    catch: () => new InvalidSchedule({ reason: "time_zone" }),
  });
  return parsed;
};

const isWhole = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;

const LEAP_YEAR = 2000;

const onDay = (on: MonthDay) => on.kind === "weekday" || isWhole(on.day, 1, 31);

const checkShape = {
  days: (schedule) => Result.succeed(schedule),
  weekdays: (schedule) => Result.succeed(schedule),
  weeks: (schedule) => {
    const days = [...new Set(schedule.days)].toSorted((a, b) => a - b);
    return days.length > 0 ? Result.succeed({ ...schedule, days }) : fault("days");
  },
  months: (schedule) => (onDay(schedule.on) ? Result.succeed(schedule) : fault("day")),
  years: (schedule) =>
    !isWhole(schedule.month, 1, 12)
      ? fault("month")
      : isWhole(schedule.day, 1, daysInMonth(LEAP_YEAR, schedule.month))
        ? Result.succeed(schedule)
        : fault("day"),
  afterCompletion: (schedule) => Result.succeed(schedule),
} satisfies { [K in Kind]: (schedule: Of<K>) => Result.Result<Of<K>, InvalidSchedule> };

export const parseSchedule = (schedule: Schedule) => {
  const parsed: Result.Result<Schedule, InvalidSchedule> =
    "every" in schedule && !isWhole(schedule.every, 1, MAX_EVERY[schedule.kind])
      ? fault("every")
      : (checkShape[schedule.kind] as (schedule: Schedule) => Result.Result<Schedule, InvalidSchedule>)(schedule);
  return parsed;
};

const checkEnd = {
  never: (end) => Result.succeed(end),
  on: (end) =>
    parseIsoDate(end.date).pipe(
      Result.map(() => end),
      Result.mapError(() => new InvalidSchedule({ reason: "end" })),
    ),
  after: (end) => (isWhole(end.count, 1, MAX_REPEAT_COUNT) ? Result.succeed(end) : fault("count")),
} satisfies { [K in RepeatEnd["kind"]]: (end: EndOf<K>) => Result.Result<EndOf<K>, InvalidSchedule> };

export const parseEnd = (end: RepeatEnd) => {
  const parsed: Result.Result<RepeatEnd, InvalidSchedule> = (
    checkEnd[end.kind] as (end: RepeatEnd) => Result.Result<RepeatEnd, InvalidSchedule>
  )(end);
  return parsed;
};
