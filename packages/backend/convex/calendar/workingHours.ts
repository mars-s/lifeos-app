import { v } from "convex/values";
import type { QueryCtx } from "../_generated/server";
import { ownerQuery } from "../platform/access";
import { changeMutation } from "../platform/change";
import { DEFAULT_WORKING_HOURS, parseWorkingHours, type WorkingHours } from "./model";

export const workingHoursOf = async (ctx: QueryCtx) => {
  const row = await ctx.db.query("workingHours").first();
  return row ? { startMinute: row.startMinute, endMinute: row.endMinute } : DEFAULT_WORKING_HOURS;
};

export const get = ownerQuery({
  args: {},
  handler: workingHoursOf,
});

export const set = changeMutation({
  action: "calendar.workingHours",
  args: { startMinute: v.number(), endMinute: v.number() },
  handler: async (ctx, hours, record) =>
    parseWorkingHours(hours).asyncMap(async (valid: WorkingHours) => {
      const row = await ctx.db.query("workingHours").first();
      if (row) await record.patch("workingHours", row._id, valid);
      else await record.insert("workingHours", valid);
      return { ...valid };
    }),
});
