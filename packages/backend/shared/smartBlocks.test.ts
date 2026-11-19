import { describe, expect, test } from "vitest";
import {
  ALL_TASKS,
  DEFAULT_FILL_MINUTES,
  FOREVER,
  fillSmartBlock,
  occursOnDate,
  type FillBlock,
  type FillSnapshot,
  type FillTask,
  type SmartBlockFilter,
} from "./smartBlocks";

const DATE = "2026-11-20";
const DAY_MS = 86_400_000;
const created = Date.parse(`${DATE}T00:00:00Z`) - DAY_MS;
const FOCUS = { start: 16 * 60, end: 18 * 60 };
const EARLY = 0;

const task = (id: string, fields: Partial<FillTask> = {}) =>
  ({
    _id: id,
    title: id,
    labelIds: [],
    createdAt: created,
    estimateMinutes: 30,
    ...fields,
  }) satisfies FillTask;

const snapshot = (fields: Partial<FillSnapshot> = {}) =>
  ({
  date: DATE,
  tasks: [],
  blocks: [],
  busy: [],
  areas: [
    { _id: "uni", title: "University" },
    { _id: "personal", title: "Personal" },
  ],
  freeMinutes: Array.from({ length: 31 }, () => 480),
  ...fields,
  }) satisfies FillSnapshot;

const fill = (shot: FillSnapshot, options: { window?: { start: number; end: number }; filter?: SmartBlockFilter; now?: number; blockId?: string | null } = {}) =>
  fillSmartBlock({
    snapshot: shot,
    blockId: options.blockId ?? "focus",
    window: options.window ?? FOCUS,
    filter: options.filter ?? ALL_TASKS,
    now: options.now ?? EARLY,
  });

const placed = (result: ReturnType<typeof fill>) => result.picks.map((pick) => [pick.task._id, pick.start, pick.minutes]);

