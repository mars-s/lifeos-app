import { expect, test } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { drainJobs, newBackend, registerWorker, unwrap } from "../backend.test-utils";
import { snapshotOf, thingsTask } from "./things.test-utils";

const scheduled = (date: string, evening = false) => ({ kind: "scheduled" as const, date, evening });

const setup = async () => {
  const t = await newBackend();
  const token = await registerWorker(t, "things", ["things"]);
  const sync = (snapshot: ReturnType<typeof snapshotOf>) => t.mutation(api.planner.things.sync, { token, snapshot });
  const taskByThingsId = (thingsId: string) =>
    t.run(async (ctx) => {
      const task = await ctx.db
        .query("tasks")
        .withIndex("by_things_id", (q) => q.eq("things.id", thingsId))
        .unique();
      return task?._id;
    });
  const card = async (taskId: Id<"tasks">) => (await t.query(api.planner.tasks.card, { taskId }))!;
  return { t, token, sync, taskByThingsId, card };
};

const area = { thingsId: "A1", title: "University", index: 0 };
const walk = thingsTask("T1", "Walk", { list: "today", when: scheduled("2026-11-18"), tags: ["Health"] });

test("a snapshot mirrors Things: Areas with a colour, Tags as Labels, Tasks linked by Things id", async () => {
  const { t, sync, taskByThingsId, card } = await setup();
  const result = await sync(snapshotOf({ areas: [area], tasks: [{ ...walk, areaThingsId: "A1" }] }));
  expect(result.tasks).toEqual({ inserted: 1, updated: 0, departed: 0 });
  const task = await card((await taskByThingsId("T1"))!);
  const [label] = await t.run((ctx) => ctx.db.query("labels").collect());
  const [mirroredArea] = await t.run((ctx) => ctx.db.query("areas").collect());
  expect(task).toMatchObject({
    title: "Walk",
    when: scheduled("2026-11-18"),
    parent: { kind: "area", areaId: mirroredArea!._id },
    labelIds: [label!._id],
    status: { kind: "open" },
  });
  expect(label).toMatchObject({ name: "Health" });
  expect(mirroredArea).toMatchObject({ title: "University", colour: "violet" });
});

test("a second identical snapshot reports no changes and records no Activity", async () => {
  const { t, sync } = await setup();
  const snapshot = snapshotOf({ areas: [area], tasks: [walk] });
  await sync(snapshot);
  const activityBefore = await t.run(async (ctx) => (await ctx.db.query("activity").collect()).length);
  expect(await sync(snapshot)).toEqual({
    areas: { inserted: 0, updated: 0, departed: 0 },
    projects: { inserted: 0, updated: 0, departed: 0 },
    tasks: { inserted: 0, updated: 0, departed: 0 },
  });
  expect(await t.run(async (ctx) => (await ctx.db.query("activity").collect()).length)).toBe(activityBefore);
});

test("inbound patches only Things-owned fields: planning data and This Evening survive a Things edit", async () => {
  const { t, sync, taskByThingsId, card } = await setup();
  await sync(snapshotOf({ tasks: [walk] }));
  const taskId = (await taskByThingsId("T1"))!;
  unwrap(await t.mutation(api.planner.tasks.setEstimate, { taskId, minutes: 30 }));
  unwrap(await t.mutation(api.planner.tasks.setWhen, { taskId, when: scheduled("2026-11-18", true) }));
  unwrap(await t.mutation(api.planner.checklist.add, { taskId, title: "Shoes" }));
  unwrap(
    await t.mutation(api.planner.workBlocks.create, {
      taskId,
      start: Date.UTC(2026, 10, 18, 7),
      minutes: 30,
      timeZone: "Australia/Sydney",
    }),
  );
  const { order } = await card(taskId);

  const result = await sync(snapshotOf({ tasks: [{ ...walk, title: "Long walk", notes: "Via the beach", index: 4 }] }));
  expect(result.tasks).toEqual({ inserted: 0, updated: 1, departed: 0 });
  expect(await card(taskId)).toMatchObject({
    title: "Long walk",
    notes: "Via the beach",
    when: scheduled("2026-11-18", true),
    estimateMinutes: 30,
    order,
    checklist: [{ title: "Shoes" }],
    workBlocks: [{ minutes: 30 }],
  });

  await sync(snapshotOf({ tasks: [{ ...walk, when: scheduled("2026-11-19") }] }));
  expect((await card(taskId)).when).toEqual(scheduled("2026-11-19"));
});

test("Things wins over a pending LifeOS edit to a Things-owned field, and inbound queues nothing back", async () => {
  const { t, token, sync, taskByThingsId, card } = await setup();
  await sync(snapshotOf({ tasks: [walk] }));
  const taskId = (await taskByThingsId("T1"))!;
  unwrap(await t.mutation(api.planner.tasks.rename, { taskId, title: "Renamed in LifeOS" }));
  await drainJobs(t, token);
  await sync(snapshotOf({ tasks: [walk] }));
  expect((await card(taskId)).title).toBe("Walk");
  expect(await drainJobs(t, token)).toEqual([]);
});

