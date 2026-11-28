import { tool, type ToolDefinition } from "@convex-dev/mcp";
import type { DefaultFunctionArgs, RegisteredMutation } from "convex/server";
import { v } from "convex/values";
import { Effect, Option, Result } from "effect";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { MCP_SCOPES, type AgentRunActor } from "../platform/access";
import { agentMutation, changeAs, readAsOwner, reading } from "../platform/effect";
import { zonedMoment } from "../calendar/model";
import { addDays, type IsoDate, parseIsoDate } from "../../shared/date";
import type { SerialisedResult } from "../../shared/result";
import * as areas from "./areas";
import * as checklist from "./checklist";
import * as convert from "./convert";
import * as focus from "./focus";
import * as plan from "./plan";
import * as projects from "./projects";
import * as recurrence from "./recurrence";
import * as tasks from "./tasks";
import * as templates from "./templates";
import * as workBlocks from "./workBlocks";
import { labelNamed } from "./labels";
import type { PlannerTable } from "./model";
import { agentDate, agentId, agentTimeZone, detail, loadTaskRow, refuse, vTaskDetail } from "./agentReads";
import { vRepeatEnd, vSchedule, type Parent, type When } from "./tables";

const MAX_CHECKLIST_ADD = 50;

const RECORD_NOUNS = {
  tasks: "Task",
  areas: "Area",
  projects: "Project",
  headings: "Heading",
  labels: "Label",
  checklistItems: "Checklist Item",
  workBlocks: "Work Block",
  recurrenceRules: "Recurrence Rule",
  templates: "Template",
  smartBlocks: "Smart Block",
  focusSessions: "Focus Session",
} satisfies Record<PlannerTable, string>;

const refusals: Record<string, (error: Record<string, unknown>) => string> = {
  not_found: (error) => `No ${RECORD_NOUNS[error.table as PlannerTable] ?? String(error.table)} has the id "${String(error.id)}".`,
  invalid_date: (error) => `Use a real date in YYYY-MM-DD form, not "${String(error.input)}".`,
  invalid_estimate: () => "An Estimate is a whole number of minutes from 1 to 12000.",
  empty_title: () => "A title cannot be empty.",
  name_taken: (error) => `The name "${String(error.name)}" is taken.`,
  heading_outside_project: () => "That Heading belongs to another Project.",
  invalid_block: (error) =>
    error.reason === "overlap"
      ? "That Work Block would overlap another Work Block. Pick a free time from get_day_plan."
      : `That Work Block is not valid (${String(error.reason)}). Check the start time, the minutes and the time zone.`,
  invalid_plan: (error) =>
    error.reason === "goal" ? "A Goal is a whole number of minutes from 0 to 1440, or null to reset it." : "That Day Plan change is not valid.",
  invalid_schedule: (error) => `That repeat schedule is not valid (${String(error.reason)}).`,
  invalid_template: (error) => `That Template is not valid (${String(error.reason)}).`,
  invalid_smart_block: (error) =>
    ({
      window: "A Smart Block runs at least 15 minutes and ends by midnight.",
      occurrence: "That Smart Block does not happen on that date. Check list_smart_blocks.",
      outside: "Every Work Block of a fill must sit inside its Smart Block.",
      overlap: "That fill would overlap another Work Block. Preview it again with preview_smart_block_fill.",
    })[String(error.reason)] ?? `That Smart Block change is not valid (${String(error.reason)}).`,
  feature_off: () => "Smart Blocks is switched off in Settings. Ask Avi to switch it on.",
  invalid_focus: (error) =>
    error.reason === "task_closed" ? "Only an open Task can start a Focus Session." : `That Focus Session change is not valid (${String(error.reason)}).`,
};

const refusalMessage = (error: unknown) => {
  const shaped = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const explain = refusals[String(shaped.kind)];
  return explain ? explain(shaped) : `LifeOS refused that change: ${JSON.stringify(error)}.`;
};

