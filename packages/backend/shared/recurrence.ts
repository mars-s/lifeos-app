import { err, ok, type Result } from "neverthrow";
import type { MonthDay, RepeatEnd, RepeatNext, Schedule, Weekday } from "../convex/planner/tables";
import { addDays, laterOf, parseIsoDate, type IsoDate } from "./date";

export type { MonthDay, RepeatEnd, RepeatNext, Schedule, Weekday };
export type AfterCompletion = Extract<Schedule, { kind: "afterCompletion" }>;
export type ScheduleFault = "every" | "days" | "day" | "month" | "end" | "count" | "time_zone";
export type ScheduleError = { readonly kind: "invalid_schedule"; readonly reason: ScheduleFault };

type Kind = Schedule["kind"];
type Of<K extends Kind> = Extract<Schedule, { kind: K }>;
type EndOf<K extends RepeatEnd["kind"]> = Extract<RepeatEnd, { kind: K }>;

const DAY_MS = 86_400_000;
const SCAN_DAYS = 11 * 366;
export const MAX_REPEAT_COUNT = 999;
export const MAX_EVERY = { days: 99, weeks: 52, months: 24, years: 10, afterCompletion: 99 } as const;

const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const NTH_NAMES = new Map([
  [1, "first"],
  [2, "second"],
  [3, "third"],
  [4, "fourth"],
  [-1, "last"],
]);

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

const isoOf = (year: number, month: number, day: number) => `${pad(year, 4)}-${pad(month)}-${pad(day)}` as IsoDate;

const dayOf = (date: IsoDate) => {
  const at = new Date(`${date}T00:00:00Z`);
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth() + 1;
  return {
    number: at.getTime() / DAY_MS,
    year,
    month,
    day: at.getUTCDate(),
    weekday: ((at.getUTCDay() + 6) % 7) + 1,
    length: daysInMonth(year, month),
  };
};

type Day = ReturnType<typeof dayOf>;

const onCycle = (steps: number, every: number) => steps >= 0 && steps % every === 0;

const mondayOf = (day: Day) => day.number - (day.weekday - 1);

const monthIndex = (day: Day) => day.year * 12 + day.month - 1;

const onMonthDay = (on: MonthDay, date: Day) =>
  on.kind === "day"
    ? date.day === Math.min(on.day, date.length)
    : date.weekday === on.weekday && (on.nth === -1 ? date.day + 7 > date.length : Math.ceil(date.day / 7) === on.nth);

const occurs = {
  days: (schedule, anchor, date) => onCycle(date.number - anchor.number, schedule.every),
  weekdays: (_schedule, _anchor, date) => date.weekday <= 5,
  weeks: (schedule, anchor, date) =>
    onCycle((mondayOf(date) - mondayOf(anchor)) / 7, schedule.every) && schedule.days.some((day) => day === date.weekday),
  months: (schedule, anchor, date) =>
    onCycle(monthIndex(date) - monthIndex(anchor), schedule.every) && onMonthDay(schedule.on, date),
  years: (schedule, anchor, date) =>
    onCycle(date.year - anchor.year, schedule.every) && date.month === schedule.month && date.day === Math.min(schedule.day, date.length),
  afterCompletion: () => false,
} satisfies { [K in Kind]: (schedule: Of<K>, anchor: Day, date: Day) => boolean };

const occursOnDay = (schedule: Schedule, anchor: Day, date: Day) =>
  (occurs[schedule.kind] as (schedule: Schedule, anchor: Day, date: Day) => boolean)(schedule, anchor, date);

export const occursOn = (schedule: Schedule, anchor: IsoDate, date: IsoDate) =>
  date >= anchor && occursOnDay(schedule, dayOf(anchor), dayOf(date));

export const firstOnOrAfter = (schedule: Schedule, anchor: IsoDate, date: IsoDate) => {
  if (schedule.kind === "afterCompletion") return null;
  const start = laterOf(anchor, date);
  const anchorDay = dayOf(anchor);
  for (let offset = 0; offset < SCAN_DAYS; offset += 1) {
    const candidate = addDays(start, offset);
    if (occursOnDay(schedule, anchorDay, dayOf(candidate))) return candidate;
  }
  return null;
};

export const firstAfter = (schedule: Schedule, anchor: IsoDate, date: IsoDate) =>
  firstOnOrAfter(schedule, anchor, addDays(date, 1));

const addMonths = (date: IsoDate, months: number) => {
  const { year, month, day } = dayOf(date);
  const index = year * 12 + month - 1 + months;
  const nextYear = Math.floor(index / 12);
  const nextMonth = (index % 12) + 1;
  return isoOf(nextYear, nextMonth, Math.min(day, daysInMonth(nextYear, nextMonth)));
};

const afterUnit = {
  day: (date, every) => addDays(date, every),
  week: (date, every) => addDays(date, 7 * every),
  month: addMonths,
} satisfies Record<AfterCompletion["unit"], (date: IsoDate, every: number) => IsoDate>;

export const afterCompletionDate = (schedule: AfterCompletion, completedOn: IsoDate) =>
  afterUnit[schedule.unit](completedOn, schedule.every);

export const following = (schedule: Schedule, anchor: IsoDate, date: IsoDate) =>
  schedule.kind === "afterCompletion" ? afterCompletionDate(schedule, date) : firstAfter(schedule, anchor, date);

const endAllows = {
  never: () => true,
  on: (end, date) => date <= end.date,
  after: (end, _date, count) => count < end.count,
} satisfies { [K in RepeatEnd["kind"]]: (end: EndOf<K>, date: IsoDate, count: number) => boolean };