describe("filling a Smart Block", () => {
  test("gives the same fill for the same inputs, whatever order the Tasks arrive in", () => {
    const tasks = [
      task("a", { areaId: "personal", estimateMinutes: 35 }),
      task("b", { areaId: "uni", estimateMinutes: 25 }),
      task("c", { estimateMinutes: 20 }),
      task("d", { areaId: "uni", estimateMinutes: 25 }),
    ];
    const first = fill(snapshot({ tasks }));
    expect(fill(snapshot({ tasks }))).toEqual(first);
    expect(placed(fill(snapshot({ tasks: tasks.toReversed() })))).toEqual(placed(first));
    expect(placed(first)).toEqual([
      ["b", 960, 25],
      ["d", 990, 25],
      ["c", 1020, 20],
      ["a", 1045, 35],
    ]);
  });

  test("never places anything outside the window, and leaves five minutes between Tasks", () => {
    const tasks = Array.from({ length: 8 }, (_, index) => task(`t${index}`, { estimateMinutes: 25 }));
    const result = fill(snapshot({ tasks }));
    for (const pick of result.picks) {
      expect(pick.start).toBeGreaterThanOrEqual(FOCUS.start);
      expect(pick.start + pick.minutes).toBeLessThanOrEqual(FOCUS.end);
    }
    const starts = result.picks.map((pick) => pick.start);
    expect(starts).toEqual([960, 990, 1020, 1050]);
    expect(result.skipped.map((skip) => skip.why)).toEqual(["no_room", "no_room", "no_room", "no_room"]);
  });

  test("busy External Commitments and other Work Blocks shrink the usable time", () => {
    const busy = [{ start: 16 * 60 + 30, end: 17 * 60 }];
    const blocks: FillBlock[] = [{ blockId: "w1", taskId: "manual", start: 17 * 60 + 30, minutes: 30 }];
    const result = fill(snapshot({ busy, blocks, tasks: [task("a", { estimateMinutes: 25 }), task("b", { estimateMinutes: 20 }), task("c", { estimateMinutes: 15 })] }));
    expect(result.freeMinutes).toBe(25 + 20);
    expect(placed(result)).toEqual([
      ["a", 960, 25],
      ["b", 1025, 20],
    ]);
    expect(result.skipped.map((skip) => [skip.task._id, skip.why])).toEqual([["c", "no_room"]]);
  });

  test("only Tasks that match the Areas, Projects and Labels of the block are eligible", () => {
    const tasks = [
      task("uni-deep", { areaId: "uni", labelIds: ["deep"] }),
      task("uni-admin", { areaId: "uni", labelIds: ["admin"] }),
      task("thesis", { projectId: "thesis", labelIds: ["deep"] }),
      task("home", { areaId: "personal", labelIds: ["deep"] }),
    ];
    const ids = (filter: SmartBlockFilter) => fill(snapshot({ tasks }), { filter }).picks.map((pick) => pick.task._id).toSorted();
    expect(ids({ areaIds: ["uni"], projectIds: [], labelIds: [] })).toEqual(["uni-admin", "uni-deep"]);
    expect(ids({ areaIds: ["uni"], projectIds: ["thesis"], labelIds: ["deep"] })).toEqual(["thesis", "uni-deep"]);
    expect(ids({ areaIds: [], projectIds: [], labelIds: ["admin"] })).toEqual(["uni-admin"]);
  });

  test("ranks by Area priority, with Tasks outside any Area in the middle", () => {
    const tasks = [task("personal", { areaId: "personal" }), task("loose"), task("uni", { areaId: "uni" })];
    const result = fill(snapshot({ tasks }));
    expect(result.picks.map((pick) => pick.task._id)).toEqual(["uni", "loose", "personal"]);
    expect(result.picks[0]?.reason).toBe("University first");
  });

  test("a near Deadline beats Area priority and says so", () => {
    const tasks = [task("uni", { areaId: "uni" }), task("essay", { areaId: "personal", deadline: "2026-11-21" }), task("tax", { deadline: "2026-11-25" })];
    const result = fill(snapshot({ tasks }));
    expect(result.picks.map((pick) => [pick.task._id, pick.reason])).toEqual([
      ["essay", "Deadline tomorrow"],
      ["uni", "University first"],
      ["tax", "Deadline Wednesday"],
    ]);
  });

  test("a far Deadline matters once the time left before it is short", () => {
    const freeMinutes = Array.from({ length: 31 }, () => 5);
    const tasks = [task("uni", { areaId: "uni" }), task("report", { areaId: "personal", deadline: "2026-12-04", estimateMinutes: 90 })];
    const result = fill(snapshot({ tasks, freeMinutes }));
    expect(result.picks[0]?.task._id).toBe("report");
    expect(result.picks[0]?.reason).toBe("Deadline 4 Dec");
  });

  test("Tasks committed to the day and Tasks waiting long come before fresh ones", () => {
    const tasks = [task("fresh"), task("planned", { scheduled: DATE }), task("old", { createdAt: created - 40 * DAY_MS })];
    expect(fill(snapshot({ tasks, areas: [] })).picks.map((pick) => [pick.task._id, pick.reason])).toEqual([
      ["planned", "On the Day Plan"],
      ["old", "Waiting 5 weeks"],
      ["fresh", "Fits the time"],
    ]);
  });

  test("Day Plan order and then the Task id break ties", () => {
    const tasks = [task("z", { planOrder: "a1", scheduled: DATE }), task("y", { planOrder: "a0", scheduled: DATE }), task("x"), task("w")].map((each) => ({ ...each, estimateMinutes: 20 }));
    expect(fill(snapshot({ tasks, areas: [] })).picks.map((pick) => pick.task._id)).toEqual(["y", "z", "w", "x"]);
  });

  test("sizes a Task by its Estimate, else its Smart Estimate as a guess, else a default", () => {
    const tasks = [task("estimated", { estimateMinutes: 22 }), task("guessed", { estimateMinutes: undefined, guessMinutes: 40 }), task("bare", { estimateMinutes: undefined })];
    const result = fill(snapshot({ tasks, areas: [] }));
    expect(result.picks.map((pick) => [pick.task._id, pick.minutes, pick.source])).toEqual([
      ["bare", DEFAULT_FILL_MINUTES, "default"],
      ["estimated", 25, "estimate"],
      ["guessed", 40, "guess"],
    ]);
  });

  test("skips a Task too long for the window with a note, and fills the space with smaller ones", () => {
    const tasks = [task("big", { areaId: "uni", estimateMinutes: 150 }), task("mid", { areaId: "uni", estimateMinutes: 90 }), task("small", { estimateMinutes: 25 })];
    const result = fill(snapshot({ tasks }));
    expect(result.skipped.map((skip) => [skip.task._id, skip.why])).toEqual([["big", "too_long"]]);
    expect(placed(result)).toEqual([
      ["mid", 960, 90],
      ["small", 1055, 25],
    ]);
    expect(result.filledMinutes).toBe(115);
  });

  test("best fit puts a Task in the smallest gap it fits, keeping the big gap for big work", () => {
    const busy = [{ start: 16 * 60 + 30, end: 16 * 60 + 40 }];
    const tasks = [task("short", { areaId: "uni", estimateMinutes: 20 }), task("long", { areaId: "personal", estimateMinutes: 60 })];
    expect(placed(fill(snapshot({ tasks, busy })))).toEqual([
      ["short", 960, 20],
      ["long", 1005, 60],
    ]);
  });

  test("starts no earlier than now", () => {
    const result = fill(snapshot({ tasks: [task("a")] }), { now: 17 * 60 + 2 });
    expect(placed(result)).toEqual([["a", 1025, 30]]);
  });

  test("a refill keeps accepted Work Blocks and frees only those whose Task is done, removed or no longer eligible", () => {
    const blocks: FillBlock[] = [
      { blockId: "w-kept", taskId: "kept", start: 990, minutes: 30, smartBlock: { blockId: "focus", date: DATE } },
      { blockId: "w-done", taskId: "done", start: 1025, minutes: 30, smartBlock: { blockId: "focus", date: DATE } },
      { blockId: "w-moved", taskId: "moved", start: 1060, minutes: 20, smartBlock: { blockId: "focus", date: DATE } },
      { blockId: "w-past", taskId: "gone", start: 960, minutes: 25, smartBlock: { blockId: "focus", date: DATE } },
      { blockId: "w-other", taskId: "elsewhere", start: 600, minutes: 30, smartBlock: { blockId: "admin", date: DATE } },
    ];
    const tasks = [task("kept", { areaId: "uni" }), task("moved", { areaId: "personal" }), task("new", { areaId: "uni", estimateMinutes: 30 }), task("elsewhere")];
    const result = fill(snapshot({ tasks, blocks }), { filter: { areaIds: ["uni"], projectIds: [], labelIds: [] }, now: 980 });
    expect(result.kept.map((block) => block.blockId)).toEqual(["w-kept", "w-past"]);
    expect(result.released.map((block) => block.blockId)).toEqual(["w-done", "w-moved"]);
    expect(placed(result)).toEqual([["new", 1025, 30]]);
  });

  test("removing a Task lets the next one take its place, and a pick of Avi's goes first", () => {
    const tasks = [task("a", { areaId: "uni", estimateMinutes: 60 }), task("b", { areaId: "uni", estimateMinutes: 55 }), task("c", { estimateMinutes: 55 })];
    const base = fillSmartBlock({ snapshot: snapshot({ tasks }), blockId: "focus", window: FOCUS, filter: ALL_TASKS, now: 0 });
    expect(base.picks.map((pick) => pick.task._id)).toEqual(["a", "b"]);
    expect(base.spare.map((spare) => spare.task._id)).toEqual(["c"]);
    const edited = fillSmartBlock({
      snapshot: snapshot({ tasks }),
      blockId: "focus",
      window: FOCUS,
      filter: ALL_TASKS,
      now: 0,
      edits: { exclude: ["a"], prefer: ["c"] },
    });
    expect(edited.picks.map((pick) => [pick.task._id, pick.reason])).toEqual([
      ["c", "Your pick"],
      ["b", "University first"],
    ]);
  });

  test("an overdue Task and one due today come first, and say so", () => {
    const tasks = [task("uni", { areaId: "uni" }), task("late", { areaId: "personal", deadline: "2026-11-18" }), task("today", { areaId: "personal", deadline: DATE })];
    expect(fill(snapshot({ tasks })).picks.map((pick) => [pick.task._id, pick.reason])).toEqual([
      ["late", "Overdue"],
      ["today", "Due today"],
      ["uni", "University first"],
    ]);
  });

  test("a Task on the Day Plan order goes before one off it when they rank the same", () => {
    const tasks = [task("a"), task("b", { planOrder: "a0" }), task("c"), task("d", { planOrder: "a1" })].map((each) => ({ ...each, estimateMinutes: 20 }));
    expect(fill(snapshot({ tasks, areas: [] })).picks.map((pick) => pick.task._id)).toEqual(["b", "d", "a", "c"]);
  });

  test("picks go first in the order Avi gave, and an excluded pick stays out", () => {
    const tasks = [task("a", { areaId: "uni" }), task("b", { areaId: "uni" }), task("c"), task("d")];
    const result = fillSmartBlock({
      snapshot: snapshot({ tasks }),
      blockId: "focus",
      window: FOCUS,
      filter: ALL_TASKS,
      now: EARLY,
      edits: { exclude: ["b"], prefer: ["d", "b", "c", "missing"] },
    });
    expect(result.picks.map((pick) => [pick.task._id, pick.reason])).toEqual([
      ["d", "Your pick"],
      ["c", "Your pick"],
      ["a", "University first"],
    ]);
  });

  test("works with no Tasks, no Areas and no free time known", () => {
    const empty = fill(snapshot({ areas: [], freeMinutes: [] }));
    expect(empty).toMatchObject({ picks: [], kept: [], released: [], skipped: [], spare: [], freeMinutes: 120, filledMinutes: 0 });
    const tasks = [task("soon", { deadline: "2026-12-20" }), task("free")];
    expect(fill(snapshot({ tasks, areas: [], freeMinutes: [] })).picks.map((pick) => pick.task._id)).toEqual(["soon", "free"]);
  });

  test("with one Area its Tasks carry its name, not a claim to come first", () => {
    const result = fill(snapshot({ tasks: [task("a", { areaId: "uni" })], areas: [{ _id: "uni", title: "University" }] }));
    expect(result.picks[0]?.reason).toBe("University");
  });

  test("busy time after the window and a now past its end leave it as it is", () => {
    const busy = [{ start: 19 * 60, end: 20 * 60 }];
    expect(fill(snapshot({ busy, tasks: [task("a")] })).freeMinutes).toBe(120);
    const late = fill(snapshot({ tasks: [task("a")] }), { now: 18 * 60 + 30 });
    expect(late).toMatchObject({ picks: [], freeMinutes: 0 });
    expect(late.skipped.map((skip) => skip.why)).toEqual(["too_long"]);
  });

  test("a gap shorter than five minutes after rounding to the step is not counted", () => {
    const busy = [{ start: 16 * 60 + 9, end: 17 * 60 }];
    expect(fill(snapshot({ busy, tasks: [] })).freeMinutes).toBe(18 * 60 - 17 * 60 - 5);
  });

  test("a resized window refills live", () => {
    const tasks = [task("a", { estimateMinutes: 60 }), task("b", { estimateMinutes: 60 })];
    expect(fill(snapshot({ tasks, areas: [] }), { window: { start: 960, end: 1030 } }).picks).toHaveLength(1);
    expect(fill(snapshot({ tasks, areas: [] }), { window: { start: 960, end: 1090 } }).picks).toHaveLength(2);
  });
});

