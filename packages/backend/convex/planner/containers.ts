import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { Recorder } from "../platform/activity";
import { colours } from "./tables";

const CONTAINER_LIMIT = 200;
const TASK_LIMIT = 1000;
const ICON_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;

export const isIcon = (icon: string) => ICON_PATTERN.test(icon);

export const lastAreaOrder = async (ctx: QueryCtx) => (await ctx.db.query("areas").withIndex("by_order").order("desc").first())?.order;

export const lastProjectOrder = async (ctx: QueryCtx, areaId: Id<"areas"> | undefined) =>
  (
    await ctx.db
      .query("projects")
      .withIndex("by_area_order", (q) => q.eq("areaId", areaId))
      .order("desc")
      .first()
  )?.order;

export const nextAreaColour = async (ctx: QueryCtx) => {
  const areas = await ctx.db.query("areas").withIndex("by_order").take(CONTAINER_LIMIT);
  const used = new Set(areas.filter((area) => area.trashedAt === undefined).map((area) => area.colour));
  return colours.find((colour) => !used.has(colour)) ?? colours[areas.length % colours.length] ?? "slate";
};

const projectTasks = (ctx: QueryCtx, projectId: Id<"projects">) =>
  ctx.db
    .query("tasks")
    .withIndex("by_project_order", (q) => q.eq("parent.projectId", projectId))
    .take(TASK_LIMIT);

const areaTasks = (ctx: QueryCtx, areaId: Id<"areas">) =>
  ctx.db
    .query("tasks")
    .withIndex("by_area_order", (q) => q.eq("parent.areaId", areaId))
    .take(TASK_LIMIT);

const areaProjects = (ctx: QueryCtx, areaId: Id<"areas">) =>
  ctx.db
    .query("projects")
    .withIndex("by_area_order", (q) => q.eq("areaId", areaId))
    .take(CONTAINER_LIMIT);

const trashTasks = async (record: Recorder, tasks: Doc<"tasks">[], at: number) => {
  for (const task of tasks) if (task.trashedAt === undefined) await record.patch("tasks", task._id, { trashedAt: at });
};

const restoreTasks = async (record: Recorder, tasks: Doc<"tasks">[], at: number) => {
  for (const task of tasks) if (task.trashedAt === at) await record.patch("tasks", task._id, { trashedAt: undefined });
};

export const trashProject = async (ctx: MutationCtx, record: Recorder, project: Doc<"projects">, at: number) => {
  if (project.trashedAt !== undefined) return;
  await record.patch("projects", project._id, { trashedAt: at });
  await trashTasks(record, await projectTasks(ctx, project._id), at);
};

export const restoreProject = async (ctx: MutationCtx, record: Recorder, project: Doc<"projects">) => {
  const at = project.trashedAt;
  if (at === undefined) return;
  await record.patch("projects", project._id, { trashedAt: undefined });
  await restoreTasks(record, await projectTasks(ctx, project._id), at);
};

export const trashArea = async (ctx: MutationCtx, record: Recorder, area: Doc<"areas">, at: number) => {
  if (area.trashedAt !== undefined) return;
  await record.patch("areas", area._id, { trashedAt: at });
  await trashTasks(record, await areaTasks(ctx, area._id), at);
  for (const project of await areaProjects(ctx, area._id)) await trashProject(ctx, record, project, at);
};

export const restoreArea = async (ctx: MutationCtx, record: Recorder, area: Doc<"areas">) => {
  const at = area.trashedAt;
  if (at === undefined) return;
  await record.patch("areas", area._id, { trashedAt: undefined });
  await restoreTasks(record, await areaTasks(ctx, area._id), at);
  for (const project of await areaProjects(ctx, area._id)) if (project.trashedAt === at) await restoreProject(ctx, record, project);
};

export const closeProjectTasks = async (ctx: MutationCtx, record: Recorder, projectId: Id<"projects">, at: number) => {
  for (const task of await projectTasks(ctx, projectId))
    if (task.trashedAt === undefined && task.status.kind === "open")
      await record.patch("tasks", task._id, { status: { kind: "completed", at } });
};

export const reopenProjectTasks = async (ctx: MutationCtx, record: Recorder, projectId: Id<"projects">, at: number) => {
  for (const task of await projectTasks(ctx, projectId))
    if (task.status.kind === "completed" && task.status.at === at) await record.patch("tasks", task._id, { status: { kind: "open" } });
};
