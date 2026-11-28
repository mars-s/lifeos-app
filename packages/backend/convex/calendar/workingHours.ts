import { v } from "convex/values";
import { Effect } from "effect";
import type { QueryCtx } from "../_generated/server";
import { changeMutation, ownerQuery, reading, recording } from "../platform/effect";
import { DEFAULT_WORKING_HOURS, parseWorkingHours } from "./model";

export const workingHoursOf = async (ctx: QueryCtx) => {
  const row = await ctx.db.query("workingHours").first();
  return row ? { startMinute: row.startMinute, endMinute: row.endMinute } : DEFAULT_WORKING_HOURS;
};

export const get = ownerQuery({
  args: {},
  handler: () => reading(workingHoursOf),
});

export const set = changeMutation({
  action: "calendar.workingHours",
  args: { startMinute: v.number(), endMinute: v.number() },
  handler: Effect.fn("workingHours.set")(function* (hours) {
    const valid = yield* Effect.fromResult(parseWorkingHours(hours));
    const row = yield* reading((ctx) => ctx.db.query("workingHours").first());
    if (row) yield* recording((record) => record.patch("workingHours", row._id, valid));
    else yield* recording((record) => record.insert("workingHours", valid));
    return { ...valid };
  }),
});
