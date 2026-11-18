import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { QueryCtx } from "../_generated/server";
import { ownerQuery } from "../platform/access";
import type { Doc, Id } from "../_generated/dataModel";
import { addDays, parseIsoDate, type IsoDate } from "../../shared/date";
import { serialise } from "../../shared/result";
import {
  areaSummary,
  compare,
  enrich,
  isLive,
  loadContainers,
  progressOf,
  projectProgress,
  projectSummary,
  projectTasks,
  type TaskRow,
} from "./rows";
import type { When } from "./tables";

const LIST_LIMIT = 1000;
const HEADING_LIMIT = 200;
const TIMELINE_LIMIT = 2000;
const MAX_UPCOMING_DAYS = 90;

type Container =
  | { kind: "loose" }
  | { kind: "area"; area: ReturnType<typeof areaSummary> }
  | {
      kind: "project";
      project: ReturnType<typeof projectSummary>;
      progress: { done: number; total: number };
      area?: ReturnType<typeof areaSummary>;
    };

const openTasksWhen = (ctx: QueryCtx, kind: Exclude<When["kind"], "scheduled">) =>
  ctx.db
    .query("tasks")
    .withIndex("by_trashed_status_when", (q) => q.eq("trashedAt", undefined).eq("status.kind", "open").eq("when.kind", kind))
    .take(LIST_LIMIT);

const byListOrder = (a: Doc<"tasks">, b: Doc<"tasks">) => compare(a.order, b.order);

const groupByContainer = async (ctx: QueryCtx, tasks: Doc<"tasks">[], keepProject: (project: Doc<"projects">) => boolean) => {
  const { standalone, areas } = await loadContainers(ctx);
  const rows = await enrich(ctx, tasks.toSorted(byListOrder));
  const inProject = (id: Id<"projects">) => rows.filter((row) => row.parent.kind === "project" && row.parent.projectId === id);
  const projectGroup = async (project: Doc<"projects">, area?: Doc<"areas">) => ({
    key: project._id as string,
    container: {
      kind: "project",
      project: projectSummary(project),
      progress: await projectProgress(ctx, project._id),
      ...(area ? { area: areaSummary(area) } : {}),
    } satisfies Container,
    tasks: inProject(project._id),
  });
  const withTasks = (project: Doc<"projects">) => keepProject(project) && inProject(project._id).length > 0;
  const grouped = await Promise.all(
    areas.map(async ({ area, projects }) => [
      {
        key: area._id as string,
        container: { kind: "area", area: areaSummary(area) } satisfies Container,
        tasks: rows.filter((row) => row.parent.kind === "area" && row.parent.areaId === area._id),
      },
      ...(await Promise.all(projects.filter(withTasks).map((project) => projectGroup(project, area)))),
    ]),
  );
  return [
    { key: "loose", container: { kind: "loose" } satisfies Container, tasks: rows.filter((row) => row.parent.kind === "loose") },
    ...(await Promise.all(standalone.filter(withTasks).map((project) => projectGroup(project)))),
    ...grouped.flat(),
  ].filter((group) => group.tasks.length > 0);
};

const isActiveOn = (date: IsoDate) => (project: Doc<"projects">) =>
  project.when.kind === "anytime" || (project.when.kind === "scheduled" && project.when.date <= date);

export const inbox = ownerQuery({
  args: {},
  handler: async (ctx) => ({ tasks: await enrich(ctx, (await openTasksWhen(ctx, "inbox")).toSorted(byListOrder)) }),
});

const loadAnytime = async (ctx: QueryCtx, date: IsoDate) => {
  const [anytime, started] = await Promise.all([
    openTasksWhen(ctx, "anytime"),
    ctx.db
      .query("tasks")
      .withIndex("by_trashed_status_when", (q) =>
        q.eq("trashedAt", undefined).eq("status.kind", "open").eq("when.kind", "scheduled").lte("when.date", date),
      )
      .take(LIST_LIMIT),
  ]);
  return { date, groups: await groupByContainer(ctx, [...anytime, ...started], isActiveOn(date)) };
};

export const anytime = ownerQuery({
  args: { date: v.string() },
  handler: async (ctx, { date }) => serialise(await parseIsoDate(date).asyncMap((day) => loadAnytime(ctx, day))),
});

export const someday = ownerQuery({
  args: {},
  handler: async (ctx) => {
    const { standalone, areas } = await loadContainers(ctx);
    const parked = [
      ...standalone.map((project) => ({ project, area: undefined })),
      ...areas.flatMap(({ area, projects }) => projects.map((project) => ({ project, area }))),
    ].filter(({ project }) => project.when.kind === "someday");
    return {
      groups: await groupByContainer(ctx, await openTasksWhen(ctx, "someday"), (project) => project.when.kind !== "someday"),
      projects: await Promise.all(
        parked.map(async ({ project, area }) => ({
          ...projectSummary(project),
          area: area && areaSummary(area),
          progress: await projectProgress(ctx, project._id),
        })),
      ),
    };
  },
});

