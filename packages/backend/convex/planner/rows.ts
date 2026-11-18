import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { MINUTE_MS, focusedMs } from "../../shared/focus";

const CHECKLIST_LIMIT = 100;
const WORK_BLOCK_LIMIT = 100;
const FOCUS_LIMIT = 300;
const FOCUS_HISTORY = 12;
const CONTAINER_LIMIT = 200;
const PROJECT_TASK_LIMIT = 1000;

export const compare = <T extends string | number>(a: T, b: T) => (a < b ? -1 : a > b ? 1 : 0);

const found = <T>(docs: (T | null)[]) => docs.flatMap((doc) => (doc ? [doc] : []));

const byId = <T extends { _id: string }>(docs: T[]) => new Map(docs.map((doc) => [doc._id, doc] as const));

export const areaSummary = ({ _id, title, colour, icon }: Doc<"areas">) => ({ _id, title, colour, icon });

export const projectSummary = ({ _id, title }: Doc<"projects">) => ({ _id, title });

const focusSummary = (sessions: Doc<"focusSessions">[]) => {
  const done = sessions.flatMap(({ _id, kind, start, state, removedAt, ...clock }) =>
    kind === "focus" && state.kind === "ended" && removedAt === undefined
      ? [{ _id, start, end: state.at, ms: focusedMs({ ...clock, start, state }, state.at) }]
      : [],
  );
  const counted = done.filter((session) => session.ms >= MINUTE_MS);
  return { ms: counted.reduce((sum, session) => sum + session.ms, 0), sessions: counted.slice(0, FOCUS_HISTORY) };
};

export const isLive = (record: { trashedAt?: number }) => record.trashedAt === undefined;

export const enrich = async (ctx: QueryCtx, tasks: Doc<"tasks">[]) => {
  const projectIds = new Set<Id<"projects">>();
  const areaIds = new Set<Id<"areas">>();
  const labelIds = new Set<Id<"labels">>();
  for (const task of tasks) {
    if (task.parent.kind === "project") projectIds.add(task.parent.projectId);
    if (task.parent.kind === "area") areaIds.add(task.parent.areaId);
    for (const labelId of task.labelIds) labelIds.add(labelId);
  }
  const projects = byId(found(await Promise.all([...projectIds].map((id) => ctx.db.get("projects", id)))));
  for (const project of projects.values()) if (project.areaId) areaIds.add(project.areaId);
  const [areaDocs, labelDocs, checklists, blocks, sessions] = await Promise.all([
    Promise.all([...areaIds].map((id) => ctx.db.get("areas", id))),
    Promise.all([...labelIds].map((id) => ctx.db.get("labels", id))),
    Promise.all(
      tasks.map((task) =>
        ctx.db
          .query("checklistItems")
          .withIndex("by_task_order", (q) => q.eq("taskId", task._id))
          .take(CHECKLIST_LIMIT),
      ),
    ),
    Promise.all(
      tasks.map((task) =>
        ctx.db
          .query("workBlocks")
          .withIndex("by_task_start", (q) => q.eq("taskId", task._id))
          .take(WORK_BLOCK_LIMIT),
      ),
    ),
    Promise.all(
      tasks.map((task) =>
        ctx.db
          .query("focusSessions")
          .withIndex("by_task_start", (q) => q.eq("taskId", task._id))
          .order("desc")
          .take(FOCUS_LIMIT),
      ),
    ),
  ]);
  const areas = byId(found(areaDocs));
  const labels = byId(found(labelDocs));
  return tasks.map(({ things: _link, ...task }, index) => {
    const project = task.parent.kind === "project" ? projects.get(task.parent.projectId) : undefined;
    const areaId = task.parent.kind === "area" ? task.parent.areaId : project?.areaId;
    const area = areaId ? areas.get(areaId) : undefined;
    return {
      ...task,
      context: project?.title ?? area?.title,
      area: area && areaSummary(area),
      project: project && projectSummary(project),
      labels: task.labelIds.flatMap((id) => {
        const label = labels.get(id);
        return label ? [{ _id: label._id, name: label.name, colour: label.colour }] : [];
      }),
      checklist: (checklists[index] ?? []).map(({ _id, title, done, order }) => ({ _id, title, done, order })),
      workBlocks: (blocks[index] ?? [])
        .filter((block) => block.removedAt === undefined)
        .map(({ _id, start, minutes, done }) => ({ _id, start, minutes, done })),
      focus: focusSummary(sessions[index] ?? []),
    };
  });
};

export type TaskRow = Awaited<ReturnType<typeof enrich>>[number];

const projectsOf = (ctx: QueryCtx, areaId: Id<"areas"> | undefined) =>
  ctx.db
    .query("projects")
    .withIndex("by_area_order", (q) => q.eq("areaId", areaId))
    .take(CONTAINER_LIMIT);

const isOpenProject = (project: Doc<"projects">) => isLive(project) && project.status.kind === "open";

export const loadContainers = async (ctx: QueryCtx) => {
  const areas = (await ctx.db.query("areas").withIndex("by_order").take(CONTAINER_LIMIT)).filter(isLive);
  const [standalone, ...grouped] = await Promise.all([
    projectsOf(ctx, undefined),
    ...areas.map((area) => projectsOf(ctx, area._id)),
  ]);
  return {
    standalone: (standalone ?? []).filter(isOpenProject),
    areas: areas.map((area, index) => ({ area, projects: (grouped[index] ?? []).filter(isOpenProject) })),
  };
};

export const projectTasks = async (ctx: QueryCtx, projectId: Id<"projects">) =>
  (
    await ctx.db
      .query("tasks")
      .withIndex("by_project_order", (q) => q.eq("parent.projectId", projectId))
      .take(PROJECT_TASK_LIMIT)
  ).filter(isLive);

export const progressOf = (tasks: Doc<"tasks">[]) => ({
  done: tasks.filter((task) => task.status.kind !== "open").length,
  total: tasks.length,
});

export const projectProgress = async (ctx: QueryCtx, projectId: Id<"projects">) =>
  progressOf(await projectTasks(ctx, projectId));
