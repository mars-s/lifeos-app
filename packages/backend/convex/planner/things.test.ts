import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { newBackend, registerWorker, unwrap } from "../backend.test-utils";
import { packDate, rowsOf, thingsHeading, thingsItem, thingsProject } from "./things.test-utils";

type Rows = ReturnType<typeof rowsOf>;

const switchDay = Date.UTC(2026, 10, 18, 9, 0);
const stopped = 1_763_400_000;
const unchangedCounts = (unchanged: number) => ({ inserted: 0, updated: 0, unchanged });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(switchDay);
});

afterEach(() => {
  vi.useRealTimers();
});

const setup = async () => {
  const t = await newBackend();
  const token = await registerWorker(t, "things", ["things"]);
  const importRows = async (rows: Rows) => unwrap(await t.action(api.planner.things.importRows, { token, rows }));
  const taskFor = async (uuid: string) => {
    const taskId = await t.run(
      async (ctx) =>
        (
          await ctx.db
            .query("tasks")
            .withIndex("by_things_id", (q) => q.eq("things.id", uuid))
            .unique()
        )?._id,
    );
    return (await t.query(api.planner.tasks.card, { taskId: taskId! }))!;
  };
  const all = <T extends "areas" | "labels" | "projects" | "headings" | "tasks" | "checklistItems" | "activity">(table: T) =>
    t.run((ctx) => ctx.db.query(table).collect());
  return { t, token, importRows, taskFor, all };
};

const university = { uuid: "a1", title: "University", index: 0 };
const deepWork = { uuid: "g1", title: "Deep Work", index: 0 };
const thesis = thingsProject("p1", "Thesis", { area: "a1", deadline: packDate("2026-12-01"), tags: ["g1"] });
const walk = thingsItem("t1", "Walk", { start: 1, startDate: packDate("2026-11-18"), tags: ["g1"] });

test("an import brings in Areas, Labels, Projects, Headings, Tasks and Checklist Items under the right parents", async () => {
  const { importRows, taskFor, all } = await setup();
  const report = await importRows(
    rowsOf({
      areas: [university],
      tags: [deepWork],
      items: [
        thesis,
        thingsHeading("h1", "Method", "p1"),
        thingsItem("t2", "Write the method", { heading: "h1", index: 2 }),
        thingsItem("t3", "Read the brief", { project: "p1", index: 1 }),
        thingsItem("t4", "Book a room", { area: "a1" }),
        walk,
      ],
      checklistItems: [
        { uuid: "c2", task: "t2", title: "Second step", status: 3, index: 1 },
        { uuid: "c1", task: "t2", title: "First step", status: 0, index: 0 },
      ],
    }),
  );
  expect(report).toMatchObject({
    areas: { inserted: 1 },
    labels: { inserted: 1 },
    projects: { inserted: 1 },
    headings: { inserted: 1 },
    tasks: { inserted: 4 },
    checklistItems: { inserted: 2 },
    skipped: [],
  });
  const [area] = await all("areas");
  const [label] = await all("labels");
  const [project] = await all("projects");
  const [heading] = await all("headings");
  expect(area).toMatchObject({ title: "University", colour: "violet" });
  expect(label).toMatchObject({ name: "Deep Work", colour: "slate" });
  expect(project).toMatchObject({ title: "Thesis", areaId: area!._id, deadline: "2026-12-01", labelIds: [label!._id] });
  expect(heading).toMatchObject({ title: "Method", projectId: project!._id });

  const method = await taskFor("t2");
  expect(method.parent).toEqual({ kind: "project", projectId: project!._id, headingId: heading!._id });
  expect(method.checklist.map(({ title, done }) => [title, done])).toEqual([
    ["First step", false],
    ["Second step", true],
  ]);
  expect((await taskFor("t3")).parent).toEqual({ kind: "project", projectId: project!._id });
  expect((await taskFor("t4")).parent).toEqual({ kind: "area", areaId: area!._id });
  expect(await taskFor("t1")).toMatchObject({
    parent: { kind: "loose" },
    when: { kind: "scheduled", date: "2026-11-18", evening: false },
    labelIds: [label!._id],
  });
  const brief = await taskFor("t3");
  expect(brief.order < method.order).toBe(true);
});

test("a second identical import changes nothing and records no Activity", async () => {
  const { importRows, all } = await setup();
  const rows = rowsOf({
    areas: [university],
    tags: [deepWork],
    items: [thesis, thingsHeading("h1", "Method", "p1"), walk, thingsItem("t2", "Binned", { trashed: true })],
    checklistItems: [{ uuid: "c1", task: "t1", title: "Shoes", status: 0, index: 0 }],
  });
  await importRows(rows);
  const before = await Promise.all([all("activity"), all("tasks"), all("projects"), all("checklistItems")]);
  expect(await importRows(rows)).toEqual({
    areas: unchangedCounts(1),
    labels: unchangedCounts(1),
    projects: unchangedCounts(1),
    headings: unchangedCounts(1),
    tasks: unchangedCounts(2),
    checklistItems: unchangedCounts(1),
    skipped: [],
  });
  expect(await Promise.all([all("activity"), all("tasks"), all("projects"), all("checklistItems")])).toEqual(before);
});

