import { Effect } from "effect";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { Recorder } from "../platform/activity";
import { reading, recording } from "../platform/effect";
import { followCompletion } from "./recurrence";
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

const trashTasks = Effect.fn("containers.trashTasks")(function* (tasks: Doc<"tasks">[], at: number) {
  for (const task of tasks) if (task.trashedAt === undefined) yield* recording((record) => record.patch("tasks", task._id, { trashedAt: at }));
});

const restoreTasks = Effect.fn("containers.restoreTasks")(function* (tasks: Doc<"tasks">[], at: number) {
  for (const task of tasks) if (task.trashedAt === at) yield* recording((record) => record.patch("tasks", task._id, { trashedAt: undefined }));
});

export const trashProject = Effect.fn("containers.trashProject")(function* (project: Doc<"projects">, at: number) {
  if (project.trashedAt !== undefined) return;
  yield* recording((record) => record.patch("projects", project._id, { trashedAt: at }));
  yield* trashTasks(yield* reading((ctx) => projectTasks(ctx, project._id)), at);
});

export const restoreProject = Effect.fn("containers.restoreProject")(function* (project: Doc<"projects">) {
  const at = project.trashedAt;
  if (at === undefined) return;
  yield* recording((record) => record.patch("projects", project._id, { trashedAt: undefined }));
  yield* restoreTasks(yield* reading((ctx) => projectTasks(ctx, project._id)), at);
});

export const trashArea = Effect.fn("containers.trashArea")(function* (area: Doc<"areas">, at: number) {
  if (area.trashedAt !== undefined) return;
  yield* recording((record) => record.patch("areas", area._id, { trashedAt: at }));
  yield* trashTasks(yield* reading((ctx) => areaTasks(ctx, area._id)), at);
  for (const project of yield* reading((ctx) => areaProjects(ctx, area._id))) yield* trashProject(project, at);
});

export const restoreArea = Effect.fn("containers.restoreArea")(function* (area: Doc<"areas">) {
  const at = area.trashedAt;
  if (at === undefined) return;
  yield* recording((record) => record.patch("areas", area._id, { trashedAt: undefined }));
  yield* restoreTasks(yield* reading((ctx) => areaTasks(ctx, area._id)), at);
  for (const project of yield* reading((ctx) => areaProjects(ctx, area._id))) if (project.trashedAt === at) yield* restoreProject(project);
});

export const closeProjectTasks = async (ctx: MutationCtx, record: Recorder, projectId: Id<"projects">, at: number) => {
  const closing = (await projectTasks(ctx, projectId)).filter((task) => task.trashedAt === undefined && task.status.kind === "open");
  for (const task of closing) await record.patch("tasks", task._id, { status: { kind: "completed", at } });
  await followCompletion(ctx, record, closing.map((task) => task._id), at);
};

export const reopenProjectTasks = async (ctx: MutationCtx, record: Recorder, projectId: Id<"projects">, at: number, now: number) => {
  const reopening = (await projectTasks(ctx, projectId)).filter((task) => task.status.kind === "completed" && task.status.at === at);
  for (const task of reopening) await record.patch("tasks", task._id, { status: { kind: "open" } });
  await followCompletion(ctx, record, reopening.map((task) => task._id), now);
};
