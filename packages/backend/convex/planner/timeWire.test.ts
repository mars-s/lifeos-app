import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id, TableNames } from "../_generated/dataModel";
import { newBackend, unwrap, type Backend } from "../backend.test-utils";
import { zonedMoment } from "../calendar/model";
import type { IsoDate } from "../../shared/date";

const ZONE = "Australia/Sydney";
const TODAY = "2026-11-20" as IsoDate;
const SATURDAY = "2026-11-21" as IsoDate;
const NOW = Date.UTC(2026, 10, 19, 22, 0);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const TEN = zonedMoment(TODAY, 600, ZONE);
const time = expect.any(Number);
const activity = expect.any(String);
const ALL = { areaIds: [], projectIds: [], labelIds: [] };
const WORKING_HOURS = { startMinute: 540, endMinute: 1050 };

const quietDay = (date: string) => ({ date, capacityMinutes: 510, plannedMinutes: 0, slices: [], deadlines: 0 });

const refused = (reason: string) => ({ ok: false, error: { kind: "invalid_smart_block", reason } });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

const gone = async <T extends TableNames>(t: Backend, id: Id<T>) => {
  await t.run((ctx) => ctx.db.delete(id));
  return id;
};

const setup = async () => {
  const t = await newBackend();
  const { areaId } = unwrap(await t.mutation(api.planner.areas.create, { title: "University" }));
  const make = async (title: string, when: { kind: "scheduled"; date: string; evening: boolean } | { kind: "anytime" } = { kind: "anytime" }) =>
    unwrap(await t.mutation(api.planner.tasks.create, { title, when, estimateMinutes: 60, parent: { kind: "area", areaId } })).taskId;
  const taskId = await make("Write chapter two", { kind: "scheduled", date: TODAY, evening: false });
  const goneTask = await gone(t, await make("Forgotten errand"));
  return { t, areaId, taskId, goneTask, make };
};

const row = (taskId: Id<"tasks">, areaId: Id<"areas">, blocks: { _id: Id<"workBlocks">; start: number; minutes: number; done: boolean }[]) => ({
  _creationTime: time,
  _id: taskId,
  area: { _id: areaId, colour: "violet", title: "University" },
  checklist: [],
  context: "University",
  estimateMinutes: 60,
  focus: { ms: 0, sessions: [] },
  labelIds: [],
  labels: [],
  notes: "",
  order: "a0",
  parent: { areaId, kind: "area" },
  status: { kind: "open" },
  title: "Write chapter two",
  when: { date: TODAY, evening: false, kind: "scheduled" },
  workBlocks: blocks,
});

