import { v } from "convex/values";
import { Effect, Result } from "effect";
import { parseTimeZoneFx, zonedIso, zonedMoment } from "../calendar/model";
import type { QueryCtx } from "../_generated/server";
import { addDays, daysBetween, type IsoDate } from "../../shared/date";
import { parseIsoDate } from "../../shared/effect/date";
import { asWire } from "../../shared/effect/wire";
import { ownerQuery, reading } from "../platform/effect";
import { InvalidHealthRange } from "./errors";
import { DAY_MINUTES, MINUTE_MS, USUAL_NIGHTS, usualSleep } from "./model";
import type { HealthDay, OuraSync, SleepPeriod } from "./tables";

export const ENERGY_NIGHTS = 5;
export const ENERGY_STEP_MINUTES = 15;
export const SLEEP_NEED_MINUTES = 480;
export const SHORT_NIGHT_MINUTES = 360;
const LOOKBACK_DAYS = 30;
const MAX_RANGE_DAYS = 62;
const HOUR_MS = 60 * MINUTE_MS;

const PRESSURE = { riseHours: 18.2, fallHours: 4.2, dayHours: 16 };
const INERTIA = { depth: 0.45, fadeHours: 0.8 };
const RHYTHM = { daily: 0.3, dailyPeakAfterWake: 9.4, half: 0.24, halfPeakAfterWake: 1.9 };
const QUALITY = { shortNight: 0.3, shortNightSpan: 240, debt: 0.15, debtSpan: 900, floor: 0.4, low: 0.75 };
const READINESS = { centre: 75, span: 250, lowest: -0.1, highest: 0.06 };
const PEAK_HOURS = { from: 1, to: 7 };
const DIP_HOURS = { from: 5, to: 11 };
const WINDOW_TOLERANCE = 0.03;
const DAY_LENGTH = { shortest: 10 * 60, longest: 20 * 60 };

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

const bedPressure = (() => {
  const day = Math.exp(-PRESSURE.dayHours / PRESSURE.riseHours);
  const night = Math.exp(-(DAY_MINUTES / 60 - PRESSURE.dayHours) / PRESSURE.fallHours);
  return (1 - day) / (1 - day * night);
})();

const pressureAtWake = (asleepMinutes: number) => bedPressure * Math.exp(-asleepMinutes / 60 / PRESSURE.fallHours);

const alertness = (hoursAwake: number, wakePressure: number) => {
  const rhythm =
    RHYTHM.daily * Math.cos((2 * Math.PI * (hoursAwake - RHYTHM.dailyPeakAfterWake)) / 24) +
    RHYTHM.half * Math.cos((4 * Math.PI * (hoursAwake - RHYTHM.halfPeakAfterWake)) / 24);
  const pressure = 1 - (1 - wakePressure) * Math.exp(-hoursAwake / PRESSURE.riseHours);
  const inertia = INERTIA.depth * Math.exp(-hoursAwake / INERTIA.fadeHours);
  return rhythm - pressure - inertia;
};

const reference = (() => {
  const wakePressure = pressureAtWake(SLEEP_NEED_MINUTES);
  const samples = Array.from({ length: PRESSURE.dayHours * 4 + 1 }, (_, index) => alertness(index / 4, wakePressure));
  return { low: Math.min(...samples), high: Math.max(...samples) };
})();

const levelAt = (hoursAwake: number, wakePressure: number, quality: number) => {
  const shape = (alertness(hoursAwake, wakePressure) - reference.low) / (reference.high - reference.low);
  return Math.round(clamp(shape * quality, 0, 1) * 1000) / 1000;
};

const asleepOf = (period: SleepPeriod) => period.asleepMinutes ?? Math.round((period.end - period.start) / MINUTE_MS);

export const sleepDebt = (asleepMostRecentFirst: readonly number[]) =>
  Math.round(
    asleepMostRecentFirst
      .slice(0, USUAL_NIGHTS)
      .reduce((debt, asleep, index) => debt + ((USUAL_NIGHTS - index) / USUAL_NIGHTS) * Math.max(0, SLEEP_NEED_MINUTES - asleep), 0),
  );

