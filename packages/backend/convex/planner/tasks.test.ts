import type { FunctionReturnType } from "convex/server";
import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import { drainJobs, newBackend, registerWorker, unwrap } from "../backend.test-utils";

type Card = NonNullable<FunctionReturnType<typeof api.planner.tasks.card>>;

const setup = async () => {
  const t = newBackend();
  const things = await registerWorker(t, "things", ["things"]);
  const { label, area, project } = await t.run(async (ctx) => {
    const areaId = await ctx.db.insert("areas", { title: "University", colour: "teal", order: "a0" });
    return {
      area: areaId,
      label: await ctx.db.insert("labels", { name: "Deep Work", colour: "violet", order: "a0" }),
      project: await ctx.db.insert("projects", {
        title: "Thesis",
        notes: "",
        areaId,
        when: { kind: "anytime" },
        labelIds: [],
        status: { kind: "open" },
        order: "a0",
      }),
    };
  });
  const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Draft intro" }));
  await drainJobs(t, things);
  const card = async () => (await t.query(api.planner.tasks.card, { taskId }))!;
  return { t, things, label, area, project, taskId, card };
};

type Setup = Awaited<ReturnType<typeof setup>>;

type EditCase = {
  name: string;
  prepare?: (s: Setup) => Promise<unknown>;
  run: (s: Setup) => Promise<FunctionReturnType<typeof api.planner.tasks.rename>>;
  view: (card: Card) => unknown;
  expected: (s: Setup) => unknown;
  bridged: boolean;
};

const at = expect.any(Number);

const edits: EditCase[] = [
  {
    name: "rename",
    run: ({ t, taskId }) => t.mutation(api.planner.tasks.rename, { taskId, title: "  Draft the intro " }),
    view: (card) => card.title,
    expected: () => "Draft the intro",
    bridged: true,
  },
  {
    name: "setNotes",
    run: ({ t, taskId }) => t.mutation(api.planner.tasks.setNotes, { taskId, notes: "Start with the gap." }),
    view: (card) => card.notes,
    expected: () => "Start with the gap.",
    bridged: true,
  },
  {
    name: "setWhen",
    run: ({ t, taskId }) =>
      t.mutation(api.planner.tasks.setWhen, { taskId, when: { kind: "scheduled", date: "2026-11-20", evening: true } }),
    view: (card) => card.when,
    expected: () => ({ kind: "scheduled", date: "2026-11-20", evening: true }),
    bridged: true,
  },
  {
    name: "setDeadline",
    run: ({ t, taskId }) => t.mutation(api.planner.tasks.setDeadline, { taskId, deadline: "2026-11-27" }),
    view: (card) => card.deadline,
    expected: () => "2026-11-27",
    bridged: true,
  },
  {
    name: "setEstimate",
    run: ({ t, taskId }) => t.mutation(api.planner.tasks.setEstimate, { taskId, minutes: 45 }),
    view: (card) => card.estimateMinutes,
    expected: () => 45,
    bridged: false,
  },
  {
    name: "setLabels",
    run: ({ t, taskId, label }) => t.mutation(api.planner.tasks.setLabels, { taskId, labelIds: [label, label] }),
    view: (card) => card.labelIds,
    expected: ({ label }) => [label],
    bridged: true,
  },
  {
    name: "move",
    run: ({ t, taskId, project }) =>
      t.mutation(api.planner.tasks.move, { taskId, parent: { kind: "project", projectId: project } }),
    view: (card) => card.parent,
    expected: ({ project }) => ({ kind: "project", projectId: project }),
    bridged: true,
  },
  {
    name: "complete",
    run: ({ t, taskId }) => t.mutation(api.planner.tasks.complete, { taskId }),
    view: (card) => card.status,
    expected: () => ({ kind: "completed", at }),
    bridged: true,
  },
  {
    name: "uncomplete",
    prepare: ({ t, taskId }) => t.mutation(api.planner.tasks.complete, { taskId }),
    run: ({ t, taskId }) => t.mutation(api.planner.tasks.uncomplete, { taskId }),
    view: (card) => card.status,
    expected: () => ({ kind: "open" }),
    bridged: true,
  },
  {
    name: "trash",
    run: ({ t, taskId }) => t.mutation(api.planner.tasks.trash, { taskId }),
    view: (card) => card.trashedAt,
    expected: () => at,
    bridged: true,
  },
  {
    name: "restore",
    prepare: ({ t, taskId }) => t.mutation(api.planner.tasks.trash, { taskId }),
    run: ({ t, taskId }) => t.mutation(api.planner.tasks.restore, { taskId }),
    view: (card) => card.trashedAt,
    expected: () => undefined,
    bridged: true,
  },
];