const loadUpcoming = async (ctx: QueryCtx, date: IsoDate, days: number) => {
  const until = addDays(date, Math.min(Math.max(days, 1), MAX_UPCOMING_DAYS));
  const [scheduled, due] = await Promise.all([
    ctx.db
      .query("tasks")
      .withIndex("by_trashed_status_when", (q) =>
        q.eq("trashedAt", undefined).eq("status.kind", "open").eq("when.kind", "scheduled").gt("when.date", date).lte("when.date", until),
      )
      .take(LIST_LIMIT),
    ctx.db
      .query("tasks")
      .withIndex("by_trashed_status_deadline", (q) =>
        q.eq("trashedAt", undefined).eq("status.kind", "open").gt("deadline", date).lte("deadline", until),
      )
      .take(LIST_LIMIT),
  ]);
  const rows = new Map(
    (await enrich(ctx, [...new Map([...scheduled, ...due].map((task) => [task._id, task])).values()].toSorted(byListOrder))).map(
      (row) => [row._id, row] as const,
    ),
  );
  const rowsFor = (tasks: Doc<"tasks">[]) => tasks.flatMap((task) => rows.get(task._id) ?? []);
  const dates = [
    ...new Set([
      ...scheduled.flatMap((task) => (task.when.kind === "scheduled" ? [task.when.date] : [])),
      ...due.flatMap((task) => task.deadline ?? []),
    ]),
  ].toSorted();
  return {
    date,
    until,
    days: dates.map((day) => ({
      date: day,
      tasks: rowsFor(scheduled.filter((task) => task.when.kind === "scheduled" && task.when.date === day).toSorted(byListOrder)),
      deadlines: rowsFor(due.filter((task) => task.deadline === day).toSorted(byListOrder)),
    })),
  };
};

export const upcoming = ownerQuery({
  args: { date: v.string(), days: v.number() },
  handler: async (ctx, { date, days }) => serialise(await parseIsoDate(date).asyncMap((day) => loadUpcoming(ctx, day, days))),
});

export const logbook = ownerQuery({
  args: { paginationOpts: paginationOptsValidator, from: v.optional(v.number()), to: v.optional(v.number()) },
  handler: async (ctx, { paginationOpts, from, to }) => {
    const closed = await ctx.db
      .query("tasks")
      .withIndex("by_trashed_closed_at", (q) =>
        q
          .eq("trashedAt", undefined)
          .gte("status.at", from ?? 0)
          .lte("status.at", to ?? Number.MAX_SAFE_INTEGER),
      )
      .order("desc")
      .paginate(paginationOpts);
    return { ...closed, page: await enrich(ctx, closed.page) };
  },
});

export const logbookTimeline = ownerQuery({
  args: { from: v.number() },
  handler: async (ctx, { from }) => {
    const closed = await ctx.db
      .query("tasks")
      .withIndex("by_trashed_closed_at", (q) => q.eq("trashedAt", undefined).gte("status.at", from))
      .order("desc")
      .take(TIMELINE_LIMIT);
    return { closedAt: closed.flatMap((task) => (task.status.kind === "open" ? [] : [task.status.at])) };
  },
});

const isOpen = (task: Doc<"tasks">) => task.status.kind === "open";

export const area = ownerQuery({
  args: { areaId: v.id("areas") },
  handler: async (ctx, { areaId }) => {
    const found = await ctx.db.get("areas", areaId);
    if (!found || !isLive(found)) return null;
    const [tasks, projects] = await Promise.all([
      ctx.db
        .query("tasks")
        .withIndex("by_area_order", (q) => q.eq("parent.areaId", areaId))
        .take(LIST_LIMIT),
      ctx.db
        .query("projects")
        .withIndex("by_area_order", (q) => q.eq("areaId", areaId))
        .take(LIST_LIMIT),
    ]);
    const open = projects.filter((project) => isLive(project) && project.status.kind === "open");
    return {
      area: areaSummary(found),
      tasks: await enrich(ctx, tasks.filter((task) => isLive(task) && isOpen(task))),
      projects: await Promise.all(
        open.map(async (project) => ({
          ...projectSummary(project),
          when: project.when,
          deadline: project.deadline,
          progress: await projectProgress(ctx, project._id),
        })),
      ),
    };
  },
});

const headingOf = (row: TaskRow) => (row.parent.kind === "project" ? row.parent.headingId : undefined);

const sectionsOf = (headings: Doc<"headings">[], rows: TaskRow[]) => {
  const known = new Set<string>(headings.map((heading) => heading._id));
  return [
    { heading: null, tasks: rows.filter((row) => !known.has(headingOf(row) ?? "")) },
    ...headings.map((heading) => ({
      heading: { _id: heading._id, title: heading.title },
      tasks: rows.filter((row) => headingOf(row) === heading._id),
    })),
  ];
};

export const project = ownerQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const found = await ctx.db.get("projects", projectId);
    if (!found || !isLive(found)) return null;
    const [parent, headings, tasks] = await Promise.all([
      found.areaId ? ctx.db.get("areas", found.areaId) : null,
      ctx.db
        .query("headings")
        .withIndex("by_project_order", (q) => q.eq("projectId", projectId))
        .take(HEADING_LIMIT),
      projectTasks(ctx, projectId),
    ]);
    return {
      project: {
        ...projectSummary(found),
        notes: found.notes,
        when: found.when,
        deadline: found.deadline,
        status: found.status,
        thingsId: found.things?.id,
      },
      area: parent ? areaSummary(parent) : undefined,
      progress: progressOf(tasks),
      sections: sectionsOf(headings, await enrich(ctx, tasks.filter(isOpen))),
    };
  },
});