export const withinEnd = (end: RepeatEnd, date: IsoDate, count: number) =>
  (endAllows[end.kind] as (end: RepeatEnd, date: IsoDate, count: number) => boolean)(end, date, count);

type RuleClock = { readonly schedule: Schedule; readonly anchor: string; readonly end: RepeatEnd; readonly count: number; readonly next: RepeatNext };

export const uncreatedDates = (rule: RuleClock, from: IsoDate, to: IsoDate) => {
  if (rule.next.kind !== "due") return [];
  const dates: IsoDate[] = [];
  let date: IsoDate | null = rule.next.date as IsoDate;
  let count = rule.count;
  while (date && date <= to && withinEnd(rule.end, date, count)) {
    if (date >= from) dates.push(date);
    if (rule.schedule.kind === "afterCompletion") break;
    count += 1;
    date = firstAfter(rule.schedule, rule.anchor as IsoDate, date);
  }
  return dates;
};

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

const dateFormatterFor = (timeZone: string) => {
  const known = dateFormatters.get(timeZone);
  if (known) return known;
  const made = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  dateFormatters.set(timeZone, made);
  return made;
};

export const localDateIn = (timeZone: string, instant: number) => {
  const parts = dateFormatterFor(timeZone).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((each) => each.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}` as IsoDate;
};

const fault = (reason: ScheduleFault) => ({ kind: "invalid_schedule", reason }) satisfies ScheduleError;

export const parseTimeZone = (timeZone: string) => {
  try {
    dateFormatterFor(timeZone);
    return ok<string, ScheduleError>(timeZone);
  } catch {
    return err<string, ScheduleError>(fault("time_zone"));
  }
};

const isWhole = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;

const LEAP_YEAR = 2000;

const checkShape = {
  days: (schedule) => ok(schedule),
  weekdays: (schedule) => ok(schedule),
  weeks: (schedule) => {
    const days = [...new Set(schedule.days)].toSorted((a, b) => a - b);
    return days.length > 0 ? ok({ ...schedule, days }) : err(fault("days"));
  },
  months: (schedule) => (schedule.on.kind === "weekday" || isWhole(schedule.on.day, 1, 31) ? ok(schedule) : err(fault("day"))),
  years: (schedule) =>
    !isWhole(schedule.month, 1, 12)
      ? err(fault("month"))
      : isWhole(schedule.day, 1, daysInMonth(LEAP_YEAR, schedule.month))
        ? ok(schedule)
        : err(fault("day")),
  afterCompletion: (schedule) => ok(schedule),
} satisfies { [K in Kind]: (schedule: Of<K>) => Result<Of<K>, ScheduleError> };

export const parseSchedule = (schedule: Schedule) => {
  if ("every" in schedule && !isWhole(schedule.every, 1, MAX_EVERY[schedule.kind])) {
    return err<Schedule, ScheduleError>(fault("every"));
  }
  return (checkShape[schedule.kind] as (schedule: Schedule) => Result<Schedule, ScheduleError>)(schedule);
};

const checkEnd = {
  never: (end) => ok(end),
  on: (end) =>
    parseIsoDate(end.date)
      .map(() => end)
      .mapErr(() => fault("end")),
  after: (end) => (isWhole(end.count, 1, MAX_REPEAT_COUNT) ? ok(end) : err(fault("count"))),
} satisfies { [K in RepeatEnd["kind"]]: (end: EndOf<K>) => Result<EndOf<K>, ScheduleError> };

export const parseEnd = (end: RepeatEnd) =>
  (checkEnd[end.kind] as (end: RepeatEnd) => Result<RepeatEnd, ScheduleError>)(end);

const ordinal = (n: number) => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
};

const every = (n: number, one: string, many: string) => (n === 1 ? `Every ${one}` : `Every ${n} ${many}`);

const weekdayName = (weekday: number) => WEEKDAY_NAMES[weekday - 1];

const shortDate = (date: IsoDate) => {
  const { day, month } = dayOf(date);
  return `${day} ${MONTH_NAMES[month - 1]}`;
};

const describeKind = {
  days: (schedule) => every(schedule.every, "day", "days"),
  weekdays: () => "Every weekday",
  weeks: (schedule) => `${every(schedule.every, "week", "weeks")} on ${schedule.days.map(weekdayName).join(", ")}`,
  months: (schedule) =>
    `${every(schedule.every, "month", "months")} on the ${
      schedule.on.kind === "day" ? ordinal(schedule.on.day) : `${NTH_NAMES.get(schedule.on.nth)} ${weekdayName(schedule.on.weekday)}`
    }`,
  years: (schedule) => `${every(schedule.every, "year", "years")} on ${schedule.day} ${MONTH_NAMES[schedule.month - 1]}`,
  afterCompletion: (schedule) => `${schedule.every} ${schedule.unit}${schedule.every === 1 ? "" : "s"} after completion`,
} satisfies { [K in Kind]: (schedule: Of<K>) => string };

const describeEnd = {
  never: () => "",
  on: (end) => `, until ${shortDate(end.date as IsoDate)}`,
  after: (end) => (end.count === 1 ? ", once" : `, ${end.count} times`),
} satisfies { [K in RepeatEnd["kind"]]: (end: EndOf<K>) => string };

export const describeSchedule = (schedule: Schedule, end: RepeatEnd) =>
  (describeKind[schedule.kind] as (schedule: Schedule) => string)(schedule) +
  (describeEnd[end.kind] as (end: RepeatEnd) => string)(end);