describe("Task mutations", () => {
  test("create adds an open Inbox Task, queues a Things create, and undo removes it", async () => {
    const t = newBackend();
    const things = await registerWorker(t, "things", ["things"]);
    const { taskId, activityId } = unwrap(
      await t.mutation(api.planner.tasks.create, { title: "Call Mum", estimateMinutes: 15 }),
    );
    expect(await t.query(api.planner.tasks.card, { taskId })).toMatchObject({
      title: "Call Mum",
      notes: "",
      when: { kind: "inbox" },
      parent: { kind: "loose" },
      status: { kind: "open" },
      estimateMinutes: 15,
      checklist: [],
      workBlocks: [],
    });
    const [created] = await drainJobs(t, things);
    expect(created?.job).toEqual({
      kind: "things",
      payload: {
        op: "create",
        entity: { table: "tasks", id: taskId },
        set: expect.objectContaining({ title: "Call Mum", when: { kind: "inbox" }, deadline: null }),
      },
    });
    unwrap(await t.mutation(api.platform.undo.undo, { activityId: activityId! }));
    expect(await t.query(api.planner.tasks.card, { taskId })).toBeNull();
    expect((await drainJobs(t, things)).map(({ job }) => job.kind === "things" && job.payload.op)).toEqual(["delete"]);
  });

  test("new Tasks are ordered after the last one in their container", async () => {
    const t = newBackend();
    const first = unwrap(await t.mutation(api.planner.tasks.create, { title: "One" }));
    const second = unwrap(await t.mutation(api.planner.tasks.create, { title: "Two" }));
    const [a, b] = await Promise.all(
      [first.taskId, second.taskId].map(async (taskId) => (await t.query(api.planner.tasks.card, { taskId }))!.order),
    );
    expect(a! < b!).toBe(true);
  });

  test.each(edits)("$name changes the Task, records Activity and undoes in one step", async (edit) => {
    const s = await setup();
    if (edit.prepare) await edit.prepare(s);
    await drainJobs(s.t, s.things);
    const before = edit.view(await s.card());
    const { activityId } = unwrap(await edit.run(s));
    expect(activityId).not.toBeNull();
    expect(edit.view(await s.card())).toEqual(edit.expected(s));
    const queued = await drainJobs(s.t, s.things);
    expect(queued.map(({ job }) => job.kind === "things" && job.payload.op)).toEqual(edit.bridged ? ["update"] : []);
    unwrap(await s.t.mutation(api.platform.undo.undo, { activityId: activityId! }));
    expect(edit.view(await s.card())).toEqual(before);
    expect((await drainJobs(s.t, s.things)).length).toBe(edit.bridged ? 1 : 0);
  });

  test("the Things Operation carries only the changed Things-owned fields", async () => {
    const s = await setup();
    unwrap(await s.t.mutation(api.planner.tasks.rename, { taskId: s.taskId, title: "Draft the intro" }));
    const [renamed] = await drainJobs(s.t, s.things);
    expect(renamed?.job.payload).toEqual({
      op: "update",
      entity: { table: "tasks", id: s.taskId },
      set: { title: "Draft the intro" },
    });
  });

  test("a change that changes nothing records no Activity and queues nothing", async () => {
    const s = await setup();
    unwrap(await s.t.mutation(api.planner.tasks.complete, { taskId: s.taskId }));
    await drainJobs(s.t, s.things);
    expect(unwrap(await s.t.mutation(api.planner.tasks.complete, { taskId: s.taskId })).activityId).toBeNull();
    expect(unwrap(await s.t.mutation(api.planner.tasks.setNotes, { taskId: s.taskId, notes: "" })).activityId).toBeNull();
    expect(await drainJobs(s.t, s.things)).toEqual([]);
  });

  test("invalid input is refused with a precise error and leaves the Task alone", async () => {
    const s = await setup();
    const { t, taskId } = s;
    const before = await s.card();
    expect(await t.mutation(api.planner.tasks.rename, { taskId, title: "   " })).toEqual({
      ok: false,
      error: { kind: "empty_title" },
    });
    expect(
      await t.mutation(api.planner.tasks.setWhen, { taskId, when: { kind: "scheduled", date: "2026-02-30", evening: false } }),
    ).toEqual({ ok: false, error: { kind: "invalid_date", input: "2026-02-30" } });
    expect(await t.mutation(api.planner.tasks.setDeadline, { taskId, deadline: "next friday" })).toEqual({
      ok: false,
      error: { kind: "invalid_date", input: "next friday" },
    });
    expect(await t.mutation(api.planner.tasks.setEstimate, { taskId, minutes: 0 })).toEqual({
      ok: false,
      error: { kind: "invalid_estimate", minutes: 0 },
    });
    expect(await t.mutation(api.planner.tasks.move, { taskId, parent: { kind: "loose" }, order: "!" })).toEqual({
      ok: false,
      error: { kind: "invalid_order", order: "!" },
    });
    const heading = await t.run((ctx) => ctx.db.insert("headings", { projectId: s.project, title: "Method", order: "a0" }));
    const otherProject = await t.run((ctx) =>
      ctx.db.insert("projects", {
        title: "Elsewhere",
        notes: "",
        when: { kind: "anytime" },
        labelIds: [],
        status: { kind: "open" },
        order: "a1",
      }),
    );
    expect(
      await t.mutation(api.planner.tasks.move, {
        taskId,
        parent: { kind: "project", projectId: otherProject, headingId: heading },
      }),
    ).toEqual({ ok: false, error: { kind: "heading_outside_project", headingId: heading } });
    expect(await s.card()).toEqual(before);
    expect(await drainJobs(t, s.things)).toEqual([]);
  });

  test("an edit to a missing Task reports not_found", async () => {
    const s = await setup();
    unwrap(await s.t.mutation(api.platform.undo.undo, { activityId: await firstActivity(s) }));
    expect(await s.t.mutation(api.planner.tasks.rename, { taskId: s.taskId, title: "Ghost" })).toEqual({
      ok: false,
      error: { kind: "not_found", table: "tasks", id: s.taskId },
    });
  });
});

const firstActivity = (s: Setup) =>
  s.t.run(async (ctx) => (await ctx.db.query("activity").first())!._id);
