import { Result } from "effect";
import { addDays, laterOf, type IsoDate } from "../date";
import { parseEnd, parseSchedule } from "../effect/recurrence";
import {
  MAX_EVERY,
  MAX_REPEAT_COUNT,
  describeSchedule,
  firstOnOrAfter,
  type AfterCompletion,
  type MonthDay,
  type RepeatEnd,
  type Schedule,
  type Weekday,
} from "../recurrence";

export type { RepeatEnd, Schedule };

export const NEVER = { kind: "never" } as const satisfies RepeatEnd;

export const WEEKDAYS = [
  [1, "Monday"],
  [2, "Tuesday"],
  [3, "Wednesday"],
  [4, "Thursday"],
  [5, "Friday"],
  [6, "Saturday"],
  [7, "Sunday"],
] as const satisfies readonly (readonly [Weekday, string])[];

type ByWeekday = Extract<MonthDay, { kind: "weekday" }>;
type ByDay = Extract<MonthDay, { kind: "day" }>;

const dayParts = (date: IsoDate) => {
  const at = new Date(`${date}T00:00:00Z`);
  const day = at.getUTCDate();
  const month = at.getUTCMonth() + 1;
  const length = new Date(Date.UTC(at.getUTCFullYear(), month, 0)).getUTCDate();
  const weekday = (((at.getUTCDay() + 6) % 7) + 1) as Weekday;
  const nth = (day + 7 > length ? -1 : Math.ceil(day / 7)) as ByWeekday["nth"];
  return { day, month, weekday, nth };
};

export const repeatPresets = (base: IsoDate) => {
  const { day, month, weekday, nth } = dayParts(base);
  return [
    { kind: "days", every: 1 },
    { kind: "weekdays" },
    { kind: "weeks", every: 1, days: [weekday] },
    { kind: "weeks", every: 2, days: [weekday] },
    { kind: "months", every: 1, on: { kind: "day", day } },
    { kind: "months", every: 1, on: { kind: "weekday", nth, weekday } },
    { kind: "years", every: 1, month, day },
  ] as const satisfies readonly Schedule[];
};

const canonical: (value: unknown) => unknown = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).toSorted(([a], [b]) => (a < b ? -1 : 1)).map(([key, inner]) => [key, canonical(inner)]))
      : value;

export const sameSchedule = (a: Schedule | undefined, b: Schedule | undefined) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

export const isPreset = (schedule: Schedule, base: IsoDate) => repeatPresets(base).some((preset) => sameSchedule(preset, schedule));

export const scheduleParts = (schedule: Schedule) => {
  const text = describeSchedule(schedule, NEVER);
  if (schedule.kind === "weekdays") return { lead: text, qualifier: "Mon to Fri" };
  const at = text.indexOf(" on ");
  return at === -1 ? { lead: text, qualifier: undefined } : { lead: text.slice(0, at), qualifier: text.slice(at + 1) };
};

export const repeatLabel = (schedule: Schedule, end: RepeatEnd) => describeSchedule(schedule, end);

export const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

const dayFormat = new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export const repeatDay = (date: string) => dayFormat.format(Date.parse(`${date}T00:00:00Z`)).replaceAll(",", "");

export const UNITS = ["days", "weeks", "months", "years"] as const;
export type Unit = (typeof UNITS)[number];
export const AFTER_UNITS = ["day", "week", "month"] as const satisfies readonly AfterCompletion["unit"][];
type AfterUnit = AfterCompletion["unit"];

export type RepeatMode = "calendar" | "afterCompletion";

export type RepeatDraft = {
  mode: RepeatMode;
  unit: Unit;
  every: number;
  days: readonly Weekday[];
  monthOn: MonthDay["kind"];
  monthDay: ByDay;
  monthWeekday: ByWeekday;
  yearDate: { month: number; day: number };
  afterUnit: AfterUnit;
  afterEvery: number;
  end: RepeatEnd;
};

const baseDraft = (base: IsoDate, end: RepeatEnd) => {
  const { day, month, weekday, nth } = dayParts(base);
  return {
    mode: "calendar",
    unit: "weeks",
    every: 1,
    days: [weekday],
    monthOn: "day",
    monthDay: { kind: "day", day },
    monthWeekday: { kind: "weekday", nth, weekday },
    yearDate: { month, day },
    afterUnit: "day",
    afterEvery: 1,
    end,
  } satisfies RepeatDraft;
};

const fromSchedule = {
  days: (draft, schedule) => ({ ...draft, unit: "days", every: schedule.every }),
  weekdays: (draft) => ({ ...draft, unit: "weeks", every: 1, days: [1, 2, 3, 4, 5] }),
  weeks: (draft, schedule) => ({ ...draft, unit: "weeks", every: schedule.every, days: schedule.days }),
  months: (draft, schedule) =>
    schedule.on.kind === "day"
      ? { ...draft, unit: "months", every: schedule.every, monthOn: "day", monthDay: schedule.on }
      : { ...draft, unit: "months", every: schedule.every, monthOn: "weekday", monthWeekday: schedule.on },
  years: (draft, schedule) => ({ ...draft, unit: "years", every: schedule.every, yearDate: { month: schedule.month, day: schedule.day } }),
  afterCompletion: (draft, schedule) => ({ ...draft, mode: "afterCompletion", afterUnit: schedule.unit, afterEvery: schedule.every }),
} satisfies { [K in Schedule["kind"]]: (draft: RepeatDraft, schedule: Extract<Schedule, { kind: K }>) => RepeatDraft };

export const draftFrom = (schedule: Schedule | undefined, end: RepeatEnd, base: IsoDate, mode: RepeatMode) => {
  const draft: RepeatDraft = { ...baseDraft(base, end), mode };
  if (!schedule) return draft;
  return (fromSchedule[schedule.kind] as (draft: RepeatDraft, schedule: Schedule) => RepeatDraft)(draft, schedule);
};

const toSchedule = {
  days: (draft) => ({ kind: "days", every: draft.every }),
  weeks: (draft) => ({ kind: "weeks", every: draft.every, days: draft.days.toSorted((a, b) => a - b) }),
  months: (draft) => ({ kind: "months", every: draft.every, on: draft.monthOn === "day" ? draft.monthDay : draft.monthWeekday }),
  years: (draft) => ({ kind: "years", every: draft.every, ...draft.yearDate }),
} satisfies Record<Unit, (draft: RepeatDraft) => Schedule>;

export const scheduleFrom = (draft: RepeatDraft) =>
  draft.mode === "afterCompletion"
    ? ({ kind: "afterCompletion", every: draft.afterEvery, unit: draft.afterUnit } satisfies Schedule)
    : toSchedule[draft.unit](draft);

export const maxEvery = (draft: RepeatDraft) => (draft.mode === "afterCompletion" ? MAX_EVERY.afterCompletion : MAX_EVERY[draft.unit]);

export const MAX_COUNT = MAX_REPEAT_COUNT;

export const clampEvery = (draft: RepeatDraft) => ({
  ...draft,
  every: Math.min(draft.every, MAX_EVERY[draft.unit]),
});

export const isValidDraft = (draft: RepeatDraft) => Result.isSuccess(parseSchedule(scheduleFrom(draft))) && Result.isSuccess(parseEnd(draft.end));

export const firstDate = (schedule: Schedule, base: IsoDate) => firstOnOrAfter(schedule, base, base);

export const baseDate = (when: { kind: string; date?: string }, today: IsoDate) =>
  when.kind === "scheduled" && when.date ? laterOf(today, when.date as IsoDate) : today;

export const defaultEndDate = (base: IsoDate) => addDays(base, 30);
