import { expect, test } from "vitest";
import { packDate, rowsOf, thingsHeading, thingsItem, thingsProject } from "./things.test-utils";
import { fromThingsRows } from "./thingsRows";

const today = "2026-11-18";
const stopped = 1_763_440_000.25;

const whenOf = (incoming: ReturnType<typeof fromThingsRows>) =>
  Object.fromEntries(incoming.tasks.map((task) => [task.title, task.when]));

test("each Things list becomes the right When, with This Evening kept apart", () => {
  const incoming = fromThingsRows(
    rowsOf({
      items: [
        thingsItem("t1", "Inbox", { start: 0 }),
        thingsItem("t2", "Anytime", { start: 1 }),
        thingsItem("t3", "Someday", { start: 2 }),
        thingsItem("t4", "Today", { start: 1, startDate: packDate(today) }),
        thingsItem("t5", "This Evening", { start: 1, startDate: packDate(today), evening: true }),
        thingsItem("t6", "Upcoming", { start: 2, startDate: packDate("2026-12-01") }),
      ],
    }),
  );
  expect(whenOf(incoming)).toEqual({
    Inbox: { kind: "inbox" },
    Anytime: { kind: "anytime" },
    Someday: { kind: "someday" },
    Today: { kind: "scheduled", date: today, evening: false },
    "This Evening": { kind: "scheduled", date: today, evening: true },
    Upcoming: { kind: "scheduled", date: "2026-12-01", evening: false },
  });
  expect(incoming.skipped).toEqual([]);
});

test("the Logbook keeps each completion and cancellation at its real time, and Trash keeps when it was binned", () => {
  const incoming = fromThingsRows(
    rowsOf({
      items: [
        thingsItem("t1", "Done", { status: 3, stopDate: stopped, modifiedAt: stopped + 60 }),
        thingsItem("t2", "Dropped", { status: 2, stopDate: stopped }),
        thingsItem("t3", "Done without a stop date", { status: 3, stopDate: null, modifiedAt: stopped }),
        thingsItem("t4", "Done with no dates", { status: 3, stopDate: null, modifiedAt: null }),
        thingsItem("t5", "Binned", { trashed: true, modifiedAt: stopped }),
        thingsItem("t6", "Open", { deadline: packDate("2026-11-27") }),
      ],
    }),
  );
  expect(incoming.tasks.map(({ title, status, trashedAt, deadline }) => ({ title, status, trashedAt, deadline }))).toEqual([
    { title: "Done", status: { kind: "completed", at: 1_763_440_000_250 }, trashedAt: undefined, deadline: undefined },
    { title: "Dropped", status: { kind: "canceled", at: 1_763_440_000_250 }, trashedAt: undefined, deadline: undefined },
    {
      title: "Done without a stop date",
      status: { kind: "completed", at: 1_763_440_000_250 },
      trashedAt: undefined,
      deadline: undefined,
    },
    { title: "Done with no dates", status: { kind: "completed", at: 0 }, trashedAt: undefined, deadline: undefined },
    { title: "Binned", status: { kind: "open" }, trashedAt: 1_763_440_000_250, deadline: undefined },
    { title: "Open", status: { kind: "open" }, trashedAt: undefined, deadline: "2026-11-27" },
  ]);
  expect(incoming.tasks.filter((task) => "trashedAt" in task).map(({ title }) => title)).toEqual(["Binned"]);
});

test("a to-do under a heading lands in the heading's Project; otherwise its Project, then its Area, then loose", () => {
  const incoming = fromThingsRows(
    rowsOf({
      areas: [{ uuid: "a1", title: "University", index: 0 }],
      items: [
        thingsProject("p1", "Thesis", { area: "a1" }),
        thingsHeading("h1", "Method", "p1"),
        thingsItem("t1", "Under heading", { heading: "h1" }),
        thingsItem("t2", "In project", { project: "p1" }),
        thingsItem("t3", "In area", { area: "a1" }),
        thingsItem("t4", "Loose"),
      ],
    }),
  );
  expect(incoming.projects).toMatchObject([{ uuid: "p1", title: "Thesis", area: "a1" }]);
  expect(incoming.headings).toEqual([{ uuid: "h1", title: "Method", project: "p1" }]);
  expect(Object.fromEntries(incoming.tasks.map(({ title, parent }) => [title, parent]))).toEqual({
    "Under heading": { kind: "project", project: "p1", heading: "h1" },
    "In project": { kind: "project", project: "p1" },
    "In area": { kind: "area", area: "a1" },
    Loose: { kind: "loose" },
  });
});

