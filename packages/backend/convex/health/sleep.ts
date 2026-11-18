import { v } from "convex/values";
import { Result } from "neverthrow";
import type { QueryCtx } from "../_generated/server";
import { parseTimeZone } from "../calendar/model";
import { ownerQuery } from "../platform/access";
import { addDays, parseIsoDate, type IsoDate } from "../../shared/date";
import { serialise } from "../../shared/result";
import { nightsBetween, parseDayCount, sleepPlan, usualSleep, USUAL_NIGHTS } from "./model";
import { ouraConfigured } from "./oura";

const RECENT_ROWS = 30;

type SleepError = { kind: "invalid_range" };

const invalidRange: SleepError = { kind: "invalid_range" };

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
  Result.combine([
    parseIsoDate(args.from).mapErr(() => invalidRange),
    parseDayCount(args.days),
    parseIsoDate(args.today).mapErr(() => invalidRange),
    parseTimeZone(args.timeZone).mapErr(() => invalidRange),
  ]);

export const nights = ownerQuery({
  args: { from: v.string(), days: v.number(), today: v.string(), timeZone: v.string() },
  handler: async (ctx, args) =>
    serialise(
      await parseArgs(args).asyncMap(async ([from, count, today, timeZone]) => {
        const recorded = await ctx.db
          .query("healthDays")
          .withIndex("by_source_and_day", (q) => q.eq("source", "oura").gte("day", from).lte("day", addDays(from, count)))
          .take(count + 1);
        const { plan } = await planFor(ctx, today);
        return nightsBetween(from, count, today, timeZone, new Map(recorded.map((row) => [row.day, row])), plan);
      }),
    ),
});

export const status = ownerQuery({
  args: { today: v.string() },
  handler: async (ctx, args) => {
    const connection = await ctx.db.query("ouraConnection").first();
    const today = parseIsoDate(args.today).unwrapOr(null);
    const summary = connection && today ? await planFor(ctx, today) : null;
    return {
      setup: !ouraConfigured() ? ("not_configured" as const) : connection ? ("connected" as const) : ("not_connected" as const),
      sync: connection?.sync ?? null,
      plan: summary?.plan ?? null,
      ouraStatus: summary?.ouraStatus ?? null,
      recommendation: summary?.recommendation ?? null,
      nightsCounted: summary?.nightsCounted ?? 0,
    };
  },
});
