import { expect, test } from "vitest";
import { api } from "../_generated/api";
import { newBackend, unwrap, type Backend } from "../backend.test-utils";
import { zonedMoment } from "../calendar/model";
import type { IsoDate } from "../../shared/date";

const SYDNEY = "Australia/Sydney";
const monday = "2026-11-30" as IsoDate;
const on = (date: string) => ({ kind: "scheduled", date, evening: false }) as const;

const snapshot = async (t: Backend) => unwrap(await t.query(api.planner.widgets.snapshot, { date: monday, timeZone: SYDNEY }));

const setUp = async () => {
  const t = await newBackend();
  const { areaId } = unwrap(await t.mutation(api.planner.areas.create, { title: "University", colour: "violet" }));
  const parent = { kind: "area", areaId } as const;
  const methods = unwrap(
    await t.mutation(api.planner.tasks.create, { title: "Methods draft", when: on(monday), estimateMinutes: 90, parent }),
  ).taskId;
  const physio = unwrap(await t.mutation(api.planner.tasks.create, { title: "Book the physio", when: on(monday), estimateMinutes: 15 })).taskId;
  unwrap(await t.mutation(api.planner.tasks.create, { title: "Handover", when: on("2026-12-04"), deadline: "2026-12-04", estimateMinutes: 60 }));
  unwrap(await t.mutation(api.planner.tasks.create, { title: "Unsorted thought" }));
  unwrap(await t.mutation(api.planner.workBlocks.create, { taskId: methods, start: zonedMoment(monday, 10 * 60 + 5, SYDNEY), minutes: 90, timeZone: SYDNEY }));
  return { t, methods, physio };
};

test("the widget snapshot holds today's Tasks, Work Blocks, the week and the Brain Dump count", async () => {
  const { t, methods } = await setUp();
  const shot = await snapshot(t);

  expect(shot.tasksLeft).toBe(2);
  expect(shot.tasks.map((task) => [task.title, task.estimateMinutes, task.area?.colour])).toEqual([
    ["Methods draft", 90, "violet"],
    ["Book the physio", 15, undefined],
  ]);
  expect(shot.plannedMinutes).toBe(105);
  expect(shot.blocks).toEqual([
    expect.objectContaining({ taskId: methods, title: "Methods draft", minutes: 90, done: false, area: { name: "University", colour: "violet" } }),
  ]);
  expect(shot.week.map((day) => [day.date, day.plannedMinutes, day.deadlines])).toEqual([
    ["2026-11-30", 105, 0],
    ["2026-12-01", 0, 0],
    ["2026-12-02", 0, 0],
    ["2026-12-03", 0, 0],
    ["2026-12-04", 60, 1],
    ["2026-12-05", 0, 0],
    ["2026-12-06", 0, 0],
  ]);
  expect(shot.week[0]?.slices).toEqual([
    { colour: "violet", minutes: 90 },
    { colour: undefined, minutes: 15 },
  ]);
  expect(shot.deadlines.map((deadline) => [deadline.title, deadline.date])).toEqual([["Handover", "2026-12-04"]]);
  expect(shot.brainDump).toBe(1);
  expect(shot.focus).toBeNull();
});

test("a ticked Task leaves the snapshot and a Focus Session shows in it", async () => {
  const { t, methods, physio } = await setUp();
  unwrap(await t.mutation(api.planner.tasks.complete, { taskId: physio }));
  unwrap(await t.mutation(api.planner.focus.start, { taskId: methods, plan: { kind: "pomodoro", focusMinutes: 25, breakMinutes: 5 } }));
  const shot = await snapshot(t);

  expect(shot.tasks.map((task) => task.title)).toEqual(["Methods draft"]);
  expect(shot.focus).toEqual(expect.objectContaining({ taskId: methods, title: "Methods draft", kind: "focus", plannedMinutes: 25, colour: "violet" }));
});

test("the widget snapshot refuses a bad date or time zone", async () => {
  const t = await newBackend();
  expect(await t.query(api.planner.widgets.snapshot, { date: "Monday", timeZone: SYDNEY })).toEqual({ ok: false, error: { kind: "invalid_plan", reason: "range" } });
  expect(await t.query(api.planner.widgets.snapshot, { date: monday, timeZone: "Mars/Olympus" })).toEqual({
    ok: false,
    error: { kind: "invalid_plan", reason: "time_zone" },
  });
});