export const writer = Effect.fn("agentWrites.writer")(function* (run: Effect.Effect<AgentRunActor>) {
  const actor = yield* run;
  const activityIds: string[] = [];
  const change = <Args extends DefaultFunctionArgs, T extends { activityId: Id<"activity"> | null }, E>(
    registered: RegisteredMutation<"public", Args, Promise<SerialisedResult<T, E>>>,
    args: Omit<Args, "agentRun">,
  ) =>
    changeAs(actor, registered, args).pipe(
      Effect.catch((error) => refuse(refusalMessage(error))),
      Effect.tap(({ activityId }) => Effect.sync(() => activityId && activityIds.push(activityId))),
    );
  const receipt = () => ({ runId: actor.jobId as string, activityIds });
  return { change, receipt };
});

export const vReceipt = { runId: v.string(), activityIds: v.array(v.string()) };

const vTaskReceipt = v.object({ ...vReceipt, task: vTaskDetail });

const vPlainReceipt = v.object(vReceipt);

const parseWhen = Effect.fn("agentWrites.parseWhen")(function* (input: string, today: IsoDate) {
  const [word, evening] = input.trim().toLowerCase().split(/\s+/);
  if (evening !== undefined && evening !== "evening") return yield* refuse(whenHelp(input));
  if (word === "inbox" || word === "anytime" || word === "someday") {
    if (evening) return yield* refuse(whenHelp(input));
    const parked: When = { kind: word };
    return parked;
  }
  const date = word === "today" ? today : word === "tomorrow" ? addDays(today, 1) : (word ?? "");
  if (Result.isFailure(parseIsoDate(date))) return yield* refuse(whenHelp(input));
  const scheduled: When = { kind: "scheduled", date, evening: evening === "evening" };
  return scheduled;
});

const whenHelp = (input: string) =>
  `"${input}" is not a When. Use inbox, anytime, someday, today, tomorrow, or a YYYY-MM-DD date, optionally followed by " evening".`;

const vParentInput = v.union(v.literal("none"), v.object({ areaId: v.string() }), v.object({ projectId: v.string() }));

const parseParent = Effect.fn("agentWrites.parseParent")(function* (input: "none" | { areaId: string } | { projectId: string }) {
  const parent: Parent =
    input === "none"
      ? { kind: "loose" }
      : "areaId" in input
        ? { kind: "area", areaId: yield* agentId("areas", input.areaId, "Area") }
        : { kind: "project", projectId: yield* agentId("projects", input.projectId, "Project") };
  return parent;
});

const labelIdsFor = Effect.fn("agentWrites.labelIdsFor")(function* (names: readonly string[]) {
  const found = yield* reading((ctx) => Promise.all(names.map(async (name) => ({ name, label: await labelNamed(ctx, name) }))));
  const missing = found.filter(({ label }) => !label).map(({ name }) => name);
  if (missing.length > 0) return yield* refuse(`No Label is named ${missing.map((name) => `"${name}"`).join(", ")}. list_areas shows the Labels.`);
  return found.flatMap(({ label }) => (label ? [label._id] : []));
});

const LOCAL_START = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;
const OFFSET_START = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

const parseStart = (input: string, timeZone: string) => {
  const local = LOCAL_START.exec(input);
  const offset = OFFSET_START.exec(input);
  const date = Result.getSuccess(parseIsoDate(local?.[1] ?? offset?.[1] ?? ""));
  if (local && Option.isSome(date)) return Effect.succeed(zonedMoment(date.value, Number(local[2]) * 60 + Number(local[3]), timeZone));
  if (offset && Option.isSome(date)) return Effect.succeed(Date.parse(input));
  return refuse(`"${input}" is not a start time. Use YYYY-MM-DDTHH:mm in Avi's time zone, or ISO 8601 with an offset.`);
};

const finishWithTask = Effect.fn("agentWrites.finishWithTask")(function* (
  taskId: Id<"tasks">,
  timeZone: string | undefined,
  receipt: () => { runId: string; activityIds: string[] },
) {
  const row = yield* loadTaskRow(taskId);
  return { ...receipt(), task: detail(row, yield* agentTimeZone(timeZone)) };
});

const todayIn = Effect.fn("agentWrites.todayIn")(function* (timeZone: string | undefined) {
  return yield* agentDate(undefined, yield* agentTimeZone(timeZone));
});

const optional = <A, B, R>(value: A | undefined, read: (given: A) => Effect.Effect<B, never, R>) =>
  value === undefined ? Effect.succeed(undefined) : read(value);

