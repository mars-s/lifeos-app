import { err, ok } from "neverthrow";
import { addDays, parseIsoDate, type IsoDate } from "../../shared/date";
import { zonedMoment } from "../calendar/model";
import {
  BEDTIME_RECOMMENDATIONS,
  BEDTIME_STATUSES,
  type BedtimeRecommendation,
  type BedtimeStatus,
  type BedtimeWindow,
  type HealthDay,
  type OuraError,
  type SleepPeriod,
  type SleepTime,
} from "./tables";

export const MINUTE_MS = 60_000;
export const DAY_MINUTES = 24 * 60;
export const USUAL_NIGHTS = 14;
export const MIN_USUAL_NIGHTS = 3;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const numberOr = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const oneOf = <T extends string>(options: readonly T[], value: unknown) =>
  options.find((option) => option === value);

const invalid = () => err<never, OuraError>({ kind: "invalid_response" });

const LOCAL_OFFSET = /(?:([+-])(\d{2}):?(\d{2})|Z)$/;

export const parseLocalTime = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  const at = Date.parse(value);
  const zone = LOCAL_OFFSET.exec(value);
  if (!Number.isFinite(at) || !zone) return undefined;
  const [, sign, hours, minutes] = zone;
  const offsetMinutes = sign ? (sign === "-" ? -1 : 1) * (Number(hours) * 60 + Number(minutes)) : 0;
  return { at, offsetMinutes };
};

export const parseCollection = (body: unknown) =>
  isObject(body) && Array.isArray(body.data)
    ? ok<{ data: unknown[]; nextToken: string | undefined }, OuraError>({
        data: body.data,
        nextToken: typeof body.next_token === "string" && body.next_token !== "" ? body.next_token : undefined,
      })
    : invalid();

type SleepDoc = { day: IsoDate; period: SleepPeriod; timeInBed: number; readinessScore: number | undefined };

const parseSleepDoc = (doc: unknown) => {
  if (!isObject(doc) || doc.type !== "long_sleep") return undefined;
  const day = typeof doc.day === "string" ? parseIsoDate(doc.day).unwrapOr(undefined) : undefined;
  const start = parseLocalTime(doc.bedtime_start);
  const end = parseLocalTime(doc.bedtime_end);
  if (!day || !start || !end || end.at <= start.at) return undefined;
  const asleep = numberOr(doc.total_sleep_duration);
  return {
    day,
    period: {
      start: start.at,
      end: end.at,
      offsetMinutes: end.offsetMinutes,
      ...(asleep === undefined ? {} : { asleepMinutes: Math.round(asleep / 60) }),
    },
    timeInBed: numberOr(doc.time_in_bed) ?? (end.at - start.at) / 1000,
    readinessScore: isObject(doc.readiness) ? numberOr(doc.readiness.score) : undefined,
  } satisfies SleepDoc;
};

const parseWindow = (value: unknown) => {
  if (!isObject(value)) return undefined;
  const startOffset = numberOr(value.start_offset);
  const endOffset = numberOr(value.end_offset);
  const dayTz = numberOr(value.day_tz);
  return startOffset === undefined || endOffset === undefined || dayTz === undefined || endOffset < startOffset
    ? undefined
    : ({ startOffset, endOffset, dayTz } satisfies BedtimeWindow);
};

const parseSleepTimeDoc = (doc: unknown) => {
  if (!isObject(doc) || typeof doc.day !== "string") return undefined;
  const day = parseIsoDate(doc.day).unwrapOr(undefined);
  if (!day) return undefined;
  const status: BedtimeStatus | undefined = oneOf(BEDTIME_STATUSES, doc.status);
  const recommendation: BedtimeRecommendation | undefined = oneOf(BEDTIME_RECOMMENDATIONS, doc.recommendation);
  const window = parseWindow(doc.optimal_bedtime);
  return {
    day,
    sleepTime: {
      ...(status ? { status } : {}),
      ...(recommendation ? { recommendation } : {}),
      ...(window ? { window } : {}),
    } satisfies SleepTime,
  };
};

const parseScoreDoc = (doc: unknown) => {
  if (!isObject(doc) || typeof doc.day !== "string") return undefined;
  const day = parseIsoDate(doc.day).unwrapOr(undefined);
  const score = numberOr(doc.score);
  return day && score !== undefined ? { day, score } : undefined;
};

export type OuraCollections = { sleep: readonly unknown[]; dailySleep: readonly unknown[]; sleepTime: readonly unknown[] };