test("LifeOS wins: a field changed in LifeOS survives later Things edits, and untouched fields follow Things", async () => {
  const { t, importRows, taskFor } = await setup();
  await importRows(rowsOf({ items: [walk] }));
  const taskId = (await taskFor("t1"))._id;
  unwrap(await t.mutation(api.planner.tasks.rename, { taskId, title: "Walk the dog" }));
  unwrap(await t.mutation(api.planner.tasks.setEstimate, { taskId, minutes: 30 }));

  const edited = await importRows(rowsOf({ items: [{ ...walk, title: "Long walk", notes: "Via the beach" }] }));
  expect(edited.tasks).toEqual({ inserted: 0, updated: 1, unchanged: 0 });
  expect(await taskFor("t1")).toMatchObject({ title: "Walk the dog", notes: "Via the beach", estimateMinutes: 30 });

  await importRows(
    rowsOf({ items: [{ ...walk, title: "Longer walk", notes: "Via the beach", startDate: packDate("2026-11-19") }] }),
  );
  expect(await taskFor("t1")).toMatchObject({
    title: "Walk the dog",
    notes: "Via the beach",
    when: { kind: "scheduled", date: "2026-11-19", evening: false },
  });
});

test("a linked record with no base keeps every LifeOS value, then follows Things only where it still matches", async () => {
  const { t, importRows, taskFor } = await setup();
  await t.run((ctx) =>
    ctx.db.insert("tasks", {
      title: "Walk, as LifeOS has it",
      notes: "",
      when: { kind: "anytime" },
      parent: { kind: "loose" },
      labelIds: [],
      status: { kind: "open" },
      order: "a0",
      things: { id: "t1", todayIndex: 0 },
    }),
  );
  const first = await importRows(rowsOf({ items: [{ ...walk, tags: [] }] }));
  expect(first.tasks).toEqual(unchangedCounts(1));
  expect(await taskFor("t1")).toMatchObject({ title: "Walk, as LifeOS has it", when: { kind: "anytime" } });

  await importRows(rowsOf({ items: [{ ...walk, tags: [], title: "Renamed in Things", notes: "New notes" }] }));
  expect(await taskFor("t1")).toMatchObject({ title: "Walk, as LifeOS has it", notes: "New notes", when: { kind: "anytime" } });
});

test("the Logbook keeps completion and cancellation times, and Trash keeps one stable trashedAt", async () => {
  const { importRows, taskFor, all } = await setup();
  const rows = rowsOf({
    items: [
      thingsItem("t1", "Done", { status: 3, stopDate: stopped }),
      thingsItem("t2", "Dropped", { status: 2, stopDate: stopped + 60 }),
      thingsItem("t3", "Binned", { trashed: true, modifiedAt: stopped }),
      thingsProject("p1", "Old project", { trashed: true, status: 3, stopDate: stopped, modifiedAt: stopped + 5 }),
    ],
  });
  await importRows(rows);
  expect((await taskFor("t1")).status).toEqual({ kind: "completed", at: stopped * 1000 });
  expect((await taskFor("t2")).status).toEqual({ kind: "canceled", at: (stopped + 60) * 1000 });
  expect(await taskFor("t3")).toMatchObject({ status: { kind: "open" }, trashedAt: stopped * 1000 });
  expect((await all("projects"))[0]).toMatchObject({
    status: { kind: "completed", at: stopped * 1000 },
    trashedAt: (stopped + 5) * 1000,
  });

  const activity = await all("activity");
  const touched = await importRows(
    rowsOf({
      items: rows.items.map((item) => (item.trashed ? { ...item, modifiedAt: stopped + 3600 } : item)),
    }),
  );
  expect(touched.tasks).toEqual(unchangedCounts(3));
  expect(touched.projects).toEqual(unchangedCounts(1));
  expect((await taskFor("t3")).trashedAt).toBe(stopped * 1000);
  expect(await all("activity")).toEqual(activity);
});

test("a record that leaves Things is left exactly as it is", async () => {
  const { importRows, taskFor, all } = await setup();
  await importRows(rowsOf({ areas: [university], items: [walk, thingsItem("t2", "Post letter", { area: "a1" })] }));
  const errand = await taskFor("t2");
  const activity = await all("activity");
  const report = await importRows(rowsOf({ items: [walk] }));
  expect(report.tasks).toEqual(unchangedCounts(1));
  expect(await taskFor("t2")).toEqual(errand);
  expect(await all("areas")).toHaveLength(1);
  expect(await all("activity")).toEqual(activity);
});

