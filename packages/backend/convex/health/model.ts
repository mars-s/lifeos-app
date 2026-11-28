import { Effect, Option, Result, Schema } from "effect";
import { addDays, type IsoDate } from "../../shared/date";
import { parseIsoDate } from "../../shared/effect/date";
import { zonedMoment } from "../calendar/model";
import { InvalidHealthRange } from "./errors";
import {
  BEDTIME_RECOMMENDATIONS,
  BEDTIME_STATUSES,
  type BedtimeWindow,
  type HealthDay,
  type SleepPeriod,
  type SleepTime,
} from "./tables";

export const MINUTE_MS = 60_000;
export const DAY_MINUTES = 24 * 60;
export const USUAL_NIGHTS = 14;
export const MIN_USUAL_NIGHTS = 3;

const soft = <S extends Schema.Constraint>(schema: S) =>
  Schema.UndefinedOr(schema).pipe(Schema.catchDecoding(() => Effect.succeed(Option.some(undefined))));

export const OuraPage = Schema.Struct({
  data: Schema.Array(Schema.Unknown),
  next_token: Schema.optional(soft(Schema.NonEmptyString)),
});

const LOCAL_OFFSET = /(?:([+-])(\d{2}):?(\d{2})|Z)$/;

export const parseLocalTime = (value: string) => {
  const at = Date.parse(value);
  const zone = LOCAL_OFFSET.exec(value);
  if (!Number.isFinite(at) || !zone) return undefined;
  const [, sign, hours, minutes] = zone;
  const offsetMinutes = sign ? (sign === "-" ? -1 : 1) * (Number(hours) * 60 + Number(minutes)) : 0;
  return { at, offsetMinutes };
};

const SleepDocument = Schema.Struct({
  type: Schema.Literal("long_sleep"),
  day: Schema.String,
  bedtime_start: Schema.String,
  bedtime_end: Schema.String,
  total_sleep_duration: Schema.optional(soft(Schema.Finite)),
  time_in_bed: Schema.optional(soft(Schema.Finite)),
  readiness: Schema.optional(soft(Schema.Struct({ score: Schema.optional(soft(Schema.Finite)) }))),
});

const Window = Schema.Struct({ start_offset: Schema.Finite, end_offset: Schema.Finite, day_tz: Schema.Finite });

const SleepTimeDocument = Schema.Struct({
  day: Schema.String,
  status: Schema.optional(soft(Schema.Literals(BEDTIME_STATUSES))),
  recommendation: Schema.optional(soft(Schema.Literals(BEDTIME_RECOMMENDATIONS))),
  optimal_bedtime: Schema.optional(soft(Window)),
});

const ScoreDocument = Schema.Struct({ day: Schema.String, score: Schema.Finite });

const decodeSleep = Schema.decodeUnknownOption(SleepDocument);
const decodeSleepTime = Schema.decodeUnknownOption(SleepTimeDocument);
const decodeScore = Schema.decodeUnknownOption(ScoreDocument);

const dayOf = (day: string) => Result.getOrUndefined(parseIsoDate(day));

type SleepDoc = { day: IsoDate; period: SleepPeriod; timeInBed: number; readinessScore: number | undefined };

const parseSleepDoc = (doc: unknown) => {
  const decoded = Option.getOrUndefined(decodeSleep(doc));
  if (!decoded) return undefined;
  const day = dayOf(decoded.day);
  const start = parseLocalTime(decoded.bedtime_start);
  const end = parseLocalTime(decoded.bedtime_end);
  if (!day || !start || !end || end.at <= start.at) return undefined;
  const asleep = decoded.total_sleep_duration;
  return {
    day,
    period: {
      start: start.at,
      end: end.at,
      offsetMinutes: end.offsetMinutes,
      ...(asleep === undefined ? {} : { asleepMinutes: Math.round(asleep / 60) }),
    },
    timeInBed: decoded.time_in_bed ?? (end.at - start.at) / 1000,
    readinessScore: decoded.readiness?.score,
  } satisfies SleepDoc;
};

const parseSleepTimeDoc = (doc: unknown) => {
  const decoded = Option.getOrUndefined(decodeSleepTime(doc));
  const day = decoded && dayOf(decoded.day);
  if (!decoded || !day) return undefined;
  const bedtime = decoded.optimal_bedtime;
  const window =
    bedtime && bedtime.end_offset >= bedtime.start_offset
      ? ({ startOffset: bedtime.start_offset, endOffset: bedtime.end_offset, dayTz: bedtime.day_tz } satisfies BedtimeWindow)
      : undefined;
  return {
    day,
    sleepTime: {
      ...(decoded.status ? { status: decoded.status } : {}),
      ...(decoded.recommendation ? { recommendation: decoded.recommendation } : {}),
      ...(window ? { window } : {}),
    } satisfies SleepTime,
  };
};

const parseScoreDoc = (doc: unknown) => {
  const decoded = Option.getOrUndefined(decodeScore(doc));
  const day = decoded && dayOf(decoded.day);
  return decoded && day ? { day, score: decoded.score } : undefined;
};

export type OuraCollections = { sleep: readonly unknown[]; dailySleep: readonly unknown[]; sleepTime: readonly unknown[] };

export const healthDaysFrom = ({ sleep, dailySleep, sleepTime }: OuraCollections) => {
  const days = new Map<IsoDate, HealthDay>();
  const dayRecord = (day: IsoDate) => {
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
    const day = dayRecord(doc.day);
    day.sleep = doc.period;
    if (doc.readinessScore === undefined) delete day.readinessScore;
    else day.readinessScore = doc.readinessScore;
  }
  for (const doc of dailySleep.map(parseScoreDoc)) if (doc) dayRecord(doc.day).sleepScore = doc.score;
  for (const doc of sleepTime.map(parseSleepTimeDoc)) if (doc) dayRecord(doc.day).sleepTime = doc.sleepTime;
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

export const parseDayCount = (days: number) => {
  const parsed: Result.Result<number, InvalidHealthRange> =
    Number.isInteger(days) && days >= 1 && days <= 62 ? Result.succeed(days) : Result.fail(new InvalidHealthRange());
  return parsed;
};
