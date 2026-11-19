import { tool, type ToolDefinition } from "@convex-dev/mcp";
import { ConvexError, v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { agentQuery, MCP_SCOPES, readAsOwner } from "../platform/access";
import { commitmentsBetween } from "../calendar/commitments";
import { blocksTime, parseTimeZone, zonedDate, zonedIso, zonedMoment } from "../calendar/model";
import { nights } from "../health/sleep";
import { addDays, parseIsoDate } from "../../shared/date";
import { describeSchedule } from "../../shared/recurrence";
import type { SerialisedResult } from "../../shared/result";
import { anytime, inbox, logbook, someday, upcoming } from "./lists";
import { get as today } from "./today";
import { week } from "./plan";
import { range as blocksInRange } from "./workBlocks";
import { list as templateList } from "./templates";
import { list as labelList } from "./labels";
import { upcoming as upcomingRepeats } from "./recurrence";
import { enrich, isLive, loadContainers, type TaskRow } from "./rows";
import { vRepeatEnd, vRepeatNext, vSchedule, type When } from "./tables";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const SEARCH_LIMIT = 20;
const FALLBACK_TIME_ZONE = "Australia/Sydney";

export const vTaskSummary = v.object({
  id: v.string(),
  title: v.string(),
  status: v.union(v.literal("open"), v.literal("completed"), v.literal("canceled"), v.literal("trashed")),
  when: v.string(),
  deadline: v.optional(v.string()),
  estimateMinutes: v.optional(v.number()),
  area: v.optional(v.string()),
  project: v.optional(v.string()),
  labels: v.array(v.string()),
  checklist: v.optional(v.string()),
  repeats: v.optional(v.string()),
});

export type TaskSummary = Infer<typeof vTaskSummary>;

export const whenText = (when: When) =>
  when.kind === "scheduled" ? `${when.date}${when.evening ? " evening" : ""}` : when.kind;

const statusOf = (task: Pick<Doc<"tasks">, "status" | "trashedAt">) =>
  task.trashedAt === undefined ? task.status.kind : ("trashed" as const);

export const summarise = (row: TaskRow) => ({
  id: row._id,
  title: row.title,
  status: statusOf(row),
  when: whenText(row.when),
  ...(row.deadline ? { deadline: row.deadline } : {}),
  ...(row.estimateMinutes ? { estimateMinutes: row.estimateMinutes } : {}),
  ...(row.area ? { area: row.area.title } : {}),
  ...(row.project ? { project: row.project.title } : {}),
  labels: row.labels.map((label) => label.name),
  ...(row.checklist.length > 0
    ? { checklist: `${row.checklist.filter((item) => item.done).length}/${row.checklist.length} done` }
    : {}),
  ...(row.repeat ? { repeats: describeSchedule(row.repeat.schedule, row.repeat.end) } : {}),
}) satisfies TaskSummary;

export const vTaskDetail = v.object({
  ...vTaskSummary.fields,
  notes: v.string(),
  areaId: v.optional(v.string()),
  projectId: v.optional(v.string()),
  checklistItems: v.array(v.object({ id: v.string(), title: v.string(), done: v.boolean() })),
  workBlocks: v.array(v.object({ id: v.string(), start: v.string(), minutes: v.number(), done: v.boolean() })),
  actualMinutes: v.number(),
  repeat: v.optional(
    v.object({ ruleId: v.string(), summary: v.string(), schedule: vSchedule, end: vRepeatEnd, next: vRepeatNext }),
  ),
});

export const detail = (row: TaskRow, timeZone: string) => ({
  ...summarise(row),
  notes: row.notes,
  ...(row.area ? { areaId: row.area._id } : {}),
  ...(row.project ? { projectId: row.project._id } : {}),
  checklistItems: row.checklist.map((item) => ({ id: item._id, title: item.title, done: item.done })),
  workBlocks: row.workBlocks.map((block) => ({
    id: block._id,
    start: zonedIso(block.start, timeZone),
    minutes: block.minutes,
    done: block.done,
  })),
  actualMinutes: Math.round(row.focus.ms / 60_000),
  ...(row.repeat
    ? {
        repeat: {
          ruleId: row.repeat.ruleId,
          summary: describeSchedule(row.repeat.schedule, row.repeat.end),
          schedule: row.repeat.schedule,
          end: row.repeat.end,
          next: row.repeat.next,
        },
      }
    : {}),
});

export const agentTimeZone = async (ctx: QueryCtx, given: string | undefined) => {
  if (given !== undefined) {
    if (parseTimeZone(given).isErr()) throw new ConvexError(`"${given}" is not an IANA time zone. Use one like "Australia/Sydney".`);
    return given;
  }
  const block = await ctx.db.query("workBlocks").order("desc").first();
  if (block) return block.timeZone;
  const rule = await ctx.db.query("recurrenceRules").order("desc").first();
  return rule?.timeZone ?? FALLBACK_TIME_ZONE;
};

export const agentDate = (given: string | undefined, timeZone: string) => {
  if (given === undefined) return zonedDate(Date.now(), timeZone);
  const parsed = parseIsoDate(given);
  if (parsed.isErr()) throw new ConvexError(`Use a real date in YYYY-MM-DD form, not "${given}".`);
  return parsed.value;
};

export const agentId = <T extends "tasks" | "projects" | "areas" | "templates" | "checklistItems" | "workBlocks" | "recurrenceRules">(
  ctx: QueryCtx,
  table: T,
  id: string,
  hint: string,
) => {
  const normalised = ctx.db.normalizeId(table, id);
  if (!normalised) throw new ConvexError(`No ${hint} has the id "${id}". ${lookupHint[table]}`);
  return normalised;
};

const lookupHint = {
  tasks: "Find Task ids with search or list_tasks.",
  projects: "Find Project ids with list_areas or search.",
  areas: "Find Area ids with list_areas or search.",
  templates: "Find Template ids with list_repeats_and_templates.",
  checklistItems: "Find Checklist Item ids with get_task.",
  workBlocks: "Find Work Block ids with get_task or get_day_plan.",
  recurrenceRules: "Find Recurrence Rule ids with get_task or list_repeats_and_templates.",
} as const;

export const unwrapRead = <T, E>(result: SerialisedResult<T, E>) => {
  if (!result.ok) throw new ConvexError(`LifeOS could not read that: ${JSON.stringify(result.error)}.`);
  return result.value;
};

const clampLimit = (limit: number | undefined) => Math.min(Math.max(Math.trunc(limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);

const vView = v.union(
  v.literal("today"),
  v.literal("inbox"),
  v.literal("upcoming"),
  v.literal("anytime"),
  v.literal("someday"),
  v.literal("logbook"),
);

const vTaskList = v.object({
  view: vView,
  date: v.optional(v.string()),
  tasks: v.array(vTaskSummary),
  somedayProjects: v.optional(v.array(v.object({ id: v.string(), title: v.string() }))),
  omitted: v.number(),
  nextCursor: v.optional(v.string()),
});

const limited = (rows: TaskRow[], limit: number) => ({
  tasks: rows.slice(0, limit).map(summarise),
  omitted: Math.max(0, rows.length - limit),
});

const uniqueRows = (rows: TaskRow[]) => [...new Map(rows.map((row) => [row._id, row])).values()];

export const listTasks = agentQuery({
  args: {
    view: vView,
    date: v.optional(v.string()),
    days: v.optional(v.number()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
    timeZone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = clampLimit(args.limit);
    const timeZone = await agentTimeZone(ctx, args.timeZone);
    const date = agentDate(args.date, timeZone);
    switch (args.view) {
      case "today": {
        const day = unwrapRead(await readAsOwner(ctx, today, { date }));
        return { view: args.view, date, ...limited([...day.tasks, ...day.evening], limit) };
      }
      case "inbox":
        return { view: args.view, ...limited((await readAsOwner(ctx, inbox, {})).tasks, limit) };
      case "upcoming": {
        const days = unwrapRead(await readAsOwner(ctx, upcoming, { date, days: args.days ?? 14 })).days;
        return { view: args.view, date, ...limited(uniqueRows(days.flatMap((day) => [...day.tasks, ...day.deadlines])), limit) };
      }
      case "anytime": {
        const groups = unwrapRead(await readAsOwner(ctx, anytime, { date })).groups;
        return { view: args.view, date, ...limited(groups.flatMap((group) => group.tasks), limit) };
      }
      case "someday": {
        const parked = await readAsOwner(ctx, someday, {});
        return {
          view: args.view,
          ...limited(parked.groups.flatMap((group) => group.tasks), limit),
          somedayProjects: parked.projects.map((project) => ({ id: project._id, title: project.title })),
        };
      }
      case "logbook": {
        const page = await readAsOwner(ctx, logbook, { paginationOpts: { numItems: limit, cursor: args.cursor ?? null } });
        return {
          view: args.view,
          tasks: page.page.map(summarise),
          omitted: 0,
          ...(page.isDone ? {} : { nextCursor: page.continueCursor }),
        };
      }
    }
  },
});

const vSearchResult = v.object({
  tasks: v.array(vTaskSummary),
  projects: v.array(v.object({ id: v.string(), title: v.string(), area: v.optional(v.string()) })),
  areas: v.array(v.object({ id: v.string(), title: v.string() })),
});

const matches = (query: string) => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return (title: string) => words.every((word) => title.toLowerCase().includes(word));
};

export const search = agentQuery({
  args: { query: v.string(), includeClosed: v.optional(v.boolean()), limit: v.optional(v.number()) },
  handler: async (ctx, { query, includeClosed, limit }) => {
    const count = Math.min(clampLimit(limit ?? SEARCH_LIMIT), 50);
    const found = await ctx.db
      .query("tasks")
      .withSearchIndex("search_title", (q) =>
        includeClosed ? q.search("title", query) : q.search("title", query).eq("status.kind", "open"),
      )
      .take(count * 2);
    const { standalone, areas } = await loadContainers(ctx);
    const fits = matches(query);
    const projects = [
      ...standalone.map((project) => ({ project, area: undefined as Doc<"areas"> | undefined })),
      ...areas.flatMap(({ area, projects: inArea }) => inArea.map((project) => ({ project, area }))),
    ].filter(({ project }) => fits(project.title));
    return {
      tasks: (await enrich(ctx, found.filter(isLive).slice(0, count))).map(summarise),
      projects: projects.slice(0, count).map(({ project, area }) => ({
        id: project._id,
        title: project.title,
        ...(area ? { area: area.title } : {}),
      })),
      areas: areas
        .filter(({ area }) => fits(area.title))
        .slice(0, count)
        .map(({ area }) => ({ id: area._id, title: area.title })),
    };
  },
});

export const loadTaskRow = async (ctx: QueryCtx, taskId: Id<"tasks">) => {
  const task = await ctx.db.get("tasks", taskId);
  if (!task) throw new ConvexError(`No Task has the id "${taskId}". ${lookupHint.tasks}`);
  const [row] = await enrich(ctx, [task]);
  if (!row) throw new ConvexError(`No Task has the id "${taskId}".`);
  return row;
};

export const getTask = agentQuery({
  args: { taskId: v.string(), timeZone: v.optional(v.string()) },
  handler: async (ctx, { taskId, timeZone }) =>
    detail(await loadTaskRow(ctx, agentId(ctx, "tasks", taskId, "Task")), await agentTimeZone(ctx, timeZone)),
});

const vAreasResult = v.object({
  areas: v.array(
    v.object({ id: v.string(), title: v.string(), projects: v.array(v.object({ id: v.string(), title: v.string() })) }),
  ),
  projectsWithoutArea: v.array(v.object({ id: v.string(), title: v.string() })),
  labels: v.array(v.string()),
});

const projectRef = (project: Doc<"projects">) => ({ id: project._id, title: project.title });

export const listAreas = agentQuery({
  args: {},
  handler: async (ctx) => {
    const { standalone, areas } = await loadContainers(ctx);
    return {
      areas: areas.map(({ area, projects }) => ({ id: area._id, title: area.title, projects: projects.map(projectRef) })),
      projectsWithoutArea: standalone.map(projectRef),
      labels: (await readAsOwner(ctx, labelList, {})).map((label) => label.name),
    };
  },
});

const vSleepNight = v.object({
  kind: v.union(v.literal("slept"), v.literal("planned")),
  wakeDate: v.string(),
  start: v.string(),
  end: v.string(),
});

const vDayPlan = v.object({
  date: v.string(),
  timeZone: v.string(),
  workingHours: v.string(),
  goalMinutes: v.number(),
  goalSet: v.boolean(),
  plannedMinutes: v.number(),
  guessedMinutes: v.number(),
  unestimatedTasks: v.number(),
  workingMinutes: v.number(),
  busyMinutes: v.number(),
  freeMinutes: v.number(),
  tasks: v.array(vTaskSummary),
  workBlocks: v.array(
    v.object({ id: v.string(), taskId: v.string(), title: v.string(), start: v.string(), end: v.string(), done: v.boolean() }),
  ),
  commitments: v.array(
    v.object({ title: v.string(), start: v.string(), end: v.string(), allDay: v.boolean(), takesTime: v.boolean() }),
  ),
  sleep: v.array(vSleepNight),
});

const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

export const getDayPlan = agentQuery({
  args: { date: v.optional(v.string()), timeZone: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const timeZone = await agentTimeZone(ctx, args.timeZone);
    const date = agentDate(args.date, timeZone);
    const plan = unwrapRead(await readAsOwner(ctx, week, { from: date, days: 1, timeZone }));
    const day = plan.days[0];
    if (!day) throw new ConvexError(`LifeOS has no plan for ${date}.`);
    const start = zonedMoment(date, 0, timeZone);
    const end = zonedMoment(addDays(date, 1), 0, timeZone);
    const [blocks, commitments, sleep] = await Promise.all([
      readAsOwner(ctx, blocksInRange, { from: start, to: end }),
      commitmentsBetween(ctx, start, end),
      readAsOwner(ctx, nights, { from: date, days: 1, today: zonedDate(Date.now(), timeZone), timeZone }),
    ]);
    const at = (instant: number) => zonedIso(instant, timeZone);
    return {
      date,
      timeZone,
      workingHours: `${clock(plan.workingHours.startMinute)}-${clock(plan.workingHours.endMinute)}`,
      goalMinutes: day.goalMinutes,
      goalSet: day.goalSet,
      plannedMinutes: day.plannedMinutes,
      guessedMinutes: day.guessedMinutes,
      unestimatedTasks: day.unestimated,
      workingMinutes: day.workingMinutes,
      busyMinutes: day.busyMinutes,
      freeMinutes: day.freeMinutes,
      tasks: day.tasks.map(summarise),
      workBlocks: unwrapRead(blocks).map((block) => ({
        id: block._id,
        taskId: block.taskId,
        title: block.task.title,
        start: at(block.start),
        end: at(block.start + block.minutes * 60_000),
        done: block.done,
      })),
      commitments: commitments.map((commitment) => ({
        title: commitment.title,
        start: at(commitment.start),
        end: at(commitment.end),
        allDay: commitment.allDay,
        takesTime: blocksTime(commitment),
      })),
      sleep: unwrapRead(sleep).map((night) => ({ kind: night.kind, wakeDate: night.wakeDate, start: at(night.start), end: at(night.end) })),
    };
  },
});

const vRepeatsAndTemplates = v.object({
  repeats: v.array(
    v.object({
      ruleId: v.string(),
      title: v.string(),
      summary: v.string(),
      nextDate: v.string(),
      taskId: v.optional(v.string()),
    }),
  ),
  templates: v.array(
    v.object({
      id: v.string(),
      title: v.string(),
      estimateMinutes: v.optional(v.number()),
      labels: v.array(v.string()),
      checklistItems: v.number(),
    }),
  ),
});

export const listRepeatsAndTemplates = agentQuery({
  args: { days: v.optional(v.number()), timeZone: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const date = agentDate(undefined, await agentTimeZone(ctx, args.timeZone));
    const [repeats, templates] = await Promise.all([
      readAsOwner(ctx, upcomingRepeats, { date, days: Math.min(Math.max(args.days ?? 30, 1), 366) }),
      readAsOwner(ctx, templateList, {}),
    ]);
    return {
      repeats: unwrapRead(repeats).map((occurrence) => ({
        ruleId: occurrence.ruleId,
        title: occurrence.title,
        summary: describeSchedule(occurrence.schedule, occurrence.end),
        nextDate: occurrence.date,
        ...(occurrence.taskId ? { taskId: occurrence.taskId } : {}),
      })),
      templates: templates.map((template) => ({
        id: template._id,
        title: template.title,
        ...(template.estimateMinutes ? { estimateMinutes: template.estimateMinutes } : {}),
        labels: template.labels.map((label) => label.name),
        checklistItems: template.checklistCount,
      })),
    };
  },
});

const vTimeZoneArg = v.optional(v.string());

export const plannerReadTools: Record<string, ToolDefinition> = {
  list_tasks: tool({
    title: "List Tasks",
    description:
      "List open Tasks in one LifeOS view: today (scheduled on or before the date, or due by it), inbox, upcoming (next `days`, default 14), anytime, someday, or logbook (completed, newest first, paged with `cursor`). Returns at most `limit` (default 50, max 200) and says how many were left out.",
    args: {
      view: vView,
      date: v.optional(v.string()),
      days: v.optional(v.number()),
      limit: v.optional(v.number()),
      cursor: v.optional(v.string()),
      timeZone: vTimeZoneArg,
    },
    returns: vTaskList,
    annotations: { readOnlyHint: true },
    scope: MCP_SCOPES.read,
    handler: (ctx, args, caller) => ctx.runQuery(internal.planner.agentReads.listTasks, { ...args, caller }),
  }),
  search: tool({
    title: "Search",
    description:
      "Find Tasks by words in their title, and Projects and Areas by name. Open Tasks only unless includeClosed is true. Use it to turn what Avi says into ids for the write tools.",
    args: { query: v.string(), includeClosed: v.optional(v.boolean()), limit: v.optional(v.number()) },
    returns: vSearchResult,
    annotations: { readOnlyHint: true },
    scope: MCP_SCOPES.read,
    handler: (ctx, args, caller) => ctx.runQuery(internal.planner.agentReads.search, { ...args, caller }),
  }),
  get_task: tool({
    title: "Get Task",
    description:
      "Read one Task in full: notes, Checklist Items with their ids, Work Blocks, Actual Time from Focus Sessions, and its repeat rule.",
    args: { taskId: v.string(), timeZone: vTimeZoneArg },
    returns: vTaskDetail,
    annotations: { readOnlyHint: true },
    scope: MCP_SCOPES.read,
    handler: (ctx, args, caller) => ctx.runQuery(internal.planner.agentReads.getTask, { ...args, caller }),
  }),
  list_areas: tool({
    title: "List Areas and Projects",
    description: "List every open Area with its open Projects, the Projects with no Area, and the Label names Tasks can use.",
    returns: vAreasResult,
    annotations: { readOnlyHint: true },
    scope: MCP_SCOPES.read,
    handler: (ctx, _args, caller) => ctx.runQuery(internal.planner.agentReads.listAreas, { caller }),
  }),
  get_day_plan: tool({
    title: "Get Day Plan",
    description:
      "Read the Planner for one date (default today): the Day Plan's Tasks in order, the Goal and the day meter (planned, guessed and free minutes inside Working Hours), Work Blocks, External Commitments from Apple Calendar, and the Sleep Window either side. Times are ISO 8601 with the offset.",
    args: { date: v.optional(v.string()), timeZone: vTimeZoneArg },
    returns: vDayPlan,
    annotations: { readOnlyHint: true },
    scope: MCP_SCOPES.read,
    handler: (ctx, args, caller) => ctx.runQuery(internal.planner.agentReads.getDayPlan, { ...args, caller }),
  }),
  list_repeats_and_templates: tool({
    title: "List Repeats and Templates",
    description:
      "List Recurrence Rules due in the next `days` (default 30) with a readable schedule, and every saved Template with its id for create_task_from_template.",
    args: { days: v.optional(v.number()), timeZone: vTimeZoneArg },
    returns: vRepeatsAndTemplates,
    annotations: { readOnlyHint: true },
    scope: MCP_SCOPES.read,
    handler: (ctx, args, caller) => ctx.runQuery(internal.planner.agentReads.listRepeatsAndTemplates, { ...args, caller }),
  }),
};

