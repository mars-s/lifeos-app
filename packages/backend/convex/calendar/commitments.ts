import { v } from "convex/values";
import { err, ok } from "neverthrow";
import type { QueryCtx } from "../_generated/server";
import { ownerQuery } from "../platform/access";
import { serialise } from "../../shared/result";
import { DAY_MS, MAX_COMMITMENT_SPAN_MS, type CalendarError } from "./model";

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

export const parseRange = (from: number, to: number) =>
  Number.isFinite(from) && Number.isFinite(to) && to > from && to - from <= MAX_RANGE_MS
    ? ok<{ from: number; to: number }, CalendarError>({ from, to })
    : err<{ from: number; to: number }, CalendarError>({ kind: "invalid_range" });

export const range = ownerQuery({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from, to }) =>
    serialise(await parseRange(from, to).asyncMap((window) => commitmentsBetween(ctx, window.from, window.to))),
});