describe("Work Blocks on the wire", () => {
  test("create, move, resize, complete and remove answer with their ids, and every refusal keeps its shape", async () => {
    const { t, taskId, goneTask } = await setup();
    const block = { taskId, start: TEN, minutes: 60, timeZone: ZONE };
    const created = await t.mutation(api.planner.workBlocks.create, block);
    expect(created).toStrictEqual({ ok: true, value: { blockId: expect.any(String), activityId: activity } });
    const { blockId } = unwrap(created);

    expect(await t.mutation(api.planner.workBlocks.create, { ...block, start: 0 })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_block", reason: "start" },
    });
    expect(await t.mutation(api.planner.workBlocks.create, { ...block, minutes: 0 })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_block", reason: "minutes" },
    });
    expect(await t.mutation(api.planner.workBlocks.create, { ...block, timeZone: "Mars/Olympus" })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_block", reason: "time_zone" },
    });
    expect(await t.mutation(api.planner.workBlocks.create, { ...block, date: "2026-02-31" })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_date", input: "2026-02-31" },
    });
    expect(await t.mutation(api.planner.workBlocks.create, { ...block, taskId: goneTask })).toStrictEqual({
      ok: false,
      error: { kind: "not_found", table: "tasks", id: goneTask },
    });

    expect(await t.mutation(api.planner.workBlocks.move, { blockId, start: TEN + HOUR })).toStrictEqual({
      ok: true,
      value: { changed: true, activityId: activity },
    });
    expect(await t.mutation(api.planner.workBlocks.move, { blockId, start: -1 })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_block", reason: "start" },
    });
    expect(await t.mutation(api.planner.workBlocks.resize, { blockId, minutes: 45 })).toStrictEqual({
      ok: true,
      value: { changed: true, activityId: activity },
    });
    expect(await t.mutation(api.planner.workBlocks.resize, { blockId, minutes: 24 * 60 + 1 })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_block", reason: "minutes" },
    });
    expect(await t.mutation(api.planner.workBlocks.complete, { blockId, done: false })).toStrictEqual({
      ok: true,
      value: { changed: false, activityId: null },
    });
    expect(await t.mutation(api.planner.workBlocks.complete, { blockId, done: true })).toStrictEqual({
      ok: true,
      value: { changed: true, activityId: activity },
    });
    expect(await t.mutation(api.planner.workBlocks.remove, { blockId })).toStrictEqual({
      ok: true,
      value: { changed: true, activityId: activity },
    });
    expect(await t.mutation(api.planner.workBlocks.move, { blockId, start: -1 })).toStrictEqual({
      ok: false,
      error: { kind: "not_found", table: "workBlocks", id: blockId },
    });
    const vanished = await gone(t, unwrap(await t.mutation(api.planner.workBlocks.create, block)).blockId);
    expect(await t.mutation(api.planner.workBlocks.complete, { blockId: vanished, done: true })).toStrictEqual({
      ok: false,
      error: { kind: "not_found", table: "workBlocks", id: vanished },
    });
  });

  test("spread answers with every new block, and refuses an empty, clashing or closed spread", async () => {
    const { t, taskId, goneTask } = await setup();
    const spread = await t.mutation(api.planner.workBlocks.spread, {
      timeZone: ZONE,
      blocks: [
        { taskId, start: TEN, minutes: 30 },
        { taskId, start: TEN + HOUR, minutes: 30 },
      ],
    });
    expect(spread).toStrictEqual({ ok: true, value: { blockIds: [expect.any(String), expect.any(String)], activityId: activity } });
    expect(await t.mutation(api.planner.workBlocks.spread, { timeZone: ZONE, blocks: [] })).toStrictEqual({
      ok: false,
      error: { kind: "selection_too_large", limit: 100 },
    });
    expect(await t.mutation(api.planner.workBlocks.spread, { timeZone: "Nowhere", blocks: [{ taskId, start: TEN, minutes: 30 }] })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_block", reason: "time_zone" },
    });
    expect(await t.mutation(api.planner.workBlocks.spread, { timeZone: ZONE, blocks: [{ taskId, start: TEN + 10 * MINUTE, minutes: 30 }] })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_block", reason: "overlap" },
    });
    expect(await t.mutation(api.planner.workBlocks.spread, { timeZone: ZONE, blocks: [{ taskId: goneTask, start: TEN + 3 * HOUR, minutes: 30 }] })).toStrictEqual({
      ok: false,
      error: { kind: "not_found", table: "tasks", id: goneTask },
    });
  });

  test("range lists each live block with its Task row, and refuses a bad window", async () => {
    const { t, taskId, areaId } = await setup();
    const { blockId } = unwrap(await t.mutation(api.planner.workBlocks.create, { taskId, start: TEN, minutes: 60, timeZone: ZONE }));
    const blocks = [{ _id: blockId, start: TEN, minutes: 60, done: false }];
    expect(await t.query(api.planner.workBlocks.range, { from: TEN - HOUR, to: TEN + 2 * HOUR })).toStrictEqual({
      ok: true,
      value: [{ _id: blockId, taskId, start: TEN, minutes: 60, done: false, task: row(taskId, areaId, blocks) }],
    });
    expect(await t.query(api.planner.workBlocks.range, { from: TEN, to: TEN - HOUR })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_range" },
    });
  });
});

