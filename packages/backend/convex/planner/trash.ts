import { v, type Infer } from "convex/values";
import { err, ok } from "neverthrow";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { ownerQuery } from "../platform/access";
import type { Recorder } from "../platform/activity";
import { changeMutation } from "../platform/change";
import { restoreArea, restoreProject } from "./containers";
import { keyAfter, lastTaskOrder, liveHome, type PlannerError } from "./model";
import type { Parent } from "./tables";

const LIST_LIMIT = 500;
const CHILD_LIMIT = 1000;
const EMPTY_BATCH = 100;

const vItem = v.union(
  v.object({ kind: v.literal("task"), id: v.id("tasks") }),
  v.object({ kind: v.literal("project"), id: v.id("projects") }),
  v.object({ kind: v.literal("area"), id: v.id("areas") }),
);

type Item = Infer<typeof vItem>;
type Trashed<T extends "tasks" | "projects" | "areas"> = Doc<T> & { trashedAt: number };

const isTrashed = <T extends { trashedAt?: number }>(record: T): record is T & { trashedAt: number } => record.trashedAt !== undefined;

const trashedTasks = (ctx: QueryCtx, limit: number) =>
  ctx.db
    .query("tasks")
    .withIndex("by_trashed_closed_at", (q) => q.gt("trashedAt", 0))
    .order("desc")
    .take(limit);

const trashedProjects = (ctx: QueryCtx, limit: number) =>
  ctx.db
    .query("projects")
    .withIndex("by_trashed", (q) => q.gt("trashedAt", 0))
    .order("desc")
    .take(limit);

const trashedAreas = (ctx: QueryCtx, limit: number) =>
  ctx.db
    .query("areas")
    .withIndex("by_trashed", (q) => q.gt("trashedAt", 0))
    .order("desc")
    .take(limit);

const tasksOfProject = (ctx: QueryCtx, projectId: Id<"projects">) =>
  ctx.db
    .query("tasks")
    .withIndex("by_project_order", (q) => q.eq("parent.projectId", projectId))
    .take(CHILD_LIMIT);

const tasksOfArea = (ctx: QueryCtx, areaId: Id<"areas">) =>
  ctx.db
    .query("tasks")
    .withIndex("by_area_order", (q) => q.eq("parent.areaId", areaId))
    .take(CHILD_LIMIT);

const projectsOfArea = (ctx: QueryCtx, areaId: Id<"areas">) =>
  ctx.db
    .query("projects")
    .withIndex("by_area_order", (q) => q.eq("areaId", areaId))
    .take(CHILD_LIMIT);

const wentWith = (at: number) => (record: { trashedAt?: number }) => record.trashedAt === at;

const loadMap = async <T extends "projects" | "areas">(ctx: QueryCtx, table: T, ids: Iterable<Id<T>>) => {
  const docs = await Promise.all([...new Set(ids)].map((id) => ctx.db.get(table, id)));
  return new Map(docs.flatMap((doc) => (doc ? [[doc._id as string, doc] as const] : [])));
};

