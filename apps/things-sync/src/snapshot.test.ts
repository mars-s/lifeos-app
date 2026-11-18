import assert from "node:assert/strict";
import { test } from "node:test";
import { toSnapshot, type RawThings } from "./snapshot.ts";

const column = (rows: { id: string; title: string; status?: string; start?: string; area?: string; tags?: string; project?: string }[]) => ({
  ids: rows.map((row) => row.id),
  titles: rows.map((row) => row.title),
  notes: rows.map(() => ""),
  statuses: rows.map((row) => row.status ?? "open"),
  starts: rows.map((row) => row.start ?? null),
  deadlines: rows.map(() => null),
  tags: rows.map((row) => row.tags ?? ""),
  areas: rows.map((row) => row.area ?? null),
  modified: rows.map(() => 1),
  projects: rows.map((row) => row.project ?? null),
});

const raw = (lists: Partial<RawThings["lists"]>, projects = column([])) =>
  ({
  lists: {
    today: column([]),
    inbox: column([]),
    upcoming: column([]),
    someday: column([]),
    anytime: column([]),
    ...lists,
  },
  projects,
  areas: { ids: ["a1"], titles: ["Personal"] },
  trash: ["x1"],
  }) satisfies RawThings;

const today = "2026-11-18";

test("a task in Today and Anytime is mirrored once, in Today", () => {
  const snapshot = toSnapshot(
    raw({
      today: column([{ id: "t1", title: "Walk", start: "2026-11-18" }]),
      anytime: column([{ id: "t2", title: "Read" }, { id: "t1", title: "Walk", start: "2026-11-18" }]),
    }),
    today,
  )._unsafeUnwrap();
  assert.deepEqual(
    snapshot.tasks.map((task) => [task.thingsId, task.list, task.index]),
    [["t1", "today", 0], ["t2", "anytime", 0]],
  );
});

test("projects listed among to-dos are not mirrored as tasks", () => {
  const snapshot = toSnapshot(
    raw({ today: column([{ id: "p1", title: "Thesis" }, { id: "t1", title: "Draft intro", project: "p1" }]) }, column([{ id: "p1", title: "Thesis", area: "a1" }])),
    today,
  )._unsafeUnwrap();
  assert.deepEqual(snapshot.tasks.map((task) => task.thingsId), ["t1"]);
  assert.equal(snapshot.tasks[0]?.projectThingsId, "p1");
  assert.deepEqual(snapshot.projects.map((project) => [project.thingsId, project.areaThingsId]), [["p1", "a1"]]);
});

test("empty Things fields are left out and tags are split", () => {
  const [task] = toSnapshot(raw({ inbox: column([{ id: "t1", title: "Call", tags: "phone, quick" }]) }), today)._unsafeUnwrap().tasks;
  assert.deepEqual(task, {
    thingsId: "t1",
    title: "Call",
    notes: "",
    status: "open",
    tags: ["phone", "quick"],
    modifiedAt: 1,
    index: 0,
    list: "inbox",
    when: { kind: "inbox" },
  });
});

test("an unknown status or misaligned columns fails instead of guessing", () => {
  const unknown = toSnapshot(raw({ inbox: column([{ id: "t1", title: "Call", status: "paused" }]) }), today);
  assert.deepEqual(unknown._unsafeUnwrapErr(), { kind: "unknown_status", id: "t1", status: "paused" });
  const broken = column([{ id: "t1", title: "Call" }]);
  broken.titles.push("extra");
  assert.deepEqual(toSnapshot(raw({ inbox: broken }), today)._unsafeUnwrapErr(), { kind: "misaligned_columns", where: "inbox" });
});

test("each Things list becomes a When, and Today without a start date means today", () => {
  const snapshot = toSnapshot(
    raw({
      today: column([{ id: "t1", title: "Walk" }, { id: "t0", title: "Overdue essay", start: "2026-11-16" }]),
      upcoming: column([{ id: "t2", title: "Dentist", start: "2026-11-24" }, { id: "t3", title: "Repeating" }]),
      someday: column([{ id: "t4", title: "Learn Welsh" }]),
      anytime: column([{ id: "t5", title: "Read" }]),
    }),
    today,
  )._unsafeUnwrap();
  assert.deepEqual(
    snapshot.tasks.map((task) => [task.thingsId, task.when]),
    [
      ["t1", { kind: "scheduled", date: today, evening: false }],
      ["t0", { kind: "scheduled", date: "2026-11-16", evening: false }],
      ["t2", { kind: "scheduled", date: "2026-11-24", evening: false }],
      ["t3", { kind: "anytime" }],
      ["t4", { kind: "someday" }],
      ["t5", { kind: "anytime" }],
    ],
  );
  assert.deepEqual(snapshot.trash, ["x1"]);
});

test("a Project's start date becomes a Scheduled When", () => {
  const snapshot = toSnapshot(raw({}, column([{ id: "p1", title: "Move house", start: "2026-12-01" }, { id: "p2", title: "Thesis" }])), today)._unsafeUnwrap();
  assert.deepEqual(
    snapshot.projects.map((project) => [project.thingsId, project.when]),
    [
      ["p1", { kind: "scheduled", date: "2026-12-01", evening: false }],
      ["p2", { kind: "anytime" }],
    ],
  );
});