const block = (schedule: Parameters<typeof occursOnDate>[0]["repeat"], date = "2026-11-02", until = FOREVER) => ({ date, until, repeat: schedule });

describe("when a Smart Block occurs", () => {
  test("a one-off block occurs only on its date", () => {
    expect(occursOnDate({ date: DATE, until: DATE }, DATE)).toBe(true);
    expect(occursOnDate({ date: DATE, until: DATE }, "2026-11-21")).toBe(false);
  });

  test("daily, weekdays and weekly on chosen days", () => {
    const daily = block({ schedule: { kind: "days", every: 1 }, skipped: ["2026-11-04"] });
    expect(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"].map((date) => occursOnDate(daily, date))).toEqual([true, true, false, true]);
    const weekdays = block({ schedule: { kind: "weekdays" }, skipped: [] });
    expect(["2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"].map((date) => occursOnDate(weekdays, date))).toEqual([true, false, false, true]);
    const tueThu = block({ schedule: { kind: "weeks", every: 1, days: [2, 4] }, skipped: [] });
    expect(["2026-11-02", "2026-11-03", "2026-11-05", "2026-11-10"].map((date) => occursOnDate(tueThu, date))).toEqual([false, true, true, true]);
    expect(occursOnDate(tueThu, "2026-11-01")).toBe(false);
  });

  test("fortnightly keeps the rhythm of its first week", () => {
    const fortnightly = block({ schedule: { kind: "weeks", every: 2, days: [1] }, skipped: [] });
    expect(["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"].map((date) => occursOnDate(fortnightly, date))).toEqual([
      true,
      false,
      true,
      false,
      true,
    ]);
  });

  test("monthly on the 31st lands on the last day of shorter months, and the last Friday works", () => {
    const thirtyFirst = block({ schedule: { kind: "months", every: 1, on: { kind: "day", day: 31 } }, skipped: [] }, "2026-01-31");
    expect(["2027-02-28", "2026-04-30", "2026-05-31", "2026-04-29"].map((date) => occursOnDate(thirtyFirst, date))).toEqual([true, true, true, false]);
    expect(occursOnDate(block({ schedule: { kind: "months", every: 1, on: { kind: "day", day: 31 } }, skipped: [] }, "2028-01-31"), "2028-02-29")).toBe(true);
    const lastFriday = block({ schedule: { kind: "months", every: 1, on: { kind: "weekday", nth: -1, weekday: 5 } }, skipped: [] });
    expect(["2026-11-27", "2026-11-20", "2026-12-25"].map((date) => occursOnDate(lastFriday, date))).toEqual([true, false, true]);
  });

  test("a series stops after its last date", () => {
    const daily = block({ schedule: { kind: "days", every: 1 }, skipped: [] }, "2026-11-02", "2026-11-05");
    expect(occursOnDate(daily, "2026-11-05")).toBe(true);
    expect(occursOnDate(daily, "2026-11-06")).toBe(false);
  });
});
