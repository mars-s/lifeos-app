import { v } from "convex/values";
import { internalQuery, query, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { parseIsoDate, type IsoDate } from "../shared/date";
import { serialise } from "../shared/result";

const rank = (task: Doc<"tasks">) => (task.list === "today" ? 0 : 1);

const loadToday = async (ctx: QueryCtx, date: IsoDate) => {
  const [today, startingNow, dueNow, areas, projects] = await Promise.all([
    ctx.db.query("tasks").withIndex("by_list", (q) => q.eq("list", "today")).collect(),
    ctx.db
      .query("tasks")
      .withIndex("by_list_scheduledFor", (q) => q.eq("list", "upcoming").lte("scheduledFor", date))
      .collect(),
    ctx.db.query("tasks").withIndex("by_deadline", (q) => q.gt("deadline", "").lte("deadline", date)).collect(),
    ctx.db.query("areas").collect(),
    ctx.db.query("projects").collect(),
  ]);
  const areaTitle = new Map(areas.map((area) => [area.thingsId, area.title]));
  const project = new Map(projects.map((p) => [p.thingsId, p]));
  const contextOf = (task: Doc<"tasks">) => {
    const parent = task.projectThingsId ? project.get(task.projectThingsId) : undefined;
    const areaId = task.areaThingsId ?? parent?.areaThingsId;
    return parent?.title ?? (areaId ? areaTitle.get(areaId) : undefined);
  };
  const unique = new Map(
    [...today, ...startingNow, ...dueNow]
      .filter((task) => task.status === "open" && task.list !== "someday")
      .map((task) => [task.thingsId, task]),
  );
  const tasks = [...unique.values()]
    .toSorted((a, b) => rank(a) - rank(b) || a.position - b.position)
    .map((task) => ({ ...task, context: contextOf(task) }));
  return { date, tasks };
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
