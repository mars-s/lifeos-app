import assert from "node:assert/strict";
import { test } from "node:test";
import { dryRunCounts, importLines, packedDate, retiredLine, type ImportReport } from "./report.ts";
import type { ThingsRows } from "./things.ts";

type Item = ThingsRows["items"][number];

const pack = (date: string) => {
  const [year = 0, month = 0, day = 0] = date.split("-").map(Number);
  return (year << 16) | (month << 12) | (day << 7);
};

const item = (uuid: string, fields: Partial<Item> = {}) =>
  ({
    uuid,
    type: 0,
    title: uuid,
    notes: "",
    status: 0,
    trashed: false,
    start: 1,
    startDate: null,
    evening: false,
    deadline: null,
    stopDate: null,
    modifiedAt: null,
    index: 0,
    todayIndex: 0,
    area: null,
    project: null,
    heading: null,
    repeating: false,
    tags: [],
    ...fields,
  }) satisfies Item;

test("a packed Things date unpacks to an ISO date", () => {
  assert.equal(packedDate(pack("2026-11-18")), "2026-11-18");
  assert.equal(packedDate(132_718_720), "2025-02-01");
});

test("the dry run counts every Things list the way Things shows it", () => {
  const today = "2026-11-18";
  const rows = {
    areas: [{ uuid: "a1", title: "University", index: 0 }],
    tags: [{ uuid: "g1", title: "Errand", index: 0 }],
    items: [
      item("inbox", { start: 0 }),
      item("today", { startDate: pack(today) }),
      item("overdue", { startDate: pack("2026-11-01") }),
      item("evening", { startDate: pack(today), evening: true }),
      item("upcoming", { start: 2, startDate: pack("2026-12-01") }),
      item("anytime"),
      item("someday", { start: 2 }),
      item("done", { status: 3 }),
      item("dropped", { status: 2 }),
      item("binned", { trashed: true, status: 3 }),
      item("template", { repeating: true }),
      item("project", { type: 1 }),
      item("finished project", { type: 1, status: 3 }),
      item("heading", { type: 2, project: "project" }),
    ],
    checklistItems: [{ uuid: "c1", task: "today", title: "Step", status: 0, index: 0 }],
  } satisfies ThingsRows;
  assert.deepEqual(Object.fromEntries(dryRunCounts(rows, today)), {
    Inbox: 1,
    Today: 2,
    "This Evening": 1,
    Upcoming: 1,
    Anytime: 1,
    Someday: 1,
    "Logbook completed": 1,
    "Logbook canceled": 1,
    Trash: 1,
    "Projects open": 1,
    "Projects completed": 1,
    "Projects canceled": 0,
    "Projects trashed": 0,
    Areas: 1,
    Headings: 1,
    "Checklist Items": 1,
    Tags: 1,
    "Repeating templates": 1,
  });
});

test("the import report reads as one line per table, then each skipped record and why", () => {
  const counts = { inserted: 0, updated: 0, unchanged: 0 };
  const report = {
    areas: counts,
    labels: counts,
    projects: counts,
    headings: counts,
    tasks: { inserted: 3, updated: 1, unchanged: 40 },
    checklistItems: counts,
    skipped: [{ uuid: "t9", title: "Water plants", reason: "repeating_template" }],
  } satisfies ImportReport;
  const lines = importLines(report);
  assert.ok(lines.includes("  Tasks: 3 new, 1 changed, 40 unchanged"));
  assert.deepEqual(lines.slice(-2), ["  Skipped 1:", '    "Water plants" (t9): a repeating template, not a real to-do']);
});

test("after switch day every mode says politely that Things was retired", () => {
  assert.equal(
    retiredLine(Date.UTC(2026, 10, 18, 1)),
    "Things was retired on 18 November 2026. LifeOS no longer reads from Things.",
  );
});
