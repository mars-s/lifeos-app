import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  checklistOf,
  countedSessions,
  focusSessionsOf,
  liveBlocks,
  progressOf,
  tasksOfProject,
  workBlocksOf,
  type TaskRollup,
} from "./rollups";

const FOCUS_HISTORY = 12;
const CONTAINER_LIMIT = 200;

export const compare = <T extends string | number>(a: T, b: T) => (a < b ? -1 : a > b ? 1 : 0);

const found = <T>(docs: (T | null)[]) => docs.flatMap((doc) => (doc ? [doc] : []));

const byId = <T extends { _id: string }>(docs: T[]) => new Map(docs.map((doc) => [doc._id, doc] as const));

export const areaSummary = ({ _id, title, colour, icon }: Doc<"areas">) => ({ _id, title, colour, icon });

export const projectSummary = ({ _id, title }: Doc<"projects">) => ({ _id, title });

const focusSummary = (sessions: Doc<"focusSessions">[]) => {
  const counted = countedSessions(sessions);
  return { ms: counted.reduce((sum, session) => sum + session.ms, 0), sessions: counted.slice(0, FOCUS_HISTORY) };
};

const holds = (task: Doc<"tasks">, children: keyof TaskRollup) => task.rollup === undefined || task.rollup[children] > 0;

const childrenOf = <T>(ctx: QueryCtx, task: Doc<"tasks">, children: keyof TaskRollup, read: (ctx: QueryCtx, taskId: Id<"tasks">) => Promise<T[]>) =>
  holds(task, children) ? read(ctx, task._id) : Promise.resolve<T[]>([]);

export const isLive = (record: { trashedAt?: number }) => record.trashedAt === undefined;

export const enrich = async (ctx: QueryCtx, tasks: Doc<"tasks">[]) => {
  const projectIds = new Set<Id<"projects">>();
  const areaIds = new Set<Id<"areas">>();
  const labelIds = new Set<Id<"labels">>();
  const ruleIds = new Set<Id<"recurrenceRules">>();
  for (const task of tasks) {
    if (task.repeat) ruleIds.add(task.repeat.ruleId);
    if (task.parent.kind === "project") projectIds.add(task.parent.projectId);
    if (task.parent.kind === "area") areaIds.add(task.parent.areaId);
    for (const labelId of task.labelIds) labelIds.add(labelId);
  }
  const projects = byId(found(await Promise.all([...projectIds].map((id) => ctx.db.get("projects", id)))));
  for (const project of projects.values()) if (project.areaId) areaIds.add(project.areaId);
  const [areaDocs, labelDocs, ruleDocs, checklists, blocks, sessions] = await Promise.all([
    Promise.all([...areaIds].map((id) => ctx.db.get("areas", id))),
    Promise.all([...labelIds].map((id) => ctx.db.get("labels", id))),
    Promise.all([...ruleIds].map((id) => ctx.db.get("recurrenceRules", id))),
    Promise.all(tasks.map((task) => childrenOf(ctx, task, "checklistItems", checklistOf))),
    Promise.all(tasks.map((task) => childrenOf(ctx, task, "workBlocks", workBlocksOf))),
    Promise.all(tasks.map((task) => childrenOf(ctx, task, "focusSessions", focusSessionsOf))),
  ]);
  const areas = byId(found(areaDocs));
  const labels = byId(found(labelDocs));
  const rules = byId(found(ruleDocs));
  return tasks.map(({ things: _link, rollup: _rollup, repeat, ...task }, index) => {
    const project = task.parent.kind === "project" ? projects.get(task.parent.projectId) : undefined;
    const rule = repeat ? rules.get(repeat.ruleId) : undefined;
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
      workBlocks: liveBlocks(blocks[index] ?? []).map(({ _id, start, minutes, done }) => ({ _id, start, minutes, done })),
      focus: focusSummary(sessions[index] ?? []),
      ...(repeat && rule
        ? { repeat: { ...repeat, active: rule.next.kind !== "ended", schedule: rule.schedule, end: rule.end, next: rule.next } }
        : {}),
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

export const projectProgress = async (ctx: QueryCtx, project: Doc<"projects">) =>
  project.progress ?? progressOf(await tasksOfProject(ctx, project._id));
