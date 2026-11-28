import { v } from "convex/values";
import { Effect, Result } from "effect";
import type { QueryCtx } from "../_generated/server";
import { asWire } from "../../shared/result";
import { ownerQuery, reading } from "../platform/effect";
import { InvalidCalendarRange } from "./errors";
import { DAY_MS, MAX_COMMITMENT_SPAN_MS } from "./model";

const MAX_RANGE_MS = 100 * DAY_MS;
const COMMITMENT_LIMIT = 2000;
const CALENDAR_LIMIT = 200;

export const includedCalendars = async (ctx: QueryCtx) => {
  const calendars = await ctx.db.query("calendars").take(CALENDAR_LIMIT);
  return new Map(calendars.filter((calendar) => calendar.included).map((calendar) => [calendar.calendarId, calendar]));
};

export const commitmentsBetween = async (ctx: QueryCtx, from: number, to: number) => {
  const calendars = await includedCalendars(ctx);
  const rows = await ctx.db
    .query("externalCommitments")
    .withIndex("by_start", (q) => q.gte("start", from - MAX_COMMITMENT_SPAN_MS).lt("start", to))
    .take(COMMITMENT_LIMIT);
  return rows.flatMap((row) => {
    const calendar = calendars.get(row.calendarId);
    return calendar && row.end > from ? [{ ...row, calendar: { title: calendar.title, colour: calendar.colour } }] : [];
  });
};

export const parseRange = (from: number, to: number) => {
  const parsed: Result.Result<{ from: number; to: number }, InvalidCalendarRange> =
    Number.isFinite(from) && Number.isFinite(to) && to > from && to - from <= MAX_RANGE_MS
      ? Result.succeed({ from, to })
      : Result.fail(new InvalidCalendarRange());
  return parsed;
};

export const range = ownerQuery({
  args: { from: v.number(), to: v.number() },
  handler: Effect.fn("commitments.range")(function* ({ from, to }) {
    const window = yield* Effect.fromResult(parseRange(from, to));
    return yield* reading((ctx) => commitmentsBetween(ctx, window.from, window.to));
  }, asWire),
});