test("repeating templates are skipped and counted, with their Checklist Items", () => {
  const incoming = fromThingsRows(
    rowsOf({
      items: [thingsItem("t1", "Water plants", { repeating: true }), thingsItem("t2", "Water plants today")],
      checklistItems: [
        { uuid: "c1", task: "t1", title: "Ferns", status: 0, index: 0 },
        { uuid: "c2", task: "t2", title: "Ferns", status: 3, index: 0 },
      ],
    }),
  );
  expect(incoming.tasks.map(({ uuid }) => uuid)).toEqual(["t2"]);
  expect(incoming.checklistItems).toEqual([{ uuid: "c2", task: "t2", title: "Ferns", done: true }]);
  expect(incoming.skipped).toEqual([
    { uuid: "t1", title: "Water plants", reason: "repeating_template" },
    { uuid: "c1", title: "Ferns", reason: "missing_parent" },
  ]);
});

test("a record with an impossible date or an unknown status is reported, and the rest still import", () => {
  const incoming = fromThingsRows(
    rowsOf({
      items: [
        thingsItem("t1", "Bad start", { startDate: packDate("2026-02-30") }),
        thingsItem("t2", "Bad deadline", { deadline: packDate("2026-13-01") }),
        thingsProject("p1", "Odd status", { status: 9 }),
        thingsItem("t3", "Odd start", { start: 7 }),
        thingsItem("t4", "Fine"),
      ],
    }),
  );
  expect(incoming.tasks.map(({ title }) => title)).toEqual(["Fine"]);
  expect(incoming.projects).toEqual([]);
  expect(incoming.skipped).toEqual([
    { uuid: "t1", title: "Bad start", reason: "invalid_date" },
    { uuid: "t2", title: "Bad deadline", reason: "invalid_date" },
    { uuid: "p1", title: "Odd status", reason: "unknown_status" },
    { uuid: "t3", title: "Odd start", reason: "unknown_start" },
  ]);
});

test("records come out in Things order, Areas take colours by position, Tags become Labels, Checklist done means not open", () => {
  const incoming = fromThingsRows(
    rowsOf({
      areas: Array.from({ length: 9 }, (_, index) => ({ uuid: `a${index}`, title: `Area ${index}`, index: 9 - index })),
      tags: [
        { uuid: "g2", title: "Errand", index: 2 },
        { uuid: "g1", title: "Deep Work", index: 1 },
      ],
      items: [
        thingsItem("t2", "Second", { index: 20, tags: ["g1"] }),
        thingsItem("t1", "First", { index: -5, todayIndex: -300 }),
      ],
      checklistItems: [
        { uuid: "c2", task: "t1", title: "Cancelled step", status: 2, index: 1 },
        { uuid: "c1", task: "t1", title: "Open step", status: 0, index: 0 },
      ],
    }),
  );
  expect(incoming.areas.map(({ title, colour }) => [title, colour])).toEqual([
    ["Area 8", "violet"],
    ["Area 7", "green"],
    ["Area 6", "orange"],
    ["Area 5", "teal"],
    ["Area 4", "rose"],
    ["Area 3", "olive"],
    ["Area 2", "plum"],
    ["Area 1", "slate"],
    ["Area 0", "violet"],
  ]);
  expect(incoming.labels).toEqual([
    { uuid: "g1", name: "Deep Work" },
    { uuid: "g2", name: "Errand" },
  ]);
  expect(incoming.tasks.map(({ title, tags, todayIndex }) => [title, tags, todayIndex])).toEqual([
    ["First", [], -300],
    ["Second", ["g1"], 0],
  ]);
  expect(incoming.checklistItems.map(({ title, done }) => [title, done])).toEqual([
    ["Open step", false],
    ["Cancelled step", true],
  ]);
});

test("a heading without a Project is reported rather than imported", () => {
  const incoming = fromThingsRows(rowsOf({ items: [thingsItem("h1", "Orphan heading", { type: 2 })] }));
  expect(incoming.headings).toEqual([]);
  expect(incoming.skipped).toEqual([{ uuid: "h1", title: "Orphan heading", reason: "missing_parent" }]);
});
