import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "../_generated/server";
import { ownerQuery } from "../platform/access";
import type { Doc, Id } from "../_generated/dataModel";
import { parseIsoDate, type IsoDate } from "../../shared/date";
import { serialise } from "../../shared/result";

const TODAY_LIMIT = 1000;

const compare = <T extends string | number>(a: T, b: T) => (a < b ? -1 : a > b ? 1 : 0);

const thingsTodayRank = (task: Doc<"tasks">) =>
  task.things?.list === "today" ? task.things.index : Number.POSITIVE_INFINITY;

const scheduledDate = (task: Doc<"tasks">) => (task.when.kind === "scheduled" ? task.when.date : "9999-12-31");

const byTodayOrder = (a: Doc<"tasks">, b: Doc<"tasks">) =>
  compare(thingsTodayRank(a), thingsTodayRank(b)) ||
  compare(scheduledDate(a), scheduledDate(b)) ||
  compare(a.deadline ?? "9999-12-31", b.deadline ?? "9999-12-31") ||
  compare(a.order, b.order);

const isEvening = (task: Doc<"tasks">) => task.when.kind === "scheduled" && task.when.evening;

const contextTitles = async (ctx: QueryCtx, tasks: Doc<"tasks">[]) => {
  const projectIds = new Set<Id<"projects">>();
  const areaIds = new Set<Id<"areas">>();
  for (const { parent } of tasks) {
    if (parent.kind === "project") projectIds.add(parent.projectId);
    if (parent.kind === "area") areaIds.add(parent.areaId);
  }
  const projects = new Map(
    (await Promise.all([...projectIds].map((id) => ctx.db.get("projects", id)))).flatMap((p) => (p ? [[p._id, p] as const] : [])),
  );
  const areas = new Map(
    (await Promise.all([...areaIds].map((id) => ctx.db.get("areas", id)))).flatMap((a) => (a ? [[a._id, a.title] as const] : [])),
  );
  return (task: Doc<"tasks">) => {
    if (task.parent.kind === "area") return areas.get(task.parent.areaId);
    if (task.parent.kind === "project") return projects.get(task.parent.projectId)?.title;
    return undefined;
  };
};

const loadToday = async (ctx: QueryCtx, date: IsoDate) => {
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
  const unique = [...new Map([...scheduled, ...due].map((task) => [task._id, task])).values()].filter(
    (task) => task.when.kind !== "someday",
  );
  const contextOf = await contextTitles(ctx, unique);
  const ordered = unique.toSorted(byTodayOrder).map((task) => ({ ...task, context: contextOf(task) }));
  return {
    date,
    tasks: ordered.filter((task) => !isEvening(task)),
    evening: ordered.filter(isEvening),
  };
};

const getToday = async (ctx: QueryCtx, date: string) =>
  serialise(await parseIsoDate(date).asyncMap((day) => loadToday(ctx, day)));

export const get = ownerQuery({
  args: { date: v.string() },
  handler: (ctx, { date }) => getToday(ctx, date),
});

export const getForAgent = internalQuery({
  args: { date: v.string() },
  handler: (ctx, { date }) => getToday(ctx, date),
});