test("a Things Tag with the name of an existing Label links that Label instead of adding another", async () => {
  const { t, importRows, taskFor, all } = await setup();
  const { labelId } = unwrap(await t.mutation(api.planner.labels.create, { name: "Deep Work", colour: "teal" }));
  const report = await importRows(rowsOf({ tags: [deepWork], items: [walk] }));
  expect(report.labels).toEqual(unchangedCounts(1));
  expect(await all("labels")).toMatchObject([{ _id: labelId, name: "Deep Work", colour: "teal", things: { id: "g1" } }]);
  expect((await taskFor("t1")).labelIds).toEqual([labelId]);
});

test("a large import runs in batches and keeps Things order", async () => {
  const { importRows, all } = await setup();
  const items = Array.from({ length: 450 }, (_, index) =>
    thingsItem(`t${index}`, `Logged ${index}`, { status: 3, stopDate: stopped + index, index }),
  );
  const report = await importRows(rowsOf({ items: items.toReversed() }));
  expect(report.tasks).toEqual({ inserted: 450, updated: 0, unchanged: 0 });
  const titles = (await all("tasks")).toSorted((a, b) => (a.order < b.order ? -1 : 1)).map(({ title }) => title);
  expect(titles).toEqual(items.map(({ title }) => title));
});

test("repeating templates and unreadable records are reported as skipped", async () => {
  const { importRows, all } = await setup();
  const report = await importRows(
    rowsOf({
      items: [
        thingsItem("t1", "Water plants", { repeating: true }),
        thingsItem("t2", "Impossible", { deadline: packDate("2026-02-30") }),
        walk,
      ],
    }),
  );
  expect(report.skipped).toEqual([
    { uuid: "t1", title: "Water plants", reason: "repeating_template" },
    { uuid: "t2", title: "Impossible", reason: "invalid_date" },
  ]);
  expect((await all("tasks")).map(({ title }) => title)).toEqual(["Walk"]);
});

test("switch day retires Things once: imports and later batches are refused, and retiring again keeps the date", async () => {
  const { t, token, importRows, all } = await setup();
  expect(await t.mutation(api.planner.things.retire, { token })).toEqual({ ok: false, error: { kind: "never_imported" } });
  await importRows(rowsOf({ items: [walk] }));
  const { retiredAt } = unwrap(await t.mutation(api.planner.things.retire, { token }));
  expect(retiredAt - switchDay).toBeLessThan(1000);
  vi.advanceTimersByTime(60_000);
  expect(unwrap(await t.mutation(api.planner.things.retire, { token }))).toEqual({ retiredAt });
  expect(await t.query(api.planner.things.status, {})).toMatchObject({ retiredAt, counts: { tasks: 1 } });

  const tasks = await all("tasks");
  const retired = { ok: false, error: { kind: "retired", retiredAt } };
  const changed = rowsOf({ items: [{ ...walk, title: "Changed after switch day" }, thingsItem("t9", "New in Things")] });
  expect(await t.action(api.planner.things.importRows, { token, rows: changed })).toEqual(retired);
  expect(await t.mutation(internal.planner.thingsImport.importTasks, { records: [] })).toEqual(retired);
  expect(
    await t.mutation(internal.planner.thingsImport.finish, {
      counts: { areas: 0, projects: 0, headings: 0, tasks: 0, checklistItems: 0, labels: 0 },
    }),
  ).toEqual(retired);
  expect(await all("tasks")).toEqual(tasks);
});

test("imports and retirement need a Worker token with the things capability", async () => {
  const { t } = await setup();
  const agent = await registerWorker(t, "home-server", ["agent"]);
  await expect(t.action(api.planner.things.importRows, { token: agent, rows: rowsOf({}) })).rejects.toThrow(
    "This Worker cannot do things work.",
  );
  await expect(t.mutation(api.planner.things.retire, { token: agent })).rejects.toThrow("This Worker cannot do things work.");
  await expect(t.action(api.planner.things.importRows, { token: "guess", rows: rowsOf({}) })).rejects.toThrow(
    "This Worker token is not valid.",
  );
  await expect(t.mutation(api.planner.things.retire, { token: "guess" })).rejects.toThrow("This Worker token is not valid.");
  expect(await t.run((ctx) => ctx.db.query("thingsSync").collect())).toEqual([]);
});

test("the sync state records when and how much was imported", async () => {
  const { t, importRows } = await setup();
  expect(await t.query(api.planner.things.status, {})).toBeNull();
  await importRows(rowsOf({ areas: [university], tags: [deepWork], items: [thesis, walk] }));
  const state = await t.query(api.planner.things.status, {});
  expect(state).toMatchObject({ counts: { areas: 1, labels: 1, projects: 1, headings: 0, tasks: 1, checklistItems: 0 } });
  expect(state!.syncedAt - switchDay).toBeLessThan(1000);
  expect(state!.retiredAt).toBeUndefined();
});