export const createTask = agentMutation({
  args: {
    title: v.string(),
    notes: v.optional(v.string()),
    when: v.optional(v.string()),
    deadline: v.optional(v.string()),
    estimateMinutes: v.optional(v.number()),
    labels: v.optional(v.array(v.string())),
    parent: v.optional(vParentInput),
    checklist: v.optional(v.array(v.string())),
    timeZone: v.optional(v.string()),
  },
  handler: Effect.fn("agentWrites.createTask")(function* (args, run) {
    if ((args.checklist?.length ?? 0) > MAX_CHECKLIST_ADD) return yield* refuse(`Add at most ${MAX_CHECKLIST_ADD} Checklist Items at once.`);
    const write = yield* writer(run);
    const when = yield* optional(args.when, (given) => Effect.flatMap(todayIn(args.timeZone), (today) => parseWhen(given, today)));
    const parent = yield* optional(args.parent, parseParent);
    const labelIds = yield* optional(args.labels, labelIdsFor);
    const { taskId } = yield* write.change(tasks.create, {
      title: args.title,
      ...(args.notes === undefined ? {} : { notes: args.notes }),
      ...(when === undefined ? {} : { when }),
      ...(args.deadline === undefined ? {} : { deadline: args.deadline }),
      ...(args.estimateMinutes === undefined ? {} : { estimateMinutes: args.estimateMinutes }),
      ...(parent === undefined ? {} : { parent }),
      ...(labelIds === undefined ? {} : { labelIds }),
    });
    for (const title of args.checklist ?? []) yield* write.change(checklist.add, { taskId, title });
    return yield* finishWithTask(taskId, args.timeZone, write.receipt);
  }),
});

export const updateTask = agentMutation({
  args: {
    taskId: v.string(),
    title: v.optional(v.string()),
    notes: v.optional(v.string()),
    when: v.optional(v.string()),
    deadline: v.optional(v.union(v.string(), v.null())),
    estimateMinutes: v.optional(v.union(v.number(), v.null())),
    labels: v.optional(v.array(v.string())),
    parent: v.optional(vParentInput),
    timeZone: v.optional(v.string()),
  },
  handler: Effect.fn("agentWrites.updateTask")(function* (args, run) {
    const taskId = yield* agentId("tasks", args.taskId, "Task");
    yield* loadTaskRow(taskId);
    const write = yield* writer(run);
    if (args.title !== undefined) yield* write.change(tasks.rename, { taskId, title: args.title });
    if (args.notes !== undefined) yield* write.change(tasks.setNotes, { taskId, notes: args.notes });
    if (args.when !== undefined) yield* write.change(tasks.setWhen, { taskId, when: yield* parseWhen(args.when, yield* todayIn(args.timeZone)) });
    if (args.deadline !== undefined) yield* write.change(tasks.setDeadline, { taskId, deadline: args.deadline });
    if (args.estimateMinutes !== undefined) yield* write.change(tasks.setEstimate, { taskId, minutes: args.estimateMinutes });
    if (args.labels !== undefined) yield* write.change(tasks.setLabels, { taskId, labelIds: yield* labelIdsFor(args.labels) });
    if (args.parent !== undefined) yield* write.change(tasks.move, { taskId, parent: yield* parseParent(args.parent) });
    return yield* finishWithTask(taskId, args.timeZone, write.receipt);
  }),
});

export const setTaskStatus = agentMutation({
  args: { taskId: v.string(), status: v.union(v.literal("completed"), v.literal("open"), v.literal("trashed")) },
  handler: Effect.fn("agentWrites.setTaskStatus")(function* (args, run) {
    const taskId = yield* agentId("tasks", args.taskId, "Task");
    const task = yield* loadTaskRow(taskId);
    const write = yield* writer(run);
    if (args.status === "completed") yield* write.change(tasks.complete, { taskId });
    if (args.status === "trashed") yield* write.change(tasks.trash, { taskId });
    if (args.status === "open") {
      if (task.trashedAt !== undefined) yield* write.change(tasks.restore, { taskId });
      if (task.status.kind !== "open") yield* write.change(tasks.uncomplete, { taskId });
    }
    return yield* finishWithTask(taskId, undefined, write.receipt);
  }),
});