describe("the week plan on the wire", () => {
  test("week answers with each day's load, and refuses a bad range or time zone", async () => {
    const { t, taskId, areaId } = await setup();
    const { blockId } = unwrap(await t.mutation(api.planner.workBlocks.create, { taskId, start: TEN, minutes: 60, timeZone: ZONE }));
    const area = { _id: areaId, colour: "violet", title: "University" };
    expect(await t.query(api.planner.plan.week, { from: TODAY, days: 1, timeZone: ZONE })).toStrictEqual({
      ok: true,
      value: {
        from: TODAY,
        workingHours: WORKING_HOURS,
        guesses: [],
        days: [
          {
            date: TODAY,
            tasks: [row(taskId, areaId, [{ _id: blockId, start: TEN, minutes: 60, done: false }])],
            ghosts: [],
            slices: [{ area, id: taskId, left: 0, minutes: 60, source: "blocks" }],
            plannedMinutes: 60,
            guessedMinutes: 0,
            unestimated: 0,
            goalMinutes: 510,
            goalSet: false,
            workingMinutes: 510,
            busyMinutes: 0,
            freeMinutes: 510,
          },
        ],
      },
    });
    const range = { ok: false, error: { kind: "invalid_plan", reason: "range" } };
    expect(await t.query(api.planner.plan.week, { from: "2026-02-31", days: 1, timeZone: ZONE })).toStrictEqual(range);
    expect(await t.query(api.planner.plan.week, { from: TODAY, days: 0, timeZone: ZONE })).toStrictEqual(range);
    expect(await t.query(api.planner.plan.week, { from: TODAY, days: 32, timeZone: ZONE })).toStrictEqual(range);
    expect(await t.query(api.planner.plan.week, { from: TODAY, days: 1, timeZone: "Mars/Olympus" })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_plan", reason: "time_zone" },
    });
  });

  test("place puts a Task on a day, and refuses a bad day, a lost Task or a bad order", async () => {
    const { t, taskId, goneTask, make } = await setup();
    const other = await make("Mark the quizzes");
    expect(await t.mutation(api.planner.plan.place, { taskId: other, date: TODAY, order: [other, taskId] })).toStrictEqual({
      ok: true,
      value: { moved: 1, activityId: activity },
    });
    expect(await t.mutation(api.planner.plan.place, { taskId, date: "2026-02-31", order: [taskId] })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_plan", reason: "range" },
    });
    expect(await t.mutation(api.planner.plan.place, { taskId: goneTask, date: TODAY, order: [goneTask] })).toStrictEqual({
      ok: false,
      error: { kind: "not_found", table: "tasks", id: goneTask },
    });
    const order = { ok: false, error: { kind: "invalid_plan", reason: "order" } };
    expect(await t.mutation(api.planner.plan.place, { taskId, date: TODAY, order: [other] })).toStrictEqual(order);
    expect(await t.mutation(api.planner.plan.place, { taskId, date: TODAY, order: [taskId, other, other] })).toStrictEqual(order);
  });

  test("setGoal sets and clears a day's goal, and refuses a bad goal or day", async () => {
    const { t } = await setup();
    expect(await t.mutation(api.planner.plan.setGoal, { date: TODAY, minutes: null })).toStrictEqual({
      ok: true,
      value: { changed: false, activityId: null },
    });
    expect(await t.mutation(api.planner.plan.setGoal, { date: TODAY, minutes: 240 })).toStrictEqual({
      ok: true,
      value: { changed: true, activityId: activity },
    });
    expect(await t.mutation(api.planner.plan.setGoal, { date: TODAY, minutes: null })).toStrictEqual({
      ok: true,
      value: { changed: true, activityId: activity },
    });
    expect(await t.mutation(api.planner.plan.setGoal, { date: TODAY, minutes: -5 })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_plan", reason: "goal" },
    });
    expect(await t.mutation(api.planner.plan.setGoal, { date: "someday", minutes: 60 })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_plan", reason: "range" },
    });
  });

  test("timeline days answers with blocks, capacity and energy, and refuses a bad range or time zone", async () => {
    const { t, taskId, areaId } = await setup();
    const { blockId } = unwrap(await t.mutation(api.planner.workBlocks.create, { taskId, start: TEN, minutes: 60, timeZone: ZONE }));
    expect(await t.query(api.planner.timeline.days, { from: TODAY, days: 1, timeZone: ZONE, now: NOW })).toStrictEqual({
      ok: true,
      value: {
        today: TODAY,
        workingHours: WORKING_HOURS,
        days: [
          {
            date: TODAY,
            predicts: true,
            blocks: [
              {
                _id: blockId,
                taskId,
                start: TEN,
                minutes: 60,
                done: false,
                title: "Write chapter two",
                area: { _id: areaId, colour: "violet", title: "University" },
                trip: null,
              },
            ],
            commitments: [],
            predictions: [],
            unfit: [],
            capacity: { date: TODAY, workingMinutes: 510, busyMinutes: 0, freeMinutes: 510 },
            load: { done: 0, kept: 60, predicted: 0 },
            energy: { date: TODAY, kind: "none" },
          },
        ],
      },
    });
    const range = { ok: false, error: { kind: "invalid_plan", reason: "range" } };
    expect(await t.query(api.planner.timeline.days, { from: "today", days: 1, timeZone: ZONE, now: NOW })).toStrictEqual(range);
    expect(await t.query(api.planner.timeline.days, { from: TODAY, days: 15, timeZone: ZONE, now: NOW })).toStrictEqual(range);
    expect(await t.query(api.planner.timeline.days, { from: TODAY, days: 1, timeZone: ZONE, now: 0 })).toStrictEqual(range);
    expect(await t.query(api.planner.timeline.days, { from: TODAY, days: 1, timeZone: "Mars/Olympus", now: NOW })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_plan", reason: "time_zone" },
    });
  });

  test("the widget snapshot answers with today's plan, and refuses a bad day or time zone", async () => {
    const { t, taskId } = await setup();
    const { blockId } = unwrap(await t.mutation(api.planner.workBlocks.create, { taskId, start: TEN, minutes: 60, timeZone: ZONE }));
    const area = { name: "University", colour: "violet" };
    expect(await t.query(api.planner.widgets.snapshot, { date: TODAY, timeZone: ZONE })).toStrictEqual({
      ok: true,
      value: {
        date: TODAY,
        timeZone: ZONE,
        workingHours: WORKING_HOURS,
        capacityMinutes: 510,
        plannedMinutes: 60,
        tasksLeft: 1,
        tasks: [{ id: taskId, title: "Write chapter two", area, estimateMinutes: 60 }],
        blocks: [{ id: blockId, taskId, title: "Write chapter two", start: TEN, minutes: 60, done: false, area }],
        commitments: [],
        focus: null,
        week: [
          { date: TODAY, capacityMinutes: 510, plannedMinutes: 60, slices: [{ id: taskId, colour: "violet", minutes: 60 }], deadlines: 0 },
          quietDay("2026-11-21"),
          quietDay("2026-11-22"),
          quietDay("2026-11-23"),
          quietDay("2026-11-24"),
          quietDay("2026-11-25"),
          quietDay("2026-11-26"),
        ],
        deadlines: [],
        brainDump: 0,
      },
    });
    expect(await t.query(api.planner.widgets.snapshot, { date: "Friday", timeZone: ZONE })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_plan", reason: "range" },
    });
    expect(await t.query(api.planner.widgets.snapshot, { date: TODAY, timeZone: "Mars/Olympus" })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_plan", reason: "time_zone" },
    });
  });
});