export const list = ownerQuery({
  args: {},
  handler: async (ctx) => {
    const [tasks, projects, areas] = await Promise.all([
      trashedTasks(ctx, LIST_LIMIT),
      trashedProjects(ctx, LIST_LIMIT),
      trashedAreas(ctx, LIST_LIMIT),
    ]);
    const projectsById = await loadMap(
      ctx,
      "projects",
      tasks.flatMap((task) => (task.parent.kind === "project" ? [task.parent.projectId] : [])),
    );
    const areasById = await loadMap(ctx, "areas", [
      ...tasks.flatMap((task) => (task.parent.kind === "area" ? [task.parent.areaId] : [])),
      ...[...projectsById.values(), ...projects].flatMap((project) => (project.areaId ? [project.areaId] : [])),
    ]);
    const areaOf = (areaId: Id<"areas"> | undefined) => (areaId ? areasById.get(areaId) : undefined);

    const taskRows = tasks.filter(isTrashed).flatMap((task) => {
      const project = task.parent.kind === "project" ? projectsById.get(task.parent.projectId) : undefined;
      const area = areaOf(task.parent.kind === "area" ? task.parent.areaId : project?.areaId);
      const container = project ?? (task.parent.kind === "area" ? area : undefined);
      if (container?.trashedAt === task.trashedAt) return [];
      return [
        {
          kind: "task" as const,
          id: task._id,
          title: task.title,
          trashedAt: task.trashedAt,
          closed: task.status.kind !== "open",
          context: project?.title ?? area?.title,
          colour: area?.colour,
        },
      ];
    });

    const projectRows = await Promise.all(
      projects.filter(isTrashed).flatMap((project) => {
        const area = areaOf(project.areaId);
        if (area?.trashedAt === project.trashedAt) return [];
        return [
          (async () => ({
            kind: "project" as const,
            id: project._id,
            title: project.title,
            trashedAt: project.trashedAt,
            context: area?.title,
            colour: area?.colour,
            tasks: (await tasksOfProject(ctx, project._id)).filter(wentWith(project.trashedAt)).length,
          }))(),
        ];
      }),
    );

    const areaRows = await Promise.all(
      areas.filter(isTrashed).map(async (area) => {
        const projectsWith = (await projectsOfArea(ctx, area._id)).filter(wentWith(area.trashedAt));
        const nested = await Promise.all(projectsWith.map((project) => tasksOfProject(ctx, project._id)));
        const own = (await tasksOfArea(ctx, area._id)).filter(wentWith(area.trashedAt)).length;
        return {
          kind: "area" as const,
          id: area._id,
          title: area.title,
          trashedAt: area.trashedAt,
          colour: area.colour,
          icon: area.icon,
          projects: projectsWith.length,
          tasks: own + nested.flat().filter(wentWith(area.trashedAt)).length,
        };
      }),
    );

    return {
      rows: [...areaRows, ...projectRows, ...taskRows].toSorted((a, b) => b.trashedAt - a.trashedAt),
      truncated: tasks.length === LIST_LIMIT,
    };
  },
});

const restoreTask = async (ctx: MutationCtx, record: Recorder, task: Doc<"tasks">) => {
  const home = await liveHome(ctx, task.parent);
  if (home === task.parent) return record.patch("tasks", task._id, { trashedAt: undefined });
  return record.patch("tasks", task._id, { trashedAt: undefined, parent: home, order: keyAfter(await lastTaskOrder(ctx, home)) });
};

const restoreOrphanedProject = async (ctx: MutationCtx, record: Recorder, project: Doc<"projects">) => {
  const area = project.areaId ? await ctx.db.get("areas", project.areaId) : null;
  if (area && isTrashed(area)) await record.patch("projects", project._id, { areaId: undefined });
  await restoreProject(ctx, record, project);
};

const loadItem = async (ctx: QueryCtx, item: Item) => {
  if (item.kind === "task") return { kind: item.kind, doc: await ctx.db.get("tasks", item.id) } as const;
  if (item.kind === "project") return { kind: item.kind, doc: await ctx.db.get("projects", item.id) } as const;
  return { kind: item.kind, doc: await ctx.db.get("areas", item.id) } as const;
};

const TABLE = { task: "tasks", project: "projects", area: "areas" } as const;

const loadTrashed = async (ctx: QueryCtx, items: Item[]) => {
  const loaded = [];
  for (const item of items) {
    const found = await loadItem(ctx, item);
    if (!found.doc) return err<never, PlannerError>({ kind: "not_found", table: TABLE[item.kind], id: item.id });
    if (!isTrashed(found.doc)) return err<never, PlannerError>({ kind: "not_trashed", table: TABLE[item.kind], id: item.id });
    loaded.push(found);
  }
  return ok<typeof loaded, PlannerError>(loaded);
};

export const restore = changeMutation({
  action: "trash.restore",
  args: { items: v.array(vItem) },
  handler: async (ctx, { items }, record) =>
    (await loadTrashed(ctx, items)).asyncMap(async (loaded) => {
      for (const found of loaded) {
        if (found.kind === "task" && found.doc) await restoreTask(ctx, record, found.doc);
        if (found.kind === "project" && found.doc) await restoreOrphanedProject(ctx, record, found.doc);
        if (found.kind === "area" && found.doc) await restoreArea(ctx, record, found.doc);
      }
      return { restored: loaded.length };
    }),
});

const bury = async (ctx: MutationCtx, doc: { things?: { id: string } }) => {
  if (doc.things) await ctx.db.insert("thingsTombstones", { thingsId: doc.things.id });
};