export const updateChecklist = agentMutation({
  args: {
    taskId: v.string(),
    add: v.optional(v.array(v.string())),
    tick: v.optional(v.array(v.string())),
    untick: v.optional(v.array(v.string())),
  },
  handler: Effect.fn("agentWrites.updateChecklist")(function* (args, run) {
    const taskId = yield* agentId("tasks", args.taskId, "Task");
    const task = yield* loadTaskRow(taskId);
    if ((args.add?.length ?? 0) > MAX_CHECKLIST_ADD) return yield* refuse(`Add at most ${MAX_CHECKLIST_ADD} Checklist Items at once.`);
    const own = new Set<string>(task.checklist.map((item) => item._id));
    const itemOf = Effect.fn("agentWrites.checklistItemOf")(function* (id: string) {
      const itemId = yield* agentId("checklistItems", id, "Checklist Item");
      if (!own.has(itemId)) return yield* refuse(`Checklist Item "${id}" is not on this Task. get_task lists its items.`);
      return itemId;
    });
    const write = yield* writer(run);
    for (const title of args.add ?? []) yield* write.change(checklist.add, { taskId, title });
    for (const id of args.tick ?? []) yield* write.change(checklist.tick, { itemId: yield* itemOf(id), done: true });
    for (const id of args.untick ?? []) yield* write.change(checklist.tick, { itemId: yield* itemOf(id), done: false });
    return yield* finishWithTask(taskId, undefined, write.receipt);
  }),
});

export const saveArea = agentMutation({
  args: { areaId: v.optional(v.string()), title: v.string() },
  handler: Effect.fn("agentWrites.saveArea")(function* (args, run) {
    const write = yield* writer(run);
    if (args.areaId === undefined) {
      const { areaId } = yield* write.change(areas.create, { title: args.title });
      return { ...write.receipt(), areaId: areaId as string, title: args.title.trim() };
    }
    const areaId = yield* agentId("areas", args.areaId, "Area");
    yield* write.change(areas.rename, { areaId, title: args.title });
    return { ...write.receipt(), areaId: areaId as string, title: args.title.trim() };
  }),
});

export const saveProject = agentMutation({
  args: { projectId: v.optional(v.string()), title: v.string(), areaId: v.optional(v.union(v.string(), v.null())) },
  handler: Effect.fn("agentWrites.saveProject")(function* (args, run) {
    const write = yield* writer(run);
    const areaId = typeof args.areaId === "string" ? yield* agentId("areas", args.areaId, "Area") : args.areaId;
    if (args.projectId === undefined) {
      const { projectId } = yield* write.change(projects.create, { title: args.title, ...(areaId ? { areaId } : {}) });
      return { ...write.receipt(), projectId: projectId as string, title: args.title.trim() };
    }
    const projectId = yield* agentId("projects", args.projectId, "Project");
    yield* write.change(projects.rename, { projectId, title: args.title });
    if (areaId !== undefined) yield* write.change(projects.move, { projectId, areaId });
    return { ...write.receipt(), projectId: projectId as string, title: args.title.trim() };
  }),
});

export const convertTaskToProject = agentMutation({
  args: { taskId: v.string() },
  handler: Effect.fn("agentWrites.convertTaskToProject")(function* (args, run) {
    const write = yield* writer(run);
    const { projectId, taskIds } = yield* write.change(convert.toProject, { taskId: yield* agentId("tasks", args.taskId, "Task") });
    return { ...write.receipt(), projectId: projectId as string, taskIds: taskIds.map(String) };
  }),
});

export const setDayGoal = agentMutation({
  args: { date: v.string(), minutes: v.union(v.number(), v.null()) },
  handler: Effect.fn("agentWrites.setDayGoal")(function* (args, run) {
    const write = yield* writer(run);
    yield* write.change(plan.setGoal, args);
    return write.receipt();
  }),
});