describe("Focus Sessions on the wire", () => {
  const open = { kind: "open" } as const;
  const pomodoro = { kind: "pomodoro", focusMinutes: 25, breakMinutes: 5 } as const;

  test("start, pause, resume, extend, setPlan, advance, stop, setMinutes and remove answer with their ids and changes", async () => {
    const { t, taskId, make } = await setup();
    const other = await make("Mark the quizzes");
    const first = await t.mutation(api.planner.focus.start, { taskId, plan: open });
    expect(first).toStrictEqual({ ok: true, value: { sessionId: expect.any(String), replaced: null, activityId: activity } });
    const { sessionId } = unwrap(first);
    expect(await t.mutation(api.planner.focus.start, { taskId, plan: open })).toStrictEqual({
      ok: true,
      value: { sessionId, replaced: null, activityId: null },
    });
    expect(await t.query(api.planner.focus.current, {})).toStrictEqual({
      _id: sessionId,
      taskId,
      kind: "focus",
      start: time,
      pausedMs: 0,
      state: { kind: "running" },
      title: "Write chapter two",
      colour: "violet",
    });
    vi.setSystemTime(NOW + 10 * MINUTE);
    expect(await t.mutation(api.planner.focus.pause, { sessionId })).toStrictEqual({ ok: true, value: { changed: true, activityId: activity } });
    expect(await t.mutation(api.planner.focus.pause, { sessionId })).toStrictEqual({ ok: true, value: { changed: false, activityId: null } });
    vi.setSystemTime(NOW + 15 * MINUTE);
    expect(await t.mutation(api.planner.focus.resume, { sessionId })).toStrictEqual({ ok: true, value: { changed: true, activityId: activity } });
    expect(await t.mutation(api.planner.focus.extend, { sessionId, minutes: 10 })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_focus", reason: "not_timed" },
    });
    expect(await t.mutation(api.planner.focus.advance, { sessionId })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_focus", reason: "not_pomodoro" },
    });
    expect(await t.mutation(api.planner.focus.setPlan, { sessionId, plan: { kind: "pomodoro", focusMinutes: 0, breakMinutes: 5 } })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_focus", reason: "minutes" },
    });
    expect(await t.mutation(api.planner.focus.setPlan, { sessionId, plan: pomodoro })).toStrictEqual({
      ok: true,
      value: { changed: true, activityId: activity },
    });
    expect(await t.mutation(api.planner.focus.extend, { sessionId, minutes: 0 })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_focus", reason: "minutes" },
    });
    expect(await t.mutation(api.planner.focus.extend, { sessionId, minutes: 5 })).toStrictEqual({
      ok: true,
      value: { changed: true, activityId: activity },
    });
    expect(await t.mutation(api.planner.focus.setMinutes, { sessionId, minutes: 20 })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_focus", reason: "not_ended" },
    });
    expect(await t.mutation(api.planner.focus.remove, { sessionId })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_focus", reason: "not_ended" },
    });
    const breakTime = await t.mutation(api.planner.focus.advance, { sessionId });
    expect(breakTime).toStrictEqual({ ok: true, value: { sessionId: expect.any(String), replaced: sessionId, activityId: activity } });
    const breakId = unwrap(breakTime).sessionId;
    expect(await t.mutation(api.planner.focus.setPlan, { sessionId: breakId, plan: open })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_focus", reason: "on_break" },
    });
    expect(await t.mutation(api.planner.focus.pause, { sessionId })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_focus", reason: "not_active" },
    });
    expect(await t.mutation(api.planner.focus.setMinutes, { sessionId, minutes: 0 })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_focus", reason: "minutes" },
    });
    expect(await t.mutation(api.planner.focus.setMinutes, { sessionId, minutes: 20 })).toStrictEqual({
      ok: true,
      value: { changed: true, activityId: activity },
    });
    const replacing = await t.mutation(api.planner.focus.start, { taskId: other, plan: open });
    expect(replacing).toStrictEqual({ ok: true, value: { sessionId: expect.any(String), replaced: breakId, activityId: activity } });
    const otherId = unwrap(replacing).sessionId;
    expect(await t.mutation(api.planner.focus.stop, { sessionId: otherId })).toStrictEqual({ ok: true, value: { changed: true, activityId: activity } });
    expect(await t.mutation(api.planner.focus.stop, { sessionId: otherId })).toStrictEqual({ ok: true, value: { changed: false, activityId: null } });
    expect(await t.mutation(api.planner.focus.remove, { sessionId })).toStrictEqual({ ok: true, value: { changed: true, activityId: activity } });
    expect(await t.mutation(api.planner.focus.stop, { sessionId })).toStrictEqual({
      ok: false,
      error: { kind: "not_found", table: "focusSessions", id: sessionId },
    });
    const vanished = await gone(t, otherId);
    expect(await t.mutation(api.planner.focus.resume, { sessionId: vanished })).toStrictEqual({
      ok: false,
      error: { kind: "not_found", table: "focusSessions", id: vanished },
    });
    expect(await t.query(api.planner.focus.current, {})).toBeNull();
  });

  test("start refuses a closed, lost or badly planned Task", async () => {
    const { t, taskId, goneTask, make } = await setup();
    const done = await make("Already done");
    unwrap(await t.mutation(api.planner.tasks.complete, { taskId: done }));
    expect(await t.mutation(api.planner.focus.start, { taskId: done, plan: open })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_focus", reason: "task_closed" },
    });
    expect(await t.mutation(api.planner.focus.start, { taskId: goneTask, plan: open })).toStrictEqual({
      ok: false,
      error: { kind: "not_found", table: "tasks", id: goneTask },
    });
    expect(await t.mutation(api.planner.focus.start, { taskId, plan: { kind: "pomodoro", focusMinutes: 25, breakMinutes: 0 } })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_focus", reason: "minutes" },
    });
  });

  test("the focus plan reads and saves, and refuses a bad length", async () => {
    const { t } = await setup();
    expect(await t.query(api.planner.focus.plan, {})).toStrictEqual({ mode: "open", focusMinutes: 25, breakMinutes: 5, longBreakMinutes: 15 });
    const choice = { mode: "pomodoro" as const, focusMinutes: 50, breakMinutes: 10, longBreakMinutes: 20 };
    expect(await t.mutation(api.planner.focus.choosePlan, choice)).toStrictEqual({ ok: true, value: { changed: true, activityId: activity } });
    expect(await t.mutation(api.planner.focus.choosePlan, choice)).toStrictEqual({ ok: true, value: { changed: false, activityId: null } });
    expect(await t.query(api.planner.focus.plan, {})).toStrictEqual(choice);
    expect(await t.mutation(api.planner.focus.choosePlan, { ...choice, breakMinutes: 0 })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_focus", reason: "minutes" },
    });
  });
});

