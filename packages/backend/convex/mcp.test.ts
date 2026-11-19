import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { newBackend, unwrap, type Backend } from "./backend.test-utils";
import { zonedDate, zonedIso, zonedMoment } from "./calendar/model";
import { addDays } from "../shared/date";
import { mcp } from "./mcp";
import { MCP_RUN_IDLE_MS } from "./platform/agentRuns";

const ZONE = "Australia/Sydney";
const today = () => zonedDate(Date.now(), ZONE);

type ToolResult = { isError?: boolean; content: { type: string; text: string }[]; structuredContent?: Record<string, unknown> };

const connect = async (t: Backend, options: { userId?: string; scopes?: string[]; name?: string } = {}) =>
  (
    await t.action(internal.mcp.createApiKeyForUser, {
      userId: options.userId ?? "owner",
      name: options.name ?? "Claude Code",
      ...(options.scopes ? { scopes: options.scopes } : {}),
    })
  ).apiKey;

const rpc = async (t: Backend, key: string, method: string, params: Record<string, unknown>) => {
  const response = await t.fetch("/mcp", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "MCP-Protocol-Version": "2025-06-18" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

const callTool = async (t: Backend, key: string, name: string, args: Record<string, unknown> = {}) => {
  const { status, body } = await rpc(t, key, "tools/call", { name, arguments: args });
  return { status, result: body?.result as ToolResult | undefined };
};

const ok = async <T = Record<string, unknown>>(t: Backend, key: string, name: string, args: Record<string, unknown> = {}) => {
  const { status, result } = await callTool(t, key, name, args);
  if (status !== 200 || !result || result.isError) throw new Error(`${name} failed: ${status} ${JSON.stringify(result)}`);
  return result.structuredContent as T;
};

const refused = async (t: Backend, key: string, name: string, args: Record<string, unknown> = {}) => {
  const { result } = await callTool(t, key, name, args);
  expect(result?.isError).toBe(true);
  return result?.content[0]?.text ?? "";
};

type TaskOut = { id: string; title: string; status: string; when: string; labels: string[]; checklist?: string };
type Receipt = { runId: string; activityIds: string[] };
type TaskReceipt = Receipt & { task: TaskOut & { checklistItems: { id: string; title: string; done: boolean }[]; areaId?: string; projectId?: string } };

const setup = async () => {
  const t = await newBackend();
  const { areaId } = unwrap(await t.mutation(api.planner.areas.create, { title: "University" }));
  const { projectId } = unwrap(await t.mutation(api.planner.projects.create, { title: "Thesis", areaId }));
  unwrap(await t.mutation(api.planner.labels.create, { name: "Deep Work", colour: "violet" }));
  const key = await connect(t);
  return { t, key, areaId, projectId };
};

const activityOf = (t: Backend, activityId: string) =>
  t.run(async (ctx) => ctx.db.get("activity", activityId as Id<"activity">));

afterEach(() => {
  vi.useRealTimers();
});

describe("the server", () => {
  test("declares every tool with a scope and annotations", () => {
    expect(mcp.lint()).toEqual([]);
  });

  test("a read-only connection sees only the read tools and is refused writes with 403", async () => {
    const { t } = await setup();
    const reader = await connect(t, { scopes: ["lifeos:read"] });
    const listed = await rpc(t, reader, "tools/list", {});
    const names = (listed.body.result.tools as { name: string }[]).map((each) => each.name).toSorted();
    expect(names).toEqual([
      "get_day_plan",
      "get_task",
      "list_areas",
      "list_repeats_and_templates",
      "list_smart_blocks",
      "list_tasks",
      "preview_smart_block_fill",
      "recent_activity",
      "search",
    ]);
    const { status } = await callTool(t, reader, "create_task", { title: "Sneaky" });
    expect(status).toBe(403);
  });

  test("the write path also checks the scope itself", async () => {
    const t = await newBackend();
    const caller = { userId: "owner", scopes: ["lifeos:read"], connectionId: "read-only" };
    await expect(t.mutation(internal.planner.agentWrites.createTask, { title: "Sneaky", caller })).rejects.toThrow(
      /can only read/,
    );
  });
});

const sampleArgs: Record<string, Record<string, unknown>> = {
  list_tasks: { view: "inbox" },
  search: { query: "thesis" },
  get_task: { taskId: "nothing" },
  list_areas: {},
  get_day_plan: {},
  list_repeats_and_templates: {},
  recent_activity: {},
  create_task: { title: "Stolen" },
  update_task: { taskId: "nothing", title: "Stolen" },
  set_task_status: { taskId: "nothing", status: "completed" },
  update_checklist: { taskId: "nothing", add: ["Stolen"] },
  save_area: { title: "Stolen" },
  save_project: { title: "Stolen" },
  convert_task_to_project: { taskId: "nothing" },
  set_day_goal: { date: "2026-11-20", minutes: 60 },
  save_work_block: { taskId: "nothing", start: "2026-11-20T09:00", minutes: 30 },
  remove_work_block: { blockId: "nothing" },
  start_focus: { taskId: "nothing" },
  stop_focus: {},
  set_repeat: { taskId: "nothing", schedule: null },
  create_task_from_template: { templateId: "nothing" },
  undo: { currentRun: true },
  list_smart_blocks: {},
  create_smart_block: { title: "Stolen", start: "16:00", end: "18:00" },
  preview_smart_block_fill: { blockId: "nothing" },
  accept_smart_block_fill: { blockId: "nothing" },
};

describe("owner refusal", () => {
  test("covers every tool", async () => {
    const t = await newBackend();
    const listed = await rpc(t, await connect(t), "tools/list", {});
    const names = (listed.body.result.tools as { name: string }[]).map((each) => each.name).toSorted();
    expect(names).toEqual(Object.keys(sampleArgs).toSorted());
  });

  test.each(Object.entries(sampleArgs))("%s refuses a connection that is not the owner's", async (name, args) => {
    const t = await newBackend();
    const stranger = await connect(t, { userId: "stranger" });
    expect(await refused(t, stranger, name, args)).toBe("This LifeOS belongs to someone else.");
    expect(await t.run(async (ctx) => (await ctx.db.query("tasks").collect()).length)).toBe(0);
  });
});

describe("reads", () => {
  test("list_tasks reads each view, and logbook pages with a cursor", async () => {
    const { t, key } = await setup();
    const date = today();
    await ok(t, key, "create_task", { title: "Inbox thought" });
    await ok(t, key, "create_task", { title: "Gym", when: "today" });
    await ok(t, key, "create_task", { title: "Dentist", when: addDays(date, 3) });
    await ok(t, key, "create_task", { title: "Learn piano", when: "someday" });
    await ok(t, key, "create_task", { title: "Read", when: "anytime" });
    for (const title of ["Done one", "Done two", "Done three"]) {
      const { task } = await ok<TaskReceipt>(t, key, "create_task", { title });
      await ok(t, key, "set_task_status", { taskId: task.id, status: "completed" });
    }
    const titlesIn = async (view: string) =>
      (await ok<{ tasks: TaskOut[] }>(t, key, "list_tasks", { view })).tasks.map((task) => task.title);
    expect(await titlesIn("inbox")).toEqual(["Inbox thought"]);
    expect(await titlesIn("today")).toEqual(["Gym"]);
    expect(await titlesIn("upcoming")).toEqual(["Dentist"]);
    expect(await titlesIn("someday")).toEqual(["Learn piano"]);
    expect(await titlesIn("anytime")).toEqual(expect.arrayContaining(["Read", "Gym"]));

    const first = await ok<{ tasks: TaskOut[]; nextCursor?: string }>(t, key, "list_tasks", { view: "logbook", limit: 2 });
    expect(first.tasks).toHaveLength(2);
    expect(first.nextCursor).toBeDefined();
    const second = await ok<{ tasks: TaskOut[]; nextCursor?: string }>(t, key, "list_tasks", {
      view: "logbook",
      limit: 2,
      cursor: first.nextCursor,
    });
    expect([...first.tasks, ...second.tasks].map((task) => task.title).toSorted()).toEqual(["Done one", "Done three", "Done two"]);
    expect(second.tasks.every((task) => task.status === "completed")).toBe(true);
  });

  test("list_tasks limits a long list and says how many it left out", async () => {
    const { t, key } = await setup();
    for (const title of ["One", "Two", "Three"]) await ok(t, key, "create_task", { title });
    const listed = await ok<{ tasks: TaskOut[]; omitted: number }>(t, key, "list_tasks", { view: "inbox", limit: 2 });
    expect(listed.tasks).toHaveLength(2);
    expect(listed.omitted).toBe(1);
  });

  test("search finds Tasks, Projects and Areas by name", async () => {
    const { t, key } = await setup();
    await ok(t, key, "create_task", { title: "Write thesis outline" });
    const found = await ok<{ tasks: TaskOut[]; projects: { title: string; area?: string }[]; areas: { title: string }[] }>(
      t,
      key,
      "search",
      { query: "thesis" },
    );
    expect(found.tasks.map((task) => task.title)).toEqual(["Write thesis outline"]);
    expect(found.projects).toEqual([expect.objectContaining({ title: "Thesis", area: "University" })]);
    const areas = await ok<{ areas: { title: string }[] }>(t, key, "search", { query: "univ" });
    expect(areas.areas.map((area) => area.title)).toEqual(["University"]);
  });

  test("list_areas lists Areas with their Projects and the Labels", async () => {
    const { t, key } = await setup();
    expect(await ok(t, key, "list_areas")).toEqual({
      areas: [{ id: expect.any(String), title: "University", projects: [{ id: expect.any(String), title: "Thesis" }] }],
      projectsWithoutArea: [],
      labels: ["Deep Work"],
    });
  });

  test("get_task reads a Task with its Checklist, and a bad id gets a helpful error", async () => {
    const { t, key } = await setup();
    const { task } = await ok<TaskReceipt>(t, key, "create_task", { title: "Pack", checklist: ["Passport", "Charger"] });
    const read = await ok<TaskReceipt["task"]>(t, key, "get_task", { taskId: task.id });
    expect(read.checklistItems.map((item) => item.title)).toEqual(["Passport", "Charger"]);
    expect(read.checklist).toBe("0/2 done");
    expect(await refused(t, key, "get_task", { taskId: "nope" })).toMatch(/No Task has the id "nope"/);
  });

  test("get_day_plan reads the Goal, the meter, Work Blocks and External Commitments", async () => {
    const { t, key } = await setup();
    const date = today();
    const { task } = await ok<TaskReceipt>(t, key, "create_task", { title: "Essay", when: date, estimateMinutes: 90 });
    await ok(t, key, "set_day_goal", { date, minutes: 240 });
    await ok(t, key, "save_work_block", { taskId: task.id, start: `${date}T10:00`, minutes: 60, timeZone: ZONE });
    const plan = await ok<{
      goalMinutes: number;
      goalSet: boolean;
      plannedMinutes: number;
      tasks: TaskOut[];
      workBlocks: { title: string; start: string; end: string }[];
      commitments: unknown[];
      sleep: unknown[];
    }>(t, key, "get_day_plan", { date, timeZone: ZONE });
    expect(plan.goalMinutes).toBe(240);
    expect(plan.goalSet).toBe(true);
    expect(plan.plannedMinutes).toBe(60);
    expect(plan.tasks.map((each) => each.title)).toEqual(["Essay"]);
    expect(plan.workBlocks).toEqual([expect.objectContaining({ title: "Essay", start: expect.stringMatching(/T10:00\+1[01]:00$/) })]);
    expect(plan.commitments).toEqual([]);
    expect(plan.sleep).toEqual([]);
  });

  test("list_repeats_and_templates lists Recurrence Rules and Templates", async () => {
    const { t, key } = await setup();
    const { task } = await ok<TaskReceipt>(t, key, "create_task", { title: "Water plants", when: "today" });
    await ok(t, key, "set_repeat", { taskId: task.id, schedule: { kind: "days", every: 2 } });
    unwrap(await t.mutation(api.planner.templates.saveFromTask, { taskId: task.id as Id<"tasks">, today: today() }));
    const listed = await ok<{ repeats: { title: string; summary: string }[]; templates: { title: string }[] }>(
      t,
      key,
      "list_repeats_and_templates",
    );
    expect(listed.repeats).toEqual([expect.objectContaining({ title: "Water plants" })]);
    expect(listed.templates.map((template) => template.title)).toEqual(["Water plants"]);
  });

  test("recent_activity pages newest first and filters by run", async () => {
    const { t, key } = await setup();
    const runs = [];
    for (const title of ["A", "B", "C"]) runs.push(await ok<TaskReceipt>(t, key, "create_task", { title }));
    const first = await ok<{ entries: { action: string; subject?: string; actor: string }[]; nextCursor?: string }>(
      t,
      key,
      "recent_activity",
      { limit: 2 },
    );
    expect(first.entries.map((entry) => entry.subject)).toEqual(["C", "B"]);
    expect(first.entries[0]?.actor).toBe("agentRun");
    const rest = await ok<{ entries: { subject?: string }[] }>(t, key, "recent_activity", { limit: 10, cursor: first.nextCursor });
    expect(rest.entries.map((entry) => entry.subject)).toContain("A");
    const ofRun = await ok<{ entries: unknown[] }>(t, key, "recent_activity", { runId: runs[0]?.runId });
    expect(ofRun.entries.length).toBeGreaterThanOrEqual(3);
  });
});

describe("writes", () => {
  test("create_task sets every field through the app's own change and records the Agent Run", async () => {
    const { t, key, projectId } = await setup();
    const created = await ok<TaskReceipt>(t, key, "create_task", {
      title: "Draft chapter two",
      notes: "Start with the method",
      when: "tomorrow evening",
      deadline: "2026-12-20",
      estimateMinutes: 90,
      labels: ["deep work"],
      parent: { projectId },
      checklist: ["Outline", "Sources"],
    });
    expect(created.task).toMatchObject({
      title: "Draft chapter two",
      when: `${addDays(today(), 1)} evening`,
      deadline: "2026-12-20",
      estimateMinutes: 90,
      labels: ["Deep Work"],
      project: "Thesis",
      area: "University",
      checklist: "0/2 done",
    });
    expect(created.activityIds).toHaveLength(3);
    for (const activityId of created.activityIds) {
      expect((await activityOf(t, activityId))?.actor).toEqual({ kind: "agentRun", jobId: created.runId });
    }
    const run = await t.run(async (ctx) => ctx.db.get("jobs", created.runId as Id<"jobs">));
    expect(run?.job.payload.request).toBe("Claude Code over MCP");
    expect(run?.status.kind).toBe("claimed");
  });

  test("a bad When or an unknown Label is refused and writes nothing", async () => {
    const { t, key } = await setup();
    expect(await refused(t, key, "create_task", { title: "X", when: "next blursday" })).toMatch(/is not a When/);
    expect(await refused(t, key, "create_task", { title: "X", labels: ["Nope"] })).toMatch(/No Label is named "Nope"/);
    expect(await refused(t, key, "create_task", { title: "X", checklist: ["", "b"] })).toMatch(/title cannot be empty/);
    expect(await t.run(async (ctx) => [(await ctx.db.query("tasks").collect()).length, (await ctx.db.query("jobs").collect()).length])).toEqual([0, 0]);
  });

  test("update_task changes the fields it is given", async () => {
    const { t, key, areaId } = await setup();
    const { task } = await ok<TaskReceipt>(t, key, "create_task", { title: "Call mum", deadline: "2026-12-01", estimateMinutes: 15 });
    const updated = await ok<TaskReceipt>(t, key, "update_task", {
      taskId: task.id,
      title: "Call Mum",
      when: "anytime",
      deadline: null,
      estimateMinutes: 20,
      labels: ["Deep Work"],
      parent: { areaId },
    });
    expect(updated.task).toMatchObject({ title: "Call Mum", when: "anytime", estimateMinutes: 20, labels: ["Deep Work"], area: "University" });
    expect(updated.task).not.toHaveProperty("deadline");
    expect(updated.activityIds).toHaveLength(6);
  });

  test("set_task_status completes, reopens, trashes and restores", async () => {
    const { t, key } = await setup();
    const { task } = await ok<TaskReceipt>(t, key, "create_task", { title: "Bins" });
    const statusAfter = async (status: string) =>
      (await ok<TaskReceipt>(t, key, "set_task_status", { taskId: task.id, status })).task.status;
    expect(await statusAfter("completed")).toBe("completed");
    expect(await statusAfter("open")).toBe("open");
    expect(await statusAfter("trashed")).toBe("trashed");
    expect(await statusAfter("open")).toBe("open");
  });

  test("update_checklist adds and ticks items, and refuses another Task's item", async () => {
    const { t, key } = await setup();
    const { task } = await ok<TaskReceipt>(t, key, "create_task", { title: "Trip", checklist: ["Tickets"] });
    const { task: other } = await ok<TaskReceipt>(t, key, "create_task", { title: "Other", checklist: ["Elsewhere"] });
    const ticket = task.checklistItems[0]?.id;
    const after = await ok<TaskReceipt>(t, key, "update_checklist", { taskId: task.id, add: ["Hotel"], tick: [ticket] });
    expect(after.task.checklistItems).toEqual([
      { id: ticket, title: "Tickets", done: true },
      { id: expect.any(String), title: "Hotel", done: false },
    ]);
    expect(await refused(t, key, "update_checklist", { taskId: task.id, tick: [other.checklistItems[0]?.id] })).toMatch(
      /is not on this Task/,
    );
  });

  test("save_area and save_project create and rename", async () => {
    const { t, key, areaId } = await setup();
    const area = await ok<{ areaId: string }>(t, key, "save_area", { title: "Health" });
    await ok(t, key, "save_area", { areaId: area.areaId, title: "Health and Fitness" });
    const project = await ok<{ projectId: string }>(t, key, "save_project", { title: "Run 10k", areaId: area.areaId });
    await ok(t, key, "save_project", { projectId: project.projectId, title: "Run a half", areaId });
    const listed = await ok<{ areas: { title: string; projects: { title: string }[] }[] }>(t, key, "list_areas");
    expect(listed.areas.map((each) => [each.title, each.projects.map((p) => p.title).toSorted()])).toEqual([
      ["University", ["Run a half", "Thesis"]],
      ["Health and Fitness", []],
    ]);
  });

  test("convert_task_to_project turns the Checklist into Tasks of a new Project", async () => {
    const { t, key } = await setup();
    const { task } = await ok<TaskReceipt>(t, key, "create_task", { title: "Plan the Japan trip", checklist: ["Flights", "Hotel"] });
    const { projectId, taskIds } = await ok<{ projectId: string; taskIds: string[] }>(t, key, "convert_task_to_project", {
      taskId: task.id,
    });
    const rows = await t.run(async (ctx) => ({
      project: await ctx.db.get(projectId as Id<"projects">),
      tasks: await Promise.all(taskIds.map((taskId) => ctx.db.get(taskId as Id<"tasks">))),
      original: await ctx.db.get(task.id as Id<"tasks">),
    }));
    expect(rows.project?.title).toBe("Plan the Japan trip");
    expect(rows.tasks.map((each) => each?.title)).toEqual(["Flights", "Hotel"]);
    expect(rows.original?.trashedAt).toEqual(expect.any(Number));
  });

  test("save_work_block adds and moves a block, and remove_work_block removes it", async () => {
    const { t, key } = await setup();
    const date = today();
    const { task } = await ok<TaskReceipt>(t, key, "create_task", { title: "Deep work" });
    const { blockId } = await ok<{ blockId: string }>(t, key, "save_work_block", {
      taskId: task.id,
      start: `${date}T09:00`,
      minutes: 60,
      timeZone: ZONE,
    });
    await ok(t, key, "save_work_block", { blockId, start: `${date}T13:30`, minutes: 45, timeZone: ZONE });
    const moved = await ok<{ workBlocks: { start: string; minutes: number }[] }>(t, key, "get_task", { taskId: task.id, timeZone: ZONE });
    expect(moved.workBlocks).toEqual([expect.objectContaining({ start: expect.stringMatching(/T13:30/), minutes: 45 })]);
    await ok(t, key, "remove_work_block", { blockId });
    expect((await ok<{ workBlocks: unknown[] }>(t, key, "get_task", { taskId: task.id })).workBlocks).toEqual([]);
    expect(await refused(t, key, "save_work_block", { start: `${date}T09:00`, minutes: 30 })).toMatch(/Give taskId/);
  });

  test("start_focus and stop_focus run one Focus Session", async () => {
    const { t, key } = await setup();
    const { task } = await ok<TaskReceipt>(t, key, "create_task", { title: "Revise" });
    expect(await refused(t, key, "stop_focus")).toBe("No Focus Session is running.");
    await ok(t, key, "start_focus", { taskId: task.id, minutes: 25 });
    expect(await t.query(api.planner.focus.current, {})).toMatchObject({ taskId: task.id });
    await ok(t, key, "stop_focus");
    expect(await t.query(api.planner.focus.current, {})).toBeNull();
  });

  test("set_repeat sets and stops a repeat", async () => {
    const { t, key } = await setup();
    const { task } = await ok<TaskReceipt>(t, key, "create_task", { title: "Stand-up", when: "today" });
    const repeating = await ok<{ task: { repeats?: string } }>(t, key, "set_repeat", {
      taskId: task.id,
      schedule: { kind: "weekdays" },
      end: { kind: "after", count: 10 },
    });
    expect(repeating.task.repeats).toBeDefined();
    const stopped = await ok<{ task: { repeat?: unknown } }>(t, key, "set_repeat", { taskId: task.id, schedule: null });
    expect(stopped.task.repeat).toMatchObject({ next: { kind: "ended" } });
  });

  test("create_task_from_template makes a Task with its own Checklist", async () => {
    const { t, key } = await setup();
    const { task } = await ok<TaskReceipt>(t, key, "create_task", { title: "Weekly review", checklist: ["Inbox zero"] });
    const { templateId } = unwrap(await t.mutation(api.planner.templates.saveFromTask, { taskId: task.id as Id<"tasks">, today: today() }));
    const made = await ok<TaskReceipt>(t, key, "create_task_from_template", { templateId, when: "today" });
    expect(made.task).toMatchObject({ title: "Weekly review", when: today() });
    expect(made.task.checklistItems.map((item) => item.title)).toEqual(["Inbox zero"]);
    expect(made.task.checklistItems[0]?.id).not.toBe(task.checklistItems[0]?.id);
  });
});

describe("Smart Blocks", () => {
  type Plan = { add: { taskId: string; title: string; start: string; end: string; reason: string; sizedBy: string }[]; skipped: { title: string; why: string }[] };

  test("create, list, preview and accept a fill, each write undoable as part of the run", async () => {
    const { t, key, areaId } = await setup();
    const date = addDays(today(), 1);
    await ok(t, key, "create_task", { title: "Read chapter", when: "anytime", estimateMinutes: 50, parent: { areaId } });
    await ok(t, key, "create_task", { title: "Plan essay", when: "anytime", estimateMinutes: 25, deadline: addDays(date, 1) });
    await ok(t, key, "create_task", { title: "Write thesis", when: "anytime", estimateMinutes: 300 });
    const weekday = ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
    const created = await ok<Receipt & { blockId: string }>(t, key, "create_smart_block", {
      title: "Focus",
      date,
      start: "16:00",
      end: "18:00",
      repeat: { schedule: { kind: "weeks", every: 2, days: [weekday] } },
      timeZone: ZONE,
    });
    const listed = await ok<{ smartBlocks: { blockId: string; date: string; repeats?: string; filledWorkBlocks: number }[] }>(t, key, "list_smart_blocks", {
      date,
      days: 14,
      timeZone: ZONE,
    });
    expect(listed.smartBlocks.map((each) => each.date)).toEqual([date]);
    expect(listed.smartBlocks[0]?.repeats).toMatch(/^Every 2 weeks on /);
    expect(await refused(t, key, "preview_smart_block_fill", { blockId: created.blockId, date: addDays(date, 7), timeZone: ZONE })).toMatch(/does not happen on/);
    const preview = await ok<Plan>(t, key, "preview_smart_block_fill", { blockId: created.blockId, date, timeZone: ZONE });
    expect(preview.add.map((each) => [each.title, each.reason])).toEqual([
      ["Plan essay", "Deadline tomorrow"],
      ["Read chapter", "University"],
    ]);
    expect(preview.add[0]?.start).toBe(zonedIso(zonedMoment(date, 16 * 60, ZONE), ZONE));
    expect(preview.skipped).toEqual([{ title: "Write thesis", minutes: 300, why: "Too long for this block", taskId: expect.any(String) }]);
    const accepted = await ok<Receipt & { plan: Plan }>(t, key, "accept_smart_block_fill", { blockId: created.blockId, date, timeZone: ZONE });
    expect(accepted.runId).toBe(created.runId);
    const day = await ok<{ workBlocks: { title: string }[] }>(t, key, "get_day_plan", { date, timeZone: ZONE });
    expect(day.workBlocks.map((block) => block.title).toSorted()).toEqual(["Plan essay", "Read chapter"]);
    expect(await refused(t, key, "accept_smart_block_fill", { blockId: created.blockId, date, timeZone: ZONE })).toMatch(/Nothing new fits/);
    await ok(t, key, "undo", { activityId: accepted.activityIds[0] });
    expect((await ok<{ workBlocks: unknown[] }>(t, key, "get_day_plan", { date, timeZone: ZONE })).workBlocks).toEqual([]);
  });

  test("the tools refuse while Smart Blocks is switched off", async () => {
    const { t, key } = await setup();
    unwrap(await t.mutation(api.platform.features.setEnabled, { feature: "smartBlocks", enabled: false }));
    expect(await refused(t, key, "list_smart_blocks", {})).toMatch(/switched off/);
    expect(await refused(t, key, "create_smart_block", { title: "Focus", start: "16:00", end: "18:00" })).toMatch(/switched off/);
  });
});

describe("Agent Runs and undo", () => {
  test("writes in one session share a run, and an idle gap starts a new one", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { t, key } = await setup();
    const first = await ok<TaskReceipt>(t, key, "create_task", { title: "One" });
    const second = await ok<TaskReceipt>(t, key, "create_task", { title: "Two" });
    expect(second.runId).toBe(first.runId);
    vi.setSystemTime(Date.now() + MCP_RUN_IDLE_MS + 60_000);
    const third = await ok<TaskReceipt>(t, key, "create_task", { title: "Three" });
    expect(third.runId).not.toBe(first.runId);
    const old = await t.run(async (ctx) => ctx.db.get("jobs", first.runId as Id<"jobs">));
    expect(old?.status.kind).toBe("done");
  });

  test("two connections get separate runs", async () => {
    const { t, key } = await setup();
    const other = await connect(t, { name: "Grok" });
    const mine = await ok<TaskReceipt>(t, key, "create_task", { title: "Mine" });
    const theirs = await ok<TaskReceipt>(t, other, "create_task", { title: "Theirs" });
    expect(theirs.runId).not.toBe(mine.runId);
  });

  test("undo currentRun reverts every change of the run in one step", async () => {
    const { t, key } = await setup();
    const kept = unwrap(await t.mutation(api.planner.tasks.create, { title: "Avi's own" }));
    const { task } = await ok<TaskReceipt>(t, key, "create_task", { title: "Agent task", checklist: ["Step"] });
    await ok(t, key, "update_task", { taskId: kept.taskId, title: "Renamed by agent" });
    await ok(t, key, "set_task_status", { taskId: task.id, status: "completed" });
    const undone = await ok<{ undid: string; runId: string }>(t, key, "undo", { currentRun: true });
    expect(undone.undid).toBe("run");
    const titles = await t.run(async (ctx) => (await ctx.db.query("tasks").collect()).map((each) => each.title));
    expect(titles).toEqual(["Avi's own"]);
    expect(await t.run(async (ctx) => ctx.db.query("checklistItems").collect())).toEqual([]);
    expect(await refused(t, key, "undo", { runId: undone.runId })).toBe("That is already undone.");
  });

  test("undo by activityId reverts one change", async () => {
    const { t, key } = await setup();
    const { task } = await ok<TaskReceipt>(t, key, "create_task", { title: "Plan" });
    const renamed = await ok<TaskReceipt>(t, key, "update_task", { taskId: task.id, title: "Plan the week" });
    await ok(t, key, "undo", { activityId: renamed.activityIds[0] });
    expect((await ok<TaskOut>(t, key, "get_task", { taskId: task.id })).title).toBe("Plan");
    expect(await refused(t, key, "undo", {})).toMatch(/exactly one/);
  });

  test("an agent can undo only its own changes", async () => {
    const { t, key } = await setup();
    const other = await connect(t, { name: "Grok" });
    const own = unwrap(await t.mutation(api.planner.tasks.create, { title: "Avi's own" }));
    const theirs = await ok<TaskReceipt>(t, other, "create_task", { title: "Grok's" });
    expect(await refused(t, key, "undo", { activityId: own.activityId })).toMatch(/only undo changes this connection made/);
    expect(await refused(t, key, "undo", { activityId: theirs.activityIds[0] })).toMatch(/only undo changes this connection made/);
    expect(await refused(t, key, "undo", { runId: theirs.runId })).toMatch(/only undo changes this connection made/);
    expect(await t.run(async (ctx) => (await ctx.db.query("tasks").collect()).length)).toBe(2);
  });

  test("Avi can undo a whole MCP run from the app once it has gone idle", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { t, key } = await setup();
    const { runId } = await ok<TaskReceipt>(t, key, "create_task", { title: "From Claude" });
    const jobId = runId as Id<"jobs">;
    expect(await t.mutation(api.platform.undo.undoRun, { jobId })).toEqual({ ok: false, error: { kind: "run_active" } });
    vi.setSystemTime(Date.now() + MCP_RUN_IDLE_MS + 60_000);
    unwrap(await t.mutation(api.platform.undo.undoRun, { jobId }));
    expect(await t.run(async (ctx) => ctx.db.query("tasks").collect())).toEqual([]);
  });
});