export const healthDaysFrom = ({ sleep, dailySleep, sleepTime }: OuraCollections) => {
  const days = new Map<IsoDate, HealthDay>();
  const dayOf = (day: IsoDate) => {
    const existing = days.get(day);
    if (existing) return existing;
    const fresh: HealthDay = { day };
    days.set(day, fresh);
    return fresh;
  };
  const longest = new Map<IsoDate, number>();
  for (const doc of sleep.map(parseSleepDoc)) {
    if (!doc || (longest.get(doc.day) ?? -1) >= doc.timeInBed) continue;
    longest.set(doc.day, doc.timeInBed);
    const day = dayOf(doc.day);
    day.sleep = doc.period;
    if (doc.readinessScore === undefined) delete day.readinessScore;
    else day.readinessScore = doc.readinessScore;
  }
  for (const doc of dailySleep.map(parseScoreDoc)) if (doc) dayOf(doc.day).sleepScore = doc.score;
  for (const doc of sleepTime.map(parseSleepTimeDoc)) if (doc) dayOf(doc.day).sleepTime = doc.sleepTime;
  return [...days.values()].toSorted((a, b) => (a.day < b.day ? -1 : 1));
};

const median = (values: readonly number[]) => {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

const roundTo5 = (minute: number) => Math.round(minute / 5) * 5;

export const wakeMinuteOf = (period: SleepPeriod) => {
  const local = (period.end + period.offsetMinutes * MINUTE_MS) / MINUTE_MS;
  return ((local % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
};

export const usualSleep = (periods: readonly SleepPeriod[]) => {
  const recent = periods.slice(0, USUAL_NIGHTS);
  if (recent.length < MIN_USUAL_NIGHTS) return null;
  const wakes = recent.map(wakeMinuteOf);
  const beds = recent.map((period, index) => (wakes[index] ?? 0) - (period.end - period.start) / MINUTE_MS);
  return { bedMinute: roundTo5(median(beds)), wakeMinute: roundTo5(median(wakes)), nights: recent.length };
};

export type Usual = NonNullable<ReturnType<typeof usualSleep>>;

export type SleepPlan = {
  bedtime: { source: "oura"; startMinute: number; endMinute: number } | { source: "usual"; startMinute: number };
  wakeMinute: number;
};

export const sleepPlan = (window: BedtimeWindow | undefined, usual: Usual | null) => {
  if (!usual) return null;
  const bedtime: SleepPlan["bedtime"] = window
    ? { source: "oura", startMinute: Math.round(window.startOffset / 60), endMinute: Math.round(window.endOffset / 60) }
    : { source: "usual", startMinute: usual.bedMinute };
  return bedtime.startMinute < usual.wakeMinute ? ({ bedtime, wakeMinute: usual.wakeMinute } satisfies SleepPlan) : null;
};

export type SleepNight =
  | {
      kind: "slept";
      wakeDate: IsoDate;
      start: number;
      end: number;
      asleepMinutes: number | null;
      sleepScore: number | null;
      readinessScore: number | null;
    }
  | {
      kind: "planned";
      wakeDate: IsoDate;
      start: number;
      end: number;
      bedtime: SleepPlan["bedtime"]["source"];
      latestBedtime: number | null;
    };

export const nightsBetween = (
  from: IsoDate,
  count: number,
  today: IsoDate,
  timeZone: string,
  recorded: ReadonlyMap<string, HealthDay>,
  plan: SleepPlan | null,
) =>
  Array.from({ length: count + 1 }, (_, index) => addDays(from, index)).flatMap<SleepNight>((wakeDate) => {
    const sleep = recorded.get(wakeDate)?.sleep;
    if (sleep) {
      const day = recorded.get(wakeDate);
      const slept: SleepNight = {
          kind: "slept",
          wakeDate,
          start: sleep.start,
          end: sleep.end,
          asleepMinutes: sleep.asleepMinutes ?? null,
          sleepScore: day?.sleepScore ?? null,
          readinessScore: day?.readinessScore ?? null,
      };
      return [slept];
    }
    if (!plan || wakeDate < today) return [];
    const { bedtime } = plan;
    const planned: SleepNight = {
        kind: "planned",
        wakeDate,
        start: zonedMoment(wakeDate, bedtime.startMinute, timeZone),
        end: zonedMoment(wakeDate, plan.wakeMinute, timeZone),
        bedtime: bedtime.source,
        latestBedtime: bedtime.source === "oura" ? zonedMoment(wakeDate, bedtime.endMinute, timeZone) : null,
    };
    return [planned];
  });

export const parseDayCount = (days: number) =>
  Number.isInteger(days) && days >= 1 && days <= 62 ? ok<number, { kind: "invalid_range" }>(days) : err<number, { kind: "invalid_range" }>({ kind: "invalid_range" });
