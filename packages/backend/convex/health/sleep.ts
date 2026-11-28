import { v } from "convex/values";
import { Effect, Result } from "effect";
import type { QueryCtx } from "../_generated/server";
import { parseTimeZoneFx } from "../calendar/model";
import { addDays, type IsoDate } from "../../shared/date";
import { parseIsoDate } from "../../shared/effect/date";
import { asWire } from "../../shared/effect/wire";
import { ownerQuery, reading } from "../platform/effect";
import { InvalidHealthRange } from "./errors";
import { nightsBetween, parseDayCount, sleepPlan, usualSleep, USUAL_NIGHTS } from "./model";
import { ouraConfigured } from "./oura";

const RECENT_ROWS = 30;

const recentDays = (ctx: QueryCtx, today: IsoDate) =>
  ctx.db
    .query("healthDays")
    .withIndex("by_source_and_day", (q) => q.eq("source", "oura").lte("day", addDays(today, 1)))
    .order("desc")
    .take(RECENT_ROWS);

const planFor = async (ctx: QueryCtx, today: IsoDate) => {
  const recent = await recentDays(ctx, today);
  const slept = recent.flatMap((row) => (row.sleep && row.day <= today ? [row.sleep] : []));
  const latest = recent.find((row) => row.sleepTime);
  const window = recent.find((row) => row.sleepTime?.window)?.sleepTime?.window;
  const usual = usualSleep(slept.slice(0, USUAL_NIGHTS));
  return {
    plan: sleepPlan(window, usual),
    ouraStatus: latest?.sleepTime?.status ?? null,
    recommendation: latest?.sleepTime?.recommendation ?? null,
    nightsCounted: usual?.nights ?? slept.length,
  };
};

const parseArgs = (args: { from: string; days: number; today: string; timeZone: string }) =>
  Result.all([
    Result.mapError(parseIsoDate(args.from), () => new InvalidHealthRange()),
    parseDayCount(args.days),
    Result.mapError(parseIsoDate(args.today), () => new InvalidHealthRange()),
    Result.mapError(parseTimeZoneFx(args.timeZone), () => new InvalidHealthRange()),
  ]);

const nightsFor = async (ctx: QueryCtx, from: IsoDate, count: number, today: IsoDate, timeZone: string) => {
  const recorded = await ctx.db
    .query("healthDays")
    .withIndex("by_source_and_day", (q) => q.eq("source", "oura").gte("day", from).lte("day", addDays(from, count)))
    .take(count + 1);
  const { plan } = await planFor(ctx, today);
  return nightsBetween(from, count, today, timeZone, new Map(recorded.map((row) => [row.day, row])), plan);
};

export const nights = ownerQuery({
  args: { from: v.string(), days: v.number(), today: v.string(), timeZone: v.string() },
  handler: Effect.fn("sleep.nights")(function* (args) {
    const [from, count, today, timeZone] = yield* Effect.fromResult(parseArgs(args));
    return yield* reading((ctx) => nightsFor(ctx, from, count, today, timeZone));
  }, asWire),
});

export const status = ownerQuery({
  args: { today: v.string() },
  handler: Effect.fn("sleep.status")(function* (args) {
    const connection = yield* reading((ctx) => ctx.db.query("ouraConnection").first());
    const today = Result.getOrNull(parseIsoDate(args.today));
    const summary = connection && today ? yield* reading((ctx) => planFor(ctx, today)) : null;
    return {
      setup: !ouraConfigured() ? ("not_configured" as const) : connection ? ("connected" as const) : ("not_connected" as const),
      sync: connection?.sync ?? null,
      plan: summary?.plan ?? null,
      ouraStatus: summary?.ouraStatus ?? null,
      recommendation: summary?.recommendation ?? null,
      nightsCounted: summary?.nightsCounted ?? 0,
    };
  }),
});