describe("repeats on the wire", () => {
  const daily = { kind: "days", every: 1 } as const;
  const never = { kind: "never" } as const;

  test("setRepeat, skip, upcoming, stopRepeat and stopRule answer with their values, and every refusal keeps its shape", async () => {
    const { t, taskId, goneTask, areaId, make } = await setup();
    const fresh = await make("Water the plants");
    const set = await t.mutation(api.planner.recurrence.setRepeat, { taskId, schedule: daily, end: never, timeZone: ZONE });
    expect(set).toStrictEqual({ ok: true, value: { ruleId: expect.any(String), activityId: activity } });
    const { ruleId } = unwrap(set);
    expect(await t.query(api.planner.recurrence.upcoming, { date: TODAY, days: 7 })).toStrictEqual({
      ok: true,
      value: [
        {
          ruleId,
          taskId,
          date: SATURDAY,
          title: "Write chapter two",
          estimateMinutes: 60,
          evening: false,
          schedule: daily,
          end: never,
          area: { _id: areaId, colour: "violet", title: "University" },
        },
      ],
    });
    expect(await t.query(api.planner.recurrence.upcoming, { date: "soon", days: 7 })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_date", input: "soon" },
    });
    expect(await t.mutation(api.planner.recurrence.skip, { ruleId, date: "2026-11-25" })).toStrictEqual({
      ok: false,
      error: { kind: "stale_occurrence", ruleId, date: "2026-11-25" },
    });
    expect(await t.mutation(api.planner.recurrence.skip, { ruleId, date: SATURDAY })).toStrictEqual({
      ok: true,
      value: { next: { kind: "due", date: "2026-11-22" }, activityId: activity },
    });
    expect(await t.mutation(api.planner.recurrence.setRepeat, { taskId: fresh, schedule: daily, end: { kind: "on", date: "2026-11-01" }, timeZone: ZONE })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_schedule", reason: "end" },
    });
    expect(await t.mutation(api.planner.recurrence.setRepeat, { taskId, schedule: { kind: "days", every: 0 }, end: never, timeZone: ZONE })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_schedule", reason: "every" },
    });
    expect(await t.mutation(api.planner.recurrence.setRepeat, { taskId, schedule: daily, end: never, timeZone: "Mars/Olympus" })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_schedule", reason: "time_zone" },
    });
    expect(await t.mutation(api.planner.recurrence.setRepeat, { taskId: goneTask, schedule: daily, end: never, timeZone: ZONE })).toStrictEqual({
      ok: false,
      error: { kind: "not_found", table: "tasks", id: goneTask },
    });
    expect(await t.mutation(api.planner.recurrence.stopRepeat, { taskId })).toStrictEqual({ ok: true, value: { changed: true, activityId: activity } });
    expect(await t.mutation(api.planner.recurrence.stopRule, { ruleId })).toStrictEqual({ ok: true, value: { changed: false, activityId: null } });
    expect(await t.mutation(api.planner.recurrence.stopRepeat, { taskId: goneTask })).toStrictEqual({
      ok: false,
      error: { kind: "not_found", table: "tasks", id: goneTask },
    });
    const vanished = await gone(t, ruleId);
    expect(await t.mutation(api.planner.recurrence.stopRule, { ruleId: vanished })).toStrictEqual({
      ok: false,
      error: { kind: "not_found", table: "recurrenceRules", id: vanished },
    });
    expect(await t.mutation(api.planner.recurrence.skip, { ruleId: vanished, date: SATURDAY })).toStrictEqual({
      ok: false,
      error: { kind: "not_found", table: "recurrenceRules", id: vanished },
    });
  });
});