export const saveWorkBlock = agentMutation({
  args: {
    blockId: v.optional(v.string()),
    taskId: v.optional(v.string()),
    start: v.string(),
    minutes: v.number(),
    timeZone: v.optional(v.string()),
  },
  handler: Effect.fn("agentWrites.saveWorkBlock")(function* (args, run) {
    const timeZone = yield* agentTimeZone(args.timeZone);
    const start = yield* parseStart(args.start, timeZone);
    const write = yield* writer(run);
    if (args.blockId === undefined) {
      if (args.taskId === undefined) return yield* refuse("Give taskId to add a Work Block, or blockId to move one.");
      const taskId = yield* agentId("tasks", args.taskId, "Task");
      const { blockId } = yield* write.change(workBlocks.create, { taskId, start, minutes: args.minutes, timeZone });
      return { ...write.receipt(), blockId: blockId as string };
    }
    const blockId = yield* agentId("workBlocks", args.blockId, "Work Block");
    yield* write.change(workBlocks.move, { blockId, start });
    yield* write.change(workBlocks.resize, { blockId, minutes: args.minutes });
    return { ...write.receipt(), blockId: blockId as string };
  }),
});

export const removeWorkBlock = agentMutation({
  args: { blockId: v.string() },
  handler: Effect.fn("agentWrites.removeWorkBlock")(function* (args, run) {
    const write = yield* writer(run);
    yield* write.change(workBlocks.remove, { blockId: yield* agentId("workBlocks", args.blockId, "Work Block") });
    return write.receipt();
  }),
});

export const startFocus = agentMutation({
  args: { taskId: v.string(), minutes: v.optional(v.number()) },
  handler: Effect.fn("agentWrites.startFocus")(function* (args, run) {
    const write = yield* writer(run);
    const { breakMinutes, longBreakMinutes } = yield* readAsOwner(focus.plan, {});
    const { sessionId } = yield* write.change(focus.start, {
      taskId: yield* agentId("tasks", args.taskId, "Task"),
      plan: args.minutes === undefined ? { kind: "open" } : { kind: "pomodoro", focusMinutes: args.minutes, breakMinutes, longBreakMinutes },
    });
    return { ...write.receipt(), sessionId: sessionId as string };
  }),
});

export const stopFocus = agentMutation({
  args: {},
  handler: Effect.fn("agentWrites.stopFocus")(function* (_args, run) {
    const current = yield* readAsOwner(focus.current, {});
    if (!current) return yield* refuse("No Focus Session is running.");
    const write = yield* writer(run);
    yield* write.change(focus.stop, { sessionId: current._id });
    return write.receipt();
  }),
});

export const setRepeat = agentMutation({
  args: { taskId: v.string(), schedule: v.union(vSchedule, v.null()), end: v.optional(vRepeatEnd), timeZone: v.optional(v.string()) },
  handler: Effect.fn("agentWrites.setRepeat")(function* (args, run) {
    const taskId = yield* agentId("tasks", args.taskId, "Task");
    const write = yield* writer(run);
    if (args.schedule === null) yield* write.change(recurrence.stopRepeat, { taskId });
    else
      yield* write.change(recurrence.setRepeat, {
        taskId,
        schedule: args.schedule,
        end: args.end ?? { kind: "never" },
        timeZone: yield* agentTimeZone(args.timeZone),
      });
    return yield* finishWithTask(taskId, args.timeZone, write.receipt);
  }),
});

export const createTaskFromTemplate = agentMutation({
  args: { templateId: v.string(), when: v.optional(v.string()), parent: v.optional(vParentInput), timeZone: v.optional(v.string()) },
  handler: Effect.fn("agentWrites.createTaskFromTemplate")(function* (args, run) {
    const today = yield* todayIn(args.timeZone);
    const write = yield* writer(run);
    const templateId = yield* agentId("templates", args.templateId, "Template");
    const when = yield* parseWhen(args.when ?? "inbox", today);
    const parent = yield* optional(args.parent, parseParent);
    const { taskId } = yield* write.change(templates.createTask, { templateId, when, ...(parent === undefined ? {} : { parent }), today });
    return yield* finishWithTask(taskId, args.timeZone, write.receipt);
  }),
});

const whenArg = v.optional(v.string());
const timeZoneArg = v.optional(v.string());

export const write = (destructive: boolean, idempotent = false) => ({
  annotations: { readOnlyHint: false, destructiveHint: destructive, idempotentHint: idempotent, openWorldHint: false },
  scope: MCP_SCOPES.write,
});

