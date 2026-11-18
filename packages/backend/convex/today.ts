import { v } from "convex/values";
import { internalQuery, query, type QueryCtx } from "./_generated/server";
import { parseIsoDate, type IsoDate } from "../shared/date";
import { serialise } from "../shared/result";

const loadToday = async (ctx: QueryCtx, date: IsoDate) => {
  const tasks = await ctx.db
    .query("tasks")
    .withIndex("by_scheduledFor", (q) => q.eq("scheduledFor", date))
    .collect();
  const openFirst = tasks.toSorted(
    (a, b) => Number(a.status === "done") - Number(b.status === "done") || a._creationTime - b._creationTime,
  );
  return { date, tasks: openFirst };
};

const getToday = async (ctx: QueryCtx, date: string) =>
  serialise(await parseIsoDate(date).asyncMap((day) => loadToday(ctx, day)));

export const get = query({
  args: { date: v.string() },
  handler: (ctx, { date }) => getToday(ctx, date),
});

export const getForAgent = internalQuery({
  args: { date: v.string() },
  handler: (ctx, { date }) => getToday(ctx, date),
});