test("a Task that leaves Things is completed, or trashed if it sits in Things' Trash, never deleted", async () => {
  const { t, sync, taskByThingsId, card } = await setup();
  const errand = thingsTask("T2", "Post letter");
  await sync(snapshotOf({ areas: [area], tasks: [walk, errand] }));
  const walkId = (await taskByThingsId("T1"))!;
  const errandId = (await taskByThingsId("T2"))!;
  unwrap(await t.mutation(api.planner.tasks.setEstimate, { taskId: walkId, minutes: 30 }));

  const result = await sync(snapshotOf({ areas: [area], trash: ["T2"] }));
  expect(result.tasks).toEqual({ inserted: 0, updated: 0, departed: 2 });
  expect(await card(walkId)).toMatchObject({ status: { kind: "completed" }, estimateMinutes: 30 });
  expect(await card(errandId)).toMatchObject({ status: { kind: "open" }, trashedAt: expect.any(Number) });
  expect((await sync(snapshotOf({ areas: [area], trash: ["T2"] }))).tasks).toEqual({ inserted: 0, updated: 0, departed: 0 });

  await sync(snapshotOf({ areas: [area], tasks: [walk, errand] }));
  expect(await card(walkId)).toMatchObject({ status: { kind: "open" }, estimateMinutes: 30 });
  expect((await card(errandId)).trashedAt).toBeUndefined();
});

test("a Task completed in Things keeps its completion time across syncs", async () => {
  const { sync, taskByThingsId, card } = await setup();
  await sync(snapshotOf({ tasks: [{ ...walk, status: "completed", modifiedAt: 1000 }] }));
  const taskId = (await taskByThingsId("T1"))!;
  await sync(snapshotOf({ tasks: [{ ...walk, status: "completed", modifiedAt: 2000 }] }));
  expect((await card(taskId)).status).toEqual({ kind: "completed", at: 1000 });
});

test("Areas and Projects that leave Things are trashed or completed, not deleted", async () => {
  const { t, sync } = await setup();
  const project = {
    thingsId: "P1",
    title: "Thesis",
    notes: "",
    status: "open" as const,
    when: { kind: "anytime" as const },
    tags: [],
    areaThingsId: "A1",
    index: 0,
    modifiedAt: 1,
  };
  await sync(snapshotOf({ areas: [area], projects: [project] }));
  const result = await sync(snapshotOf({ tasks: [walk], trash: ["P1"] }));
  expect(result.areas.departed).toBe(1);
  expect(result.projects.departed).toBe(1);
  const [mirroredArea] = await t.run((ctx) => ctx.db.query("areas").collect());
  const [mirroredProject] = await t.run((ctx) => ctx.db.query("projects").collect());
  expect(mirroredArea?.trashedAt).toEqual(expect.any(Number));
  expect(mirroredProject?.status.kind).toBe("open");
  expect(mirroredProject?.trashedAt).toEqual(expect.any(Number));
});

test("a Project listed by Things but sitting in its Trash is trashed, not kept live", async () => {
  const { t, sync } = await setup();
  const project = {
    thingsId: "P1",
    title: "Thesis",
    notes: "",
    status: "open" as const,
    when: { kind: "anytime" as const },
    tags: [],
    index: 0,
    modifiedAt: 1,
  };
  await sync(snapshotOf({ projects: [project] }));
  await sync(snapshotOf({ projects: [project], trash: ["P1"] }));
  const [mirrored] = await t.run((ctx) => ctx.db.query("projects").collect());
  expect(mirrored?.trashedAt).toEqual(expect.any(Number));
});

test("a Task listed by Things but sitting in its Trash is trashed", async () => {
  const { sync, taskByThingsId, card } = await setup();
  await sync(snapshotOf({ tasks: [walk] }));
  await sync(snapshotOf({ tasks: [walk], trash: ["T1"] }));
  expect((await card((await taskByThingsId("T1"))!)).trashedAt).toEqual(expect.any(Number));
});

test("an empty snapshot after a full one is refused and changes nothing", async () => {
  const { sync, taskByThingsId, card } = await setup();
  await sync(snapshotOf({ areas: [area], tasks: [walk] }));
  await expect(sync(snapshotOf({}))).rejects.toThrow("This Things snapshot is empty");
  expect((await card((await taskByThingsId("T1"))!)).status).toEqual({ kind: "open" });
});

test("a snapshot with an impossible date is refused", async () => {
  const { sync } = await setup();
  await expect(sync(snapshotOf({ tasks: [{ ...walk, deadline: "2026-02-30" }] }))).rejects.toThrow(
    "This Things snapshot has an invalid date: 2026-02-30.",
  );
});

test("a snapshot needs a Worker token with the things capability", async () => {
  const t = await newBackend();
  const agent = await registerWorker(t, "home-server", ["agent"]);
  await expect(t.mutation(api.planner.things.sync, { token: agent, snapshot: snapshotOf({}) })).rejects.toThrow(
    "This Worker cannot do things work.",
  );
  await expect(t.mutation(api.planner.things.sync, { token: "guess", snapshot: snapshotOf({}) })).rejects.toThrow(
    "This Worker token is not valid.",
  );
});
