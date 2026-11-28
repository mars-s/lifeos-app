import { v } from "convex/values";
import { Effect, Result } from "effect";
import type { QueryCtx } from "../_generated/server";
import { addDays, type IsoDate } from "../../shared/date";
import { parseIsoDate } from "../../shared/effect/date";
import { asWire } from "../../shared/effect/wire";
import { ownerQuery, reading } from "../platform/effect";
import { commitmentsBetween } from "./commitments";
import { InvalidCalendarRange } from "./errors";
import { capacityOfDay, parseTimeZoneFx, workingWindow } from "./model";
import { workingHoursOf } from "./workingHours";

const MAX_DAYS = 62;

const parseDays = (days: number) => {
  const parsed: Result.Result<number, InvalidCalendarRange> =
    Number.isInteger(days) && days >= 1 && days <= MAX_DAYS ? Result.succeed(days) : Result.fail(new InvalidCalendarRange());
  return parsed;
};

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
  handler: Effect.fn("capacity.days")(function* (args) {
    const from = yield* Effect.fromResult(Result.mapError(parseIsoDate(args.from), () => new InvalidCalendarRange()));
    const count = yield* Effect.fromResult(parseDays(args.days));
    const timeZone = yield* Effect.fromResult(parseTimeZoneFx(args.timeZone));
    return yield* reading((ctx) => capacityDays(ctx, from, count, timeZone));
  }, asWire),
});
