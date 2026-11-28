import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { newBackend, registerWorker } from "../backend.test-utils";
import { packDate, rowsOf, thingsHeading, thingsItem, thingsProject } from "./things.test-utils";

const switchDay = Date.UTC(2026, 10, 18, 9, 0);
const counts = (inserted: number, updated = 0, unchanged = 0) => ({ inserted, updated, unchanged });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(switchDay);
});

afterEach(() => {
  vi.useRealTimers();
});

const rows = rowsOf({
  areas: [{ uuid: "a1", title: "University", index: 0 }],
  tags: [{ uuid: "g1", title: "Deep Work", index: 0 }],
  items: [
    thingsProject("p1", "Thesis", { area: "a1", deadline: packDate("2026-12-01"), tags: ["g1"] }),
    thingsHeading("h1", "Method", "p1"),
    thingsItem("t1", "Walk", { startDate: packDate("2026-11-18"), tags: ["g1"] }),
    thingsItem("t2", "Water plants", { repeating: true }),
    thingsItem("t3", "Impossible", { deadline: packDate("2026-02-30") }),
    thingsItem("t4", "Odd status", { status: 7 }),
    thingsItem("t5", "Odd type", { type: 9 }),
    thingsItem("t6", "Odd start", { start: 9 }),
    thingsHeading("h2", "Orphan heading", "p1", { project: null }),
  ],
  checklistItems: [
    { uuid: "c1", task: "t1", title: "Shoes", status: 0, index: 0 },
    { uuid: "c2", task: "gone", title: "Lost", status: 3, index: 1 },
  ],
});

test("importRows returns the whole import report as plain JSON", async () => {
  const t = await newBackend();
  const token = await registerWorker(t, "things", ["things"]);
  expect(await t.action(api.planner.things.importRows, { token, rows })).toStrictEqual({
    ok: true,
    value: {
      areas: counts(1),
      labels: counts(1),
      projects: counts(1),
      headings: counts(1),
      tasks: counts(1),
      checklistItems: counts(1),
      skipped: [
        { uuid: "t2", title: "Water plants", reason: "repeating_template" },
        { uuid: "t3", title: "Impossible", reason: "invalid_date" },
        { uuid: "t4", title: "Odd status", reason: "unknown_status" },
        { uuid: "t5", title: "Odd type", reason: "unknown_type" },
        { uuid: "t6", title: "Odd start", reason: "unknown_start" },
        { uuid: "h2", title: "Orphan heading", reason: "missing_parent" },
        { uuid: "c2", title: "Lost", reason: "missing_parent" },
      ],
    },
  });
  expect(await t.action(api.planner.things.importRows, { token, rows })).toStrictEqual({
    ok: true,
    value: {
      areas: counts(0, 0, 1),
      labels: counts(0, 0, 1),
      projects: counts(0, 0, 1),
      headings: counts(0, 0, 1),
      tasks: counts(0, 0, 1),
      checklistItems: counts(0, 0, 1),
      skipped: [
        { uuid: "t2", title: "Water plants", reason: "repeating_template" },
        { uuid: "t3", title: "Impossible", reason: "invalid_date" },
        { uuid: "t4", title: "Odd status", reason: "unknown_status" },
        { uuid: "t5", title: "Odd type", reason: "unknown_type" },
        { uuid: "t6", title: "Odd start", reason: "unknown_start" },
        { uuid: "h2", title: "Orphan heading", reason: "missing_parent" },
        { uuid: "c2", title: "Lost", reason: "missing_parent" },
      ],
    },
  });
});

test("a heading whose project is not in the batch is skipped as missing_parent by the stage", async () => {
  const t = await newBackend();
  const token = await registerWorker(t, "things", ["things"]);
  const report = await t.action(api.planner.things.importRows, {
    token,
    rows: rowsOf({ items: [thingsHeading("h1", "Method", "p9")] }),
  });
  expect(report).toStrictEqual({
    ok: true,
    value: {
      areas: counts(0),
      labels: counts(0),
      projects: counts(0),
      headings: counts(0),
      tasks: counts(0),
      checklistItems: counts(0),
      skipped: [{ uuid: "h1", title: "Method", reason: "missing_parent" }],
    },
  });
});

test("retire refuses before any import, then returns the one retirement date, then refuses imports", async () => {
  const t = await newBackend();
  const token = await registerWorker(t, "things", ["things"]);
  expect(await t.mutation(api.planner.things.retire, { token })).toStrictEqual({
    ok: false,
    error: { kind: "never_imported" },
  });
  await t.action(api.planner.things.importRows, { token, rows: rowsOf({ items: [thingsItem("t1", "Walk")] }) });
  const first = await t.mutation(api.planner.things.retire, { token });
  expect(first).toStrictEqual({ ok: true, value: { retiredAt: expect.any(Number) } });
  const retiredAt = first.ok ? first.value.retiredAt : 0;
  expect(retiredAt - switchDay).toBeLessThan(1000);
  vi.advanceTimersByTime(60_000);
  expect(await t.mutation(api.planner.things.retire, { token })).toStrictEqual({ ok: true, value: { retiredAt } });
  const retired = { ok: false, error: { kind: "retired", retiredAt } };
  expect(await t.action(api.planner.things.importRows, { token, rows })).toStrictEqual(retired);
  expect(await t.mutation(internal.planner.thingsImport.importTasks, { records: [] })).toStrictEqual(retired);
  expect(await t.mutation(internal.planner.thingsImport.importAreas, { records: [] })).toStrictEqual(retired);
  expect(
    await t.mutation(internal.planner.thingsImport.finish, {
      counts: { areas: 0, projects: 0, headings: 0, tasks: 0, checklistItems: 0, labels: 0 },
    }),
  ).toStrictEqual(retired);
  expect(await t.query(internal.planner.thingsImport.retiredAt, {})).toBe(retiredAt);
});

test("stage mutations and finish return counts and the sync date as plain JSON", async () => {
  const t = await newBackend();
  expect(await t.mutation(internal.planner.thingsImport.importAreas, { records: [] })).toStrictEqual({
    ok: true,
    value: { counts: counts(0), skipped: [] },
  });
  const tableCounts = { areas: 1, projects: 2, headings: 3, tasks: 4, checklistItems: 5, labels: 6 };
  expect(await t.mutation(internal.planner.thingsImport.finish, { counts: tableCounts })).toStrictEqual({
    ok: true,
    value: { syncedAt: expect.any(Number) },
  });
  expect(await t.query(internal.planner.thingsImport.retiredAt, {})).toBeNull();
});

test("status returns null, then the stored sync state", async () => {
  const t = await newBackend();
  expect(await t.query(api.planner.things.status, {})).toBeNull();
  const tableCounts = { areas: 1, projects: 2, headings: 3, tasks: 4, checklistItems: 5, labels: 6 };
  await t.mutation(internal.planner.thingsImport.finish, { counts: tableCounts });
  const stored = (await t.run((ctx) => ctx.db.query("thingsSync").first()))!;
  expect(await t.query(api.planner.things.status, {})).toStrictEqual({
    _id: stored._id,
    _creationTime: stored._creationTime,
    syncedAt: stored.syncedAt,
    counts: tableCounts,
  });
});
