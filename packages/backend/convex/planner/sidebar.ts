import { v } from "convex/values";
import type { QueryCtx } from "../_generated/server";
import { ownerQuery } from "../platform/access";
import type { Doc } from "../_generated/dataModel";
import { parseIsoDate, type IsoDate } from "../../shared/date";
import { serialise } from "../../shared/result";
import { areaSummary, loadContainers, projectProgress, projectSummary } from "./rows";
import { openTodayTasks } from "./today";

const COUNT_LIMIT = 1000;

const projectEntry = async (ctx: QueryCtx, project: Doc<"projects">) => ({
  ...projectSummary(project),
  someday: project.when.kind === "someday",
  progress: await projectProgress(ctx, project._id),
});

const loadSidebar = async (ctx: QueryCtx, date: IsoDate) => {
  const [inbox, today, { standalone, areas }] = await Promise.all([
    ctx.db
      .query("tasks")
      .withIndex("by_trashed_status_when", (q) => q.eq("trashedAt", undefined).eq("status.kind", "open").eq("when.kind", "inbox"))
      .take(COUNT_LIMIT),
    openTodayTasks(ctx, date),
    loadContainers(ctx),
  ]);
  return {
    counts: { inbox: inbox.length, today: today.length },
    projects: await Promise.all(standalone.map((project) => projectEntry(ctx, project))),
    areas: await Promise.all(
      areas.map(async ({ area, projects }) => ({
        ...areaSummary(area),
        projects: await Promise.all(projects.map((project) => projectEntry(ctx, project))),
      })),
    ),
  };
};

export const get = ownerQuery({
  args: { date: v.string() },
  handler: async (ctx, { date }) => serialise(await parseIsoDate(date).asyncMap((day) => loadSidebar(ctx, day))),
});
