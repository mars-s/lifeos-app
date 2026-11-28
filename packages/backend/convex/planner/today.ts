import { v } from "convex/values";
import { Effect } from "effect";
import type { QueryCtx } from "../_generated/server";
import { ownerQuery, reading } from "../platform/effect";
import type { Doc } from "../_generated/dataModel";
import { type IsoDate, parseIsoDate } from "../../shared/date";
import { asWire } from "../../shared/result";
import { byDayPlan } from "../../shared/plan";
import { compare, enrich } from "./rows";

const TODAY_LIMIT = 1000;

const thingsTodayRank = (task: Doc<"tasks">) => task.things?.todayIndex ?? Number.POSITIVE_INFINITY;

const scheduledDate = (task: Doc<"tasks">) => (task.when.kind === "scheduled" ? task.when.date : "9999-12-31");

export const byTodayOrder = (a: Doc<"tasks">, b: Doc<"tasks">) =>
  compare(thingsTodayRank(a), thingsTodayRank(b)) ||
  compare(scheduledDate(a), scheduledDate(b)) ||
  compare(a.deadline ?? "9999-12-31", b.deadline ?? "9999-12-31") ||
  compare(a.order, b.order);

const isEvening = (task: { when: Doc<"tasks">["when"] }) => task.when.kind === "scheduled" && task.when.evening;

export const openTodayTasks = async (ctx: QueryCtx, date: IsoDate) => {
  const [scheduled, due] = await Promise.all([
    ctx.db
      .query("tasks")
      .withIndex("by_trashed_status_when", (q) =>
        q.eq("trashedAt", undefined).eq("status.kind", "open").eq("when.kind", "scheduled").lte("when.date", date),
      )
      .take(TODAY_LIMIT),
    ctx.db
      .query("tasks")
      .withIndex("by_trashed_status_deadline", (q) =>
        q.eq("trashedAt", undefined).eq("status.kind", "open").gt("deadline", "").lte("deadline", date),
      )
      .take(TODAY_LIMIT),
  ]);
  return [...new Map([...scheduled, ...due].map((task) => [task._id, task])).values()]
    .filter((task) => task.when.kind !== "someday")
    .toSorted(byDayPlan(date, byTodayOrder));
};

const loadToday = async (ctx: QueryCtx, date: IsoDate) => {
  const ordered = await enrich(ctx, await openTodayTasks(ctx, date));
  return {
    date,
    tasks: ordered.filter((task) => !isEvening(task)),
    evening: ordered.filter(isEvening),
  };
};

export const get = ownerQuery({
  args: { date: v.string() },
  handler: ({ date }) => asWire(Effect.flatMap(Effect.fromResult(parseIsoDate(date)), (day) => reading((ctx) => loadToday(ctx, day)))),
});