describe("Smart Blocks on the wire", () => {
  const FOUR = 16 * 60;
  const SIX = 18 * 60;
  const at = (date: IsoDate, minute: number) => zonedMoment(date, minute, ZONE);
  const base = { title: "Study", date: TODAY, startMinute: FOUR, endMinute: SIX, timeZone: ZONE };

  test("create, range, fillInputs, priority, edit, fill, skip and remove answer with their values", async () => {
    const { t, taskId, areaId } = await setup();
    const created = await t.mutation(api.planner.smartBlocks.create, { ...base, fill: [{ taskId, start: at(TODAY, FOUR), minutes: 60 }] });
    expect(created).toStrictEqual({ ok: true, value: { blockId: expect.any(String), blockIds: [expect.any(String)], activityId: activity } });
    const { blockId, blockIds } = unwrap(created);
    const occurrence = {
      blockId,
      date: TODAY,
      title: "Study",
      colour: "teal",
      start: at(TODAY, FOUR),
      end: at(TODAY, SIX),
      startMinute: FOUR,
      endMinute: SIX,
      timeZone: ZONE,
      filter: ALL,
      repeat: null,
      detached: false,
      filled: 1,
      filledMinutes: 60,
    };
    expect(await t.query(api.planner.smartBlocks.range, { from: TODAY, days: 2, timeZone: ZONE })).toStrictEqual({
      ok: true,
      value: { on: true, occurrences: [occurrence] },
    });
    const dayStart = at(TODAY, 0) / MINUTE;
    expect(await t.query(api.planner.smartBlocks.fillInputs, { date: TODAY, timeZone: ZONE })).toStrictEqual({
      ok: true,
      value: {
        date: TODAY,
        tasks: [
          {
            _id: taskId,
            title: "Write chapter two",
            areaId,
            labelIds: [],
            scheduled: TODAY,
            createdAt: time,
            estimateMinutes: 60,
            colour: "violet",
          },
        ],
        blocks: [{ blockId: blockIds[0], taskId, start: dayStart + FOUR, minutes: 60, smartBlock: { blockId, date: TODAY } }],
        busy: [],
        areas: [{ _id: areaId, title: "University" }],
        freeMinutes: Array.from({ length: 31 }, () => 510),
      },
    });
    expect(await t.query(api.planner.smartBlocks.priority, {})).toStrictEqual([{ _id: areaId, title: "University", colour: "violet" }]);
    expect(await t.mutation(api.planner.smartBlocks.edit, { blockId, title: "Deep study" })).toStrictEqual({
      ok: true,
      value: { blockId, activityId: activity },
    });
    expect(
      await t.mutation(api.planner.smartBlocks.fill, {
        blockId,
        date: TODAY,
        blocks: [{ taskId, start: at(TODAY, FOUR + 60), minutes: 30 }],
        release: blockIds,
      }),
    ).toStrictEqual({ ok: true, value: { blockId, blockIds: [expect.any(String)], activityId: activity } });
    expect(await t.mutation(api.planner.smartBlocks.skip, { blockId, date: TODAY })).toStrictEqual({ ok: true, value: { blockId, activityId: activity } });

    const weekly = unwrap(
      await t.mutation(api.planner.smartBlocks.create, { ...base, repeat: { schedule: { kind: "weeks", every: 1, days: [5] }, until: "2026-12-31" } }),
    ).blockId;
    expect(await t.mutation(api.planner.smartBlocks.edit, { blockId: weekly, date: "2026-11-27", title: "Moved study" })).toStrictEqual({
      ok: true,
      value: { blockId: expect.any(String), activityId: activity },
    });
    expect(await t.mutation(api.planner.smartBlocks.remove, { blockId: weekly })).toStrictEqual({ ok: true, value: { blockId: weekly, activityId: activity } });
  });

  test("every Smart Block refusal keeps its shape", async () => {
    const { t, taskId, goneTask } = await setup();
    expect(await t.mutation(api.planner.smartBlocks.create, { ...base, title: "  " })).toStrictEqual({ ok: false, error: { kind: "empty_title" } });
    expect(await t.mutation(api.planner.smartBlocks.create, { ...base, date: "2026-02-31" })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_date", input: "2026-02-31" },
    });
    expect(await t.mutation(api.planner.smartBlocks.create, { ...base, endMinute: FOUR })).toStrictEqual(refused("window"));
    expect(await t.mutation(api.planner.smartBlocks.create, { ...base, timeZone: "Mars/Olympus" })).toStrictEqual(refused("time_zone"));
    expect(await t.mutation(api.planner.smartBlocks.create, { ...base, repeat: { schedule: { kind: "days", every: 1 }, until: "2026-11-01" } })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_schedule", reason: "end" },
    });
    expect(await t.mutation(api.planner.smartBlocks.create, { ...base, repeat: { schedule: { kind: "days", every: 0 } } })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_schedule", reason: "every" },
    });
    expect(await t.mutation(api.planner.smartBlocks.create, { ...base, date: SATURDAY, repeat: { schedule: { kind: "weekdays" } } })).toStrictEqual(
      refused("occurrence"),
    );
    expect(await t.mutation(api.planner.smartBlocks.create, { ...base, fill: [{ taskId, start: at(TODAY, SIX), minutes: 30 }] })).toStrictEqual(
      refused("outside"),
    );
    const many = Array.from({ length: 51 }, (_, index) => ({ taskId, start: at(TODAY, FOUR + index), minutes: 1 }));
    expect(await t.mutation(api.planner.smartBlocks.create, { ...base, fill: many })).toStrictEqual(refused("too_many"));
    expect(
      await t.mutation(api.planner.smartBlocks.create, {
        ...base,
        fill: [
          { taskId, start: at(TODAY, FOUR), minutes: 60 },
          { taskId, start: at(TODAY, FOUR + 30), minutes: 60 },
        ],
      }),
    ).toStrictEqual(refused("overlap"));
    expect(await t.mutation(api.planner.smartBlocks.create, { ...base, fill: [{ taskId: goneTask, start: at(TODAY, FOUR), minutes: 30 }] })).toStrictEqual({
      ok: false,
      error: { kind: "not_found", table: "tasks", id: goneTask },
    });

    const { blockId } = unwrap(await t.mutation(api.planner.smartBlocks.create, base));
    const { blockId: workBlock } = unwrap(await t.mutation(api.planner.workBlocks.create, { taskId, start: at(TODAY, FOUR), minutes: 30, timeZone: ZONE }));
    expect(await t.mutation(api.planner.smartBlocks.fill, { blockId, date: TODAY, blocks: [], release: [workBlock] })).toStrictEqual(refused("release"));
    expect(await t.mutation(api.planner.smartBlocks.fill, { blockId, date: SATURDAY, blocks: [], release: [] })).toStrictEqual(refused("occurrence"));
    expect(await t.mutation(api.planner.smartBlocks.edit, { blockId, endMinute: FOUR - 60 })).toStrictEqual(refused("window"));
    expect(await t.mutation(api.planner.smartBlocks.skip, { blockId, date: "Friday" })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_date", input: "Friday" },
    });
    unwrap(await t.mutation(api.planner.smartBlocks.remove, { blockId }));
    const lost = { ok: false, error: { kind: "not_found", table: "smartBlocks", id: blockId } };
    expect(await t.mutation(api.planner.smartBlocks.remove, { blockId })).toStrictEqual(lost);
    expect(await t.mutation(api.planner.smartBlocks.edit, { blockId, title: "Again" })).toStrictEqual(lost);
    expect(await t.mutation(api.planner.smartBlocks.skip, { blockId, date: TODAY })).toStrictEqual(lost);
    expect(await t.mutation(api.planner.smartBlocks.fill, { blockId, date: TODAY, blocks: [], release: [] })).toStrictEqual(lost);
    expect(await t.query(api.planner.smartBlocks.range, { from: TODAY, days: 63, timeZone: ZONE })).toStrictEqual(refused("window"));
    expect(await t.query(api.planner.smartBlocks.range, { from: TODAY, days: 1, timeZone: "Mars/Olympus" })).toStrictEqual(refused("time_zone"));
    expect(await t.query(api.planner.smartBlocks.fillInputs, { date: "today", timeZone: ZONE })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_date", input: "today" },
    });
  });

  test("with Smart Blocks off, writes refuse and reads answer empty", async () => {
    const { t } = await setup();
    const { blockId } = unwrap(await t.mutation(api.planner.smartBlocks.create, base));
    unwrap(await t.mutation(api.platform.features.setEnabled, { feature: "smartBlocks", enabled: false }));
    const off = { ok: false, error: { kind: "feature_off", feature: "smartBlocks" } };
    expect(await t.mutation(api.planner.smartBlocks.create, base)).toStrictEqual(off);
    expect(await t.mutation(api.planner.smartBlocks.edit, { blockId, title: "Off" })).toStrictEqual(off);
    expect(await t.mutation(api.planner.smartBlocks.skip, { blockId, date: TODAY })).toStrictEqual(off);
    expect(await t.mutation(api.planner.smartBlocks.remove, { blockId })).toStrictEqual(off);
    expect(await t.mutation(api.planner.smartBlocks.fill, { blockId, date: TODAY, blocks: [], release: [] })).toStrictEqual(off);
    expect(await t.query(api.planner.smartBlocks.range, { from: TODAY, days: 1, timeZone: ZONE })).toStrictEqual({ ok: true, value: { on: false, occurrences: [] } });
    expect(await t.query(api.planner.smartBlocks.fillInputs, { date: TODAY, timeZone: ZONE })).toStrictEqual({ ok: true, value: null });
  });
});

describe("Smart Estimates on the wire", () => {
  test("with AI off, a Task shows presets and asking does nothing", async () => {
    const { t, taskId } = await setup();
    expect(await t.query(api.planner.smartEstimates.forTask, { taskId })).toStrictEqual({ kind: "presets" });
    expect(await t.mutation(api.planner.smartEstimates.request, { taskId })).toStrictEqual({ requested: false });
  });
});