const qualityOf = (asleepMinutes: number, debtMinutes: number, readiness: number | undefined) => {
  const shortNight = clamp((SLEEP_NEED_MINUTES - asleepMinutes) / QUALITY.shortNightSpan, 0, 1);
  const debt = clamp(debtMinutes / QUALITY.debtSpan, 0, 1);
  const shift = readiness === undefined ? 0 : clamp((readiness - READINESS.centre) / READINESS.span, READINESS.lowest, READINESS.highest);
  return clamp(1 - QUALITY.shortNight * shortNight - QUALITY.debt * debt + shift, QUALITY.floor, 1);
};

const median = (values: readonly number[]) => {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

const wallMinuteOf = (instant: number, date: IsoDate, timeZone: string) => {
  const iso = zonedIso(instant, timeZone);
  const day = Result.getOrElse(parseIsoDate(iso.slice(0, 10)), () => date);
  return daysBetween(date, day) * DAY_MINUTES + Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
};

const quartersBetween = (wake: number, bedtime: number) => {
  const first = Math.floor(wake / ENERGY_STEP_MINUTES) * ENERGY_STEP_MINUTES + ENERGY_STEP_MINUTES;
  const inner = Array.from({ length: Math.max(0, Math.ceil((bedtime - first) / ENERGY_STEP_MINUTES)) }, (_, index) => first + index * ENERGY_STEP_MINUTES);
  return [wake, ...inner.filter((minute) => minute < bedtime), bedtime];
};

export type EnergyPoint = { minute: number; level: number };
export type EnergyWindow = { start: number; end: number };

const windowAround = (points: readonly (EnergyPoint & { hours: number })[], range: { from: number; to: number }, better: (a: number, b: number) => boolean) => {
  const inRange = points.flatMap((point, index) => (point.hours >= range.from && point.hours <= range.to ? [index] : []));
  const best = inRange.reduce((chosen, index) => (better(points[index]?.level ?? 0, points[chosen]?.level ?? 0) ? index : chosen), inRange[0] ?? 0);
  const target = points[best]?.level ?? 0;
  const close = (index: number) => inRange.includes(index) && Math.abs((points[index]?.level ?? 0) - target) <= WINDOW_TOLERANCE;
  let start = best;
  let end = best;
  while (close(start - 1)) start -= 1;
  while (close(end + 1)) end += 1;
  return { start: points[start]?.minute ?? 0, end: points[end]?.minute ?? 0 } satisfies EnergyWindow;
};

export type EnergyReading = { asleepMinutes?: number; readiness?: number; debtMinutes: number; nights: number; syncedAt?: number };

export type EnergyCurve = {
  kind: "solid" | "usual";
  points: EnergyPoint[];
  wake: number;
  bedtime: number;
  bedtimeFrom: "oura" | "usual";
  peak: EnergyWindow;
  dip: EnergyWindow;
  low: boolean;
  reading: EnergyReading;
};

export type EnergyDay =
  | ({ date: IsoDate } & EnergyCurve)
  | { date: IsoDate; kind: "learning"; reading: { nights: number } }
  | { date: IsoDate; kind: "none" };

export type OuraLink = { syncedAt: number | undefined } | null;

export type EnergyInput = {
  date: IsoDate;
  today: IsoDate;
  timeZone: string;
  days: readonly HealthDay[];
  oura: OuraLink;
};

export const energyDay = ({ date, today, timeZone, days, oura }: EnergyInput) => {
  if (!oura) return { date, kind: "none" } satisfies EnergyDay;
  const startedFrom = date < today ? date : today;
  const known = days
    .filter((day) => day.day <= startedFrom && day.day > addDays(startedFrom, -LOOKBACK_DAYS))
    .toSorted((a, b) => (a.day < b.day ? 1 : -1));
  const nights = known.flatMap((day) => (day.sleep ? [day.sleep] : [])).slice(0, USUAL_NIGHTS);
  const usual = usualSleep(nights);
  if (!usual || nights.length < ENERGY_NIGHTS) return { date, kind: "learning", reading: { nights: nights.length } } satisfies EnergyDay;

  const own = date <= today ? known.find((day) => day.day === date) : undefined;
  const slept = own?.sleep;
  const asleepMinutes = slept ? asleepOf(slept) : Math.round(median(nights.map(asleepOf)));
  const wakeInstant = slept ? slept.end : zonedMoment(date, usual.wakeMinute, timeZone);
  const wake = slept ? wallMinuteOf(slept.end, date, timeZone) : usual.wakeMinute;
  const window = known.find((day) => day.sleepTime?.window)?.sleepTime?.window;
  const planned = DAY_MINUTES + (window ? Math.round(window.startOffset / 60) : usual.bedMinute);
  const bedtime = clamp(planned, wake + DAY_LENGTH.shortest, wake + DAY_LENGTH.longest);

  const debtMinutes = sleepDebt(nights.map(asleepOf));
  const readiness = slept ? own?.readinessScore : undefined;
  const quality = qualityOf(asleepMinutes, debtMinutes, readiness);
  const wakePressure = pressureAtWake(asleepMinutes);
  const sampled = quartersBetween(wake, bedtime).map((minute) => {
    const hours = (zonedMoment(date, minute, timeZone) - wakeInstant) / HOUR_MS;
    return { minute, hours, level: levelAt(hours, wakePressure, quality) };
  });

  return {
    date,
    kind: slept ? "solid" : "usual",
    points: sampled.map(({ minute, level }) => ({ minute, level })),
    wake,
    bedtime,
    bedtimeFrom: window ? "oura" : "usual",
    peak: windowAround(sampled, PEAK_HOURS, (a, b) => a > b),
    dip: windowAround(sampled, DIP_HOURS, (a, b) => a < b),
    low: asleepMinutes < SHORT_NIGHT_MINUTES || quality < QUALITY.low,
    reading: {
      ...(slept ? { asleepMinutes } : {}),
      ...(readiness === undefined ? {} : { readiness }),
      debtMinutes,
      nights: nights.length,
      ...(oura.syncedAt === undefined ? {} : { syncedAt: oura.syncedAt }),
    },
  } satisfies EnergyDay;
};

const lastSyncOf = (sync: OuraSync) => (sync.kind === "ok" ? sync.at : sync.kind === "failed" ? sync.lastOkAt : undefined);

const parseRange = (from: IsoDate, to: IsoDate) => {
  const span = daysBetween(from, to);
  const parsed: Result.Result<number, InvalidHealthRange> =
    span >= 0 && span < MAX_RANGE_DAYS ? Result.succeed(span) : Result.fail(new InvalidHealthRange());
  return parsed;
};

const parseArgs = (args: { from: string; to: string; today: string; timeZone: string }) =>
  Result.gen(function* () {
    const from = yield* Result.mapError(parseIsoDate(args.from), () => new InvalidHealthRange());
    const to = yield* Result.mapError(parseIsoDate(args.to), () => new InvalidHealthRange());
    const today = yield* Result.mapError(parseIsoDate(args.today), () => new InvalidHealthRange());
    const timeZone = yield* Result.mapError(parseTimeZoneFx(args.timeZone), () => new InvalidHealthRange());
    const span = yield* parseRange(from, to);
    return { from, span, today, timeZone };
  });

export const energyDays = async (ctx: QueryCtx, { from, span, today, timeZone }: { from: IsoDate; span: number; today: IsoDate; timeZone: string }) => {
  const connection = await ctx.db.query("ouraConnection").first();
  const oura: OuraLink = connection ? { syncedAt: lastSyncOf(connection.sync) } : null;
  const last = addDays(from, span);
  const newest = last < today ? last : today;
  const oldest = addDays(from < today ? from : today, -LOOKBACK_DAYS);
  const rows = oura
    ? await ctx.db
        .query("healthDays")
        .withIndex("by_source_and_day", (q) => q.eq("source", "oura").gt("day", oldest).lte("day", newest))
        .take(LOOKBACK_DAYS + MAX_RANGE_DAYS + 1)
    : [];
  return Array.from({ length: span + 1 }, (_, index) =>
    energyDay({ date: addDays(from, index), today, timeZone, days: rows, oura }),
  );
};

export const days = ownerQuery({
  args: { from: v.string(), to: v.string(), today: v.string(), timeZone: v.string() },
  handler: Effect.fn("energy.days")(function* (args) {
    const range = yield* Effect.fromResult(parseArgs(args));
    return yield* reading((ctx) => energyDays(ctx, range));
  }, asWire),
});
