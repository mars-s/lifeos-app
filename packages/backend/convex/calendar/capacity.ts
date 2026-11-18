import { v } from "convex/values";
import { err, ok, Result } from "neverthrow";
import type { QueryCtx } from "../_generated/server";
import { ownerQuery } from "../platform/access";
import { addDays, parseIsoDate, type IsoDate } from "../../shared/date";
import { serialise } from "../../shared/result";
import { commitmentsBetween } from "./commitments";
import { capacityOfDay, parseTimeZone, workingWindow, type CalendarError } from "./model";
import { workingHoursOf } from "./workingHours";

const MAX_DAYS = 62;

const parseDays = (days: number) =>
  Number.isInteger(days) && days >= 1 && days <= MAX_DAYS
    ? ok<number, CalendarError>(days)
    : err<number, CalendarError>({ kind: "invalid_range" });

export const capacityDays = async (ctx: QueryCtx, from: IsoDate, days: number, timeZone: string) => {
  const hours = await workingHoursOf(ctx);
  const windows = Array.from({ length: days }, (_, index) => {
    const date = addDays(from, index);
    return { date, window: workingWindow(date, hours, timeZone) };
  });
  const first = windows[0]?.window.start ?? 0;
  const last = windows.at(-1)?.window.end ?? first;
  const commitments = await commitmentsBetween(ctx, first, last);
  return {
    workingHours: hours,
    days: windows.map(({ date, window }) => ({ date, ...capacityOfDay(window, commitments) })),
  };
};

export const days = ownerQuery({
  args: { from: v.string(), days: v.number(), timeZone: v.string() },
  handler: async (ctx, args) => {
    const from = parseIsoDate(args.from).mapErr(() => ({ kind: "invalid_range" }) satisfies CalendarError);
    const parsed = Result.combine([from, parseDays(args.days), parseTimeZone(args.timeZone)]);
    return serialise(await parsed.asyncMap(([date, count, timeZone]) => capacityDays(ctx, date, count, timeZone)));
  },
});