export const plannerWriteTools: Record<string, ToolDefinition> = {
  create_task: tool({
    title: "Create Task",
    description:
      "Create a Task. `when` is inbox (default), anytime, someday, today, tomorrow or YYYY-MM-DD, with \" evening\" for This Evening. `deadline` is YYYY-MM-DD. `estimateMinutes` is the Estimate. `labels` are Label names. `parent` puts it in an Area or Project (ids from list_areas). `checklist` adds Checklist Items in order. Returns the Task and the Activity ids.",
    args: {
      title: v.string(),
      notes: v.optional(v.string()),
      when: whenArg,
      deadline: v.optional(v.string()),
      estimateMinutes: v.optional(v.number()),
      labels: v.optional(v.array(v.string())),
      parent: v.optional(vParentInput),
      checklist: v.optional(v.array(v.string())),
      timeZone: timeZoneArg,
    },
    returns: vTaskReceipt,
    ...write(false),
    handler: (ctx, args, caller) => ctx.runMutation(internal.planner.agentWrites.createTask, { ...args, caller }),
  }),
  update_task: tool({
    title: "Update Task",
    description:
      "Change any fields of one Task: title, notes, when, deadline (null clears it), estimateMinutes (null clears it), labels (the full new list of names), or parent (\"none\", an Area or a Project). Fields you leave out stay as they are.",
    args: {
      taskId: v.string(),
      title: v.optional(v.string()),
      notes: v.optional(v.string()),
      when: whenArg,
      deadline: v.optional(v.union(v.string(), v.null())),
      estimateMinutes: v.optional(v.union(v.number(), v.null())),
      labels: v.optional(v.array(v.string())),
      parent: v.optional(vParentInput),
      timeZone: timeZoneArg,
    },
    returns: vTaskReceipt,
    ...write(false, true),
    handler: (ctx, args, caller) => ctx.runMutation(internal.planner.agentWrites.updateTask, { ...args, caller }),
  }),
  set_task_status: tool({
    title: "Complete, Reopen or Trash a Task",
    description:
      "Set a Task to completed, open (reopens a completed Task or restores a trashed one) or trashed. Completing a Task ends its Focus Session and moves an after-completion repeat on.",
    args: { taskId: v.string(), status: v.union(v.literal("completed"), v.literal("open"), v.literal("trashed")) },
    returns: vTaskReceipt,
    ...write(true, true),
    handler: (ctx, args, caller) => ctx.runMutation(internal.planner.agentWrites.setTaskStatus, { ...args, caller }),
  }),
  update_checklist: tool({
    title: "Update Checklist",
    description: "Add Checklist Items to a Task (titles, in order), and tick or untick existing ones by id (from get_task).",
    args: {
      taskId: v.string(),
      add: v.optional(v.array(v.string())),
      tick: v.optional(v.array(v.string())),
      untick: v.optional(v.array(v.string())),
    },
    returns: vTaskReceipt,
    ...write(false),
    handler: (ctx, args, caller) => ctx.runMutation(internal.planner.agentWrites.updateChecklist, { ...args, caller }),
  }),
  save_area: tool({
    title: "Create or Rename an Area",
    description: "Create an Area with this title, or rename the Area with areaId.",
    args: { areaId: v.optional(v.string()), title: v.string() },
    returns: v.object({ ...vReceipt, areaId: v.string(), title: v.string() }),
    ...write(false),
    handler: (ctx, args, caller) => ctx.runMutation(internal.planner.agentWrites.saveArea, { ...args, caller }),
  }),
  save_project: tool({
    title: "Create or Rename a Project",
    description:
      "Create a Project with this title (inside areaId if given), or rename the Project with projectId. On an existing Project, areaId moves it to that Area, and null takes it out of its Area.",
    args: { projectId: v.optional(v.string()), title: v.string(), areaId: v.optional(v.union(v.string(), v.null())) },
    returns: v.object({ ...vReceipt, projectId: v.string(), title: v.string() }),
    ...write(false),
    handler: (ctx, args, caller) => ctx.runMutation(internal.planner.agentWrites.saveProject, { ...args, caller }),
  }),
  convert_task_to_project: tool({
    title: "Turn a Task into a Project",
    description:
      "Turn a Task into a Project with its title, notes, Area, When, Deadline and Labels. Each Checklist Item becomes a Task in the Project, in order. Its Work Blocks, Focus Sessions and links move to the first open new Task (one is made with the Task's title if it has no Checklist). The original Task goes to the Trash. Returns the new projectId and the new taskIds.",
    args: { taskId: v.string() },
    returns: v.object({ ...vReceipt, projectId: v.string(), taskIds: v.array(v.string()) }),
    ...write(true),
    handler: (ctx, args, caller) => ctx.runMutation(internal.planner.agentWrites.convertTaskToProject, { ...args, caller }),
  }),
  set_day_goal: tool({
    title: "Set Day Goal",
    description: "Set how many minutes of planned work Avi wants on a date (YYYY-MM-DD). null resets the Goal to that day's Capacity.",
    args: { date: v.string(), minutes: v.union(v.number(), v.null()) },
    returns: vPlainReceipt,
    ...write(false, true),
    handler: (ctx, args, caller) => ctx.runMutation(internal.planner.agentWrites.setDayGoal, { ...args, caller }),
  }),
  save_work_block: tool({
    title: "Add or Move a Work Block",
    description:
      "Reserve calendar time for a Task (taskId), or move and resize an existing Work Block (blockId). `start` is YYYY-MM-DDTHH:mm in Avi's time zone or ISO 8601 with an offset. A Work Block never changes the Task's Deadline. Check get_day_plan for free time first.",
    args: {
      blockId: v.optional(v.string()),
      taskId: v.optional(v.string()),
      start: v.string(),
      minutes: v.number(),
      timeZone: timeZoneArg,
    },
    returns: v.object({ ...vReceipt, blockId: v.string() }),
    ...write(false),
    handler: (ctx, args, caller) => ctx.runMutation(internal.planner.agentWrites.saveWorkBlock, { ...args, caller }),
  }),
  remove_work_block: tool({
    title: "Remove a Work Block",
    description: "Remove one Work Block from the calendar. The Task stays.",
    args: { blockId: v.string() },
    returns: vPlainReceipt,
    ...write(true, true),
    handler: (ctx, args, caller) => ctx.runMutation(internal.planner.agentWrites.removeWorkBlock, { ...args, caller }),
  }),
  start_focus: tool({
    title: "Start Focus",
    description:
      "Start a Focus Session on an open Task. With `minutes` it is a Pomodoro of that length, otherwise a Stopwatch. Any other running session ends first.",
    args: { taskId: v.string(), minutes: v.optional(v.number()) },
    returns: v.object({ ...vReceipt, sessionId: v.string() }),
    ...write(false),
    handler: (ctx, args, caller) => ctx.runMutation(internal.planner.agentWrites.startFocus, { ...args, caller }),
  }),
  stop_focus: tool({
    title: "Stop Focus",
    description: "Stop the running Focus Session. Its time counts as Actual Time on the Task.",
    returns: vPlainReceipt,
    ...write(false),
    handler: (ctx, _args, caller) => ctx.runMutation(internal.planner.agentWrites.stopFocus, { caller }),
  }),
  set_repeat: tool({
    title: "Set Repeat",
    description:
      "Make a Task repeat on a schedule, or stop it repeating with schedule null. Schedules: {kind:'days',every}, {kind:'weekdays'}, {kind:'weeks',every,days:[1-7, Monday is 1]}, {kind:'months',every,on:{kind:'day',day}|{kind:'weekday',nth:1|2|3|4|-1,weekday}}, {kind:'years',every,month,day}, or {kind:'afterCompletion',every,unit:'day'|'week'|'month'}. `end` is {kind:'never'} (default), {kind:'on',date} or {kind:'after',count}.",
    args: { taskId: v.string(), schedule: v.union(vSchedule, v.null()), end: v.optional(vRepeatEnd), timeZone: timeZoneArg },
    returns: vTaskReceipt,
    ...write(false),
    handler: (ctx, args, caller) => ctx.runMutation(internal.planner.agentWrites.setRepeat, { ...args, caller }),
  }),
  create_task_from_template: tool({
    title: "Create Task from Template",
    description:
      "Create a Task from a saved Template (ids from list_repeats_and_templates), with its own Checklist Items. `when` works as in create_task. `parent` overrides the Template's Area or Project.",
    args: { templateId: v.string(), when: whenArg, parent: v.optional(vParentInput), timeZone: timeZoneArg },
    returns: vTaskReceipt,
    ...write(false),
    handler: (ctx, args, caller) => ctx.runMutation(internal.planner.agentWrites.createTaskFromTemplate, { ...args, caller }),
  }),
};