const deleteTask = async (ctx: MutationCtx, record: Recorder, task: Doc<"tasks">) => {
  const [items, blocks, sessions, from, to] = await Promise.all([
    ctx.db
      .query("checklistItems")
      .withIndex("by_task_order", (q) => q.eq("taskId", task._id))
      .take(CHILD_LIMIT),
    ctx.db
      .query("workBlocks")
      .withIndex("by_task_start", (q) => q.eq("taskId", task._id))
      .take(CHILD_LIMIT),
    ctx.db
      .query("focusSessions")
      .withIndex("by_task_start", (q) => q.eq("taskId", task._id))
      .take(CHILD_LIMIT),
    ctx.db
      .query("entityLinks")
      .withIndex("by_from", (q) => q.eq("from.id", task._id))
      .take(CHILD_LIMIT),
    ctx.db
      .query("entityLinks")
      .withIndex("by_to", (q) => q.eq("to.id", task._id))
      .take(CHILD_LIMIT),
  ]);
  for (const item of items) {
    await bury(ctx, item);
    await record.remove("checklistItems", item._id);
  }
  for (const block of blocks) await record.remove("workBlocks", block._id);
  for (const session of sessions) await record.remove("focusSessions", session._id);
  for (const link of [...from, ...to]) await record.remove("entityLinks", link._id);
  await bury(ctx, task);
  await record.remove("tasks", task._id);
};

const deleteProject = async (ctx: MutationCtx, record: Recorder, project: Doc<"projects">) => {
  const home: Parent = project.areaId ? { kind: "area", areaId: project.areaId } : { kind: "loose" };
  for (const task of await tasksOfProject(ctx, project._id)) {
    if (isTrashed(task)) await deleteTask(ctx, record, task);
    else await record.patch("tasks", task._id, { parent: home, order: keyAfter(await lastTaskOrder(ctx, home)) });
  }
  const headings = await ctx.db
    .query("headings")
    .withIndex("by_project_order", (q) => q.eq("projectId", project._id))
    .take(CHILD_LIMIT);
  for (const heading of headings) {
    await bury(ctx, heading);
    await record.remove("headings", heading._id);
  }
  await bury(ctx, project);
  await record.remove("projects", project._id);
};

const deleteArea = async (ctx: MutationCtx, record: Recorder, area: Doc<"areas">) => {
  for (const task of await tasksOfArea(ctx, area._id)) {
    if (isTrashed(task)) await deleteTask(ctx, record, task);
    else await record.patch("tasks", task._id, { parent: { kind: "loose" }, order: keyAfter(await lastTaskOrder(ctx, { kind: "loose" })) });
  }
  for (const project of await projectsOfArea(ctx, area._id)) {
    if (isTrashed(project)) await deleteProject(ctx, record, { ...project, areaId: undefined });
    else await record.patch("projects", project._id, { areaId: undefined });
  }
  await bury(ctx, area);
  await record.remove("areas", area._id);
};

export const deleteForever = changeMutation({
  action: "trash.delete",
  args: { items: v.array(vItem) },
  handler: async (ctx, { items }, record) =>
    (await loadTrashed(ctx, items)).asyncMap(async (loaded) => {
      for (const found of loaded) {
        if (found.kind === "task" && found.doc) await deleteTask(ctx, record, found.doc);
        if (found.kind === "project" && found.doc) await deleteProject(ctx, record, found.doc);
        if (found.kind === "area" && found.doc) await deleteArea(ctx, record, found.doc);
      }
      return { deleted: loaded.length };
    }),
});

export const empty = changeMutation({
  action: "trash.empty",
  args: {},
  handler: async (ctx, _args, record) => {
    const tasks = (await trashedTasks(ctx, EMPTY_BATCH)) as Trashed<"tasks">[];
    for (const task of tasks) await deleteTask(ctx, record, task);
    const projects = tasks.length === 0 ? await trashedProjects(ctx, EMPTY_BATCH) : [];
    for (const project of projects) await deleteProject(ctx, record, project);
    const areas = tasks.length + projects.length === 0 ? await trashedAreas(ctx, EMPTY_BATCH) : [];
    for (const area of areas) await deleteArea(ctx, record, area);
    const deleted = tasks.length + projects.length + areas.length;
    return ok<{ deleted: number; done: boolean }, PlannerError>({ deleted, done: deleted === 0 });
  },
});
