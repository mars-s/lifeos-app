import { expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { newBackend, registerWorker, unwrap, type Backend } from "../backend.test-utils";
import { zonedMoment } from "../calendar/model";
import type { IsoDate } from "../../shared/date";
import { blockMinutesFor, byDayPlan, dayLoad, placeInDay } from "../../shared/plan";

const SYDNEY = "Australia/Sydney";
const thursday = "2026-11-19" as IsoDate;
const friday = "2026-11-20" as IsoDate;
const HOUR = 3_600_000;
const at = (date: IsoDate, hour: number) => zonedMoment(date, hour * 60, SYDNEY);

const on = (date: string) => ({ kind: "scheduled", date, evening: false }) as const;

const add = async (t: Backend, title: string, fields: { when?: ReturnType<typeof on>; estimateMinutes?: number; deadline?: string } = {}) =>
  unwrap(await t.mutation(api.planner.tasks.create, { title, ...fields })).taskId;

const week = async (t: Backend, days = 2) => unwrap(await t.query(api.planner.plan.week, { from: thursday, days, timeZone: SYDNEY }));

const titles = (day: { tasks: { title: string }[] } | undefined) => day?.tasks.map((task) => task.title);

const meeting = async (t: Backend, startHour: number, endHour: number) => {
  const token = await registerWorker(t, "mac", ["calendar"]);
  unwrap(
    await t.mutation(api.calendar.sync.applyWindow, {
      token,
      window: { start: at(thursday, 0) - 24 * HOUR, end: at(thursday, 0) + 72 * HOUR },
      calendars: [{ calendarId: "work", title: "Work", colour: { red: 0.2, green: 0.47, blue: 0.96 }, source: "iCloud", kind: "calDAV" }],
      commitments: [
        {
          calendarId: "work",
          eventKey: "standup",
          title: "Team standup",
          start: at(thursday, startHour),
          end: at(thursday, endHour),
          allDay: false,
          availability: "busy",
          recurring: false,
        },
      ],
    }),
  );
};

test("the Planner week lists each day's Tasks, with overdue Tasks rolled into the first day", async () => {
  const t = await newBackend();
  await add(t, "Overdue essay", { when: on("2026-11-17") });
  await add(t, "Write chapter two", { when: on(thursday) });
  await add(t, "Call the bank", { when: on(friday) });
  await add(t, "Unsorted thought");
  await add(t, "Next month", { when: on("2026-12-20") });

  const { days } = await week(t);
  expect(days.map((day) => [day.date, titles(day)])).toEqual([
    [thursday, ["Overdue essay", "Write chapter two"]],
    [friday, ["Call the bank"]],
  ]);
});

test("placing a Task sets its When to that day and keeps the Day Plan order, and undo restores the plan", async () => {
  const t = await newBackend();
  const first = await add(t, "First", { when: on(thursday) });
  const second = await add(t, "Second", { when: on(thursday) });
  const third = await add(t, "Third", { when: on(thursday) });
  const dumped = await add(t, "From the Brain Dump", { deadline: "2026-11-27" });

  const dropped = unwrap(await t.mutation(api.planner.plan.place, { taskId: dumped, date: thursday, order: [first, dumped, second, third] }));
  expect(titles((await week(t)).days[0])).toEqual(["First", "From the Brain Dump", "Second", "Third"]);
  expect((await t.query(api.planner.lists.inbox, {})).tasks).toEqual([]);
  expect((await t.query(api.planner.tasks.card, { taskId: dumped }))?.deadline).toBe("2026-11-27");

  const reordered = unwrap(await t.mutation(api.planner.plan.place, { taskId: third, date: thursday, order: [third, first, dumped, second] }));
  expect(reordered.moved).toBe(1);
  expect(titles((await week(t)).days[0])).toEqual(["Third", "First", "From the Brain Dump", "Second"]);

  const moved = unwrap(await t.mutation(api.planner.plan.place, { taskId: first, date: friday, order: [first] }));
  const after = await week(t);
  expect([titles(after.days[0]), titles(after.days[1])]).toEqual([["Third", "From the Brain Dump", "Second"], ["First"]]);

  for (const { activityId } of [moved, reordered, dropped]) unwrap(await t.mutation(api.platform.undo.undo, { activityId: activityId! }));
  expect(titles((await week(t)).days[0])).toEqual(["First", "Second", "Third"]);
  expect((await t.query(api.planner.lists.inbox, {})).tasks.map((task) => task.title)).toEqual(["From the Brain Dump"]);
});

test("a Day Plan order made for one day does not carry to another", async () => {
  const t = await newBackend();
  const first = await add(t, "First", { when: on(thursday) });
  const second = await add(t, "Second", { when: on(thursday) });
  unwrap(await t.mutation(api.planner.plan.place, { taskId: second, date: thursday, order: [second, first] }));
  expect(titles((await week(t)).days[0])).toEqual(["Second", "First"]);

  unwrap(await t.mutation(api.planner.tasks.setWhen, { taskId: first, when: on(friday) }));
  unwrap(await t.mutation(api.planner.tasks.setWhen, { taskId: second, when: on(friday) }));
  expect(titles((await week(t)).days[1])).toEqual(["First", "Second"]);
});

test("a place is refused when the order leaves the Task out, repeats one, or the date is not real", async () => {
  const t = await newBackend();
  const taskId = await add(t, "Lonely");
  const other = await add(t, "Other");
  const refused = { ok: false, error: { kind: "invalid_plan", reason: "order" } };
  expect(await t.mutation(api.planner.plan.place, { taskId, date: thursday, order: [other] })).toEqual(refused);
  expect(await t.mutation(api.planner.plan.place, { taskId, date: thursday, order: [taskId, other, other] })).toEqual(refused);
  expect(await t.mutation(api.planner.plan.place, { taskId, date: "2026-02-31", order: [taskId] })).toEqual({
    ok: false,
    error: { kind: "invalid_plan", reason: "range" },
  });
  expect(await t.query(api.planner.plan.week, { from: thursday, days: 0, timeZone: SYDNEY })).toEqual({
    ok: false,
    error: { kind: "invalid_plan", reason: "range" },
  });
  expect(await t.query(api.planner.plan.week, { from: thursday, days: 7, timeZone: "Mars/Olympus" })).toEqual({
    ok: false,
    error: { kind: "invalid_plan", reason: "time_zone" },
  });
});

test("a day's planned total is the sum of Estimates, and an External Commitment lowers its Capacity", async () => {
  const t = await newBackend();
  await add(t, "Write chapter two", { when: on(thursday), estimateMinutes: 240 });
  await add(t, "Mark quizzes", { when: on(thursday), estimateMinutes: 270 });
  await add(t, "No estimate", { when: on(thursday) });

  const [empty] = (await week(t)).days;
  expect(empty).toMatchObject({ plannedMinutes: 510, workingMinutes: 510, busyMinutes: 0, freeMinutes: 510 });

  await meeting(t, 10, 11.5);
  const [busy, quiet] = (await week(t)).days;
  expect(busy).toMatchObject({ plannedMinutes: 510, busyMinutes: 90, freeMinutes: 420 });
  expect((busy?.plannedMinutes ?? 0) > (busy?.freeMinutes ?? 0)).toBe(true);
  expect(quiet).toMatchObject({ plannedMinutes: 0, freeMinutes: 510 });
});

test("Work Blocks replace a Task's Estimate in the day's total, and moving or resizing one changes the totals", async () => {
  const t = await newBackend();
  const taskId = await add(t, "Write chapter two", { when: on(thursday), estimateMinutes: 60, deadline: "2026-11-27" });
  await add(t, "Mark quizzes", { when: on(thursday), estimateMinutes: 30 });
  const totals = async () => (await week(t)).days.map((day) => day.plannedMinutes);
  expect(await totals()).toEqual([90, 0]);

  const created = unwrap(await t.mutation(api.planner.workBlocks.create, { taskId, start: at(thursday, 9), minutes: 60, timeZone: SYDNEY }));
  expect(await totals()).toEqual([90, 0]);

  const resized = unwrap(await t.mutation(api.planner.workBlocks.resize, { blockId: created.blockId, minutes: 105 }));
  expect(await totals()).toEqual([135, 0]);

  unwrap(await t.mutation(api.planner.workBlocks.create, { taskId, start: at(thursday, 14), minutes: 45, timeZone: SYDNEY }));
  expect(await totals()).toEqual([180, 0]);

  const moved = unwrap(await t.mutation(api.planner.workBlocks.move, { blockId: created.blockId, start: at(friday, 9) }));
  expect(await totals()).toEqual([75, 105]);
  expect((await t.query(api.planner.tasks.card, { taskId }))?.deadline).toBe("2026-11-27");

  unwrap(await t.mutation(api.platform.undo.undo, { activityId: moved.activityId! }));
  unwrap(await t.mutation(api.platform.undo.undo, { activityId: resized.activityId! }));
  expect(await totals()).toEqual([135, 0]);

  unwrap(await t.mutation(api.planner.tasks.complete, { taskId }));
  expect(await totals()).toEqual([30, 0]);
});

test("dropping an Inbox Task on the calendar makes a Work Block and schedules the Task for that day in one undo", async () => {
  const t = await newBackend();
  const taskId = await add(t, "Read two papers", { estimateMinutes: 45, deadline: "2026-11-27" });
  const created = unwrap(
    await t.mutation(api.planner.workBlocks.create, { taskId, start: at(friday, 13), minutes: 45, timeZone: SYDNEY, date: friday }),
  );
  const planned = await week(t);
  expect(planned.days[1]).toMatchObject({ plannedMinutes: 45 });
  expect(titles(planned.days[1])).toEqual(["Read two papers"]);
  expect(planned.days[1]?.tasks[0]).toMatchObject({ deadline: "2026-11-27", when: on(friday) });

  unwrap(await t.mutation(api.platform.undo.undo, { activityId: created.activityId! }));
  expect((await week(t)).days[1]).toMatchObject({ plannedMinutes: 0, tasks: [] });
  expect((await t.query(api.planner.lists.inbox, {})).tasks.map((task) => task.title)).toEqual(["Read two papers"]);
});

test("the Timebox range lists live Work Blocks with their Tasks, done ones included and trashed ones left out", async () => {
  const t = await newBackend();
  const open = await add(t, "Open", { when: on(thursday) });
  const done = await add(t, "Done", { when: on(thursday) });
  const binned = await add(t, "Binned", { when: on(thursday) });
  const block = (taskId: Id<"tasks">, hour: number) =>
    t.mutation(api.planner.workBlocks.create, { taskId, start: at(thursday, hour), minutes: 30, timeZone: SYDNEY });
  await block(open, 9);
  await block(done, 10);
  await block(binned, 11);
  const gone = unwrap(await block(open, 12));
  unwrap(await t.mutation(api.planner.workBlocks.remove, { blockId: gone.blockId }));
  unwrap(await t.mutation(api.planner.tasks.complete, { taskId: done }));
  unwrap(await t.mutation(api.planner.tasks.trash, { taskId: binned }));

  const blocks = unwrap(await t.query(api.planner.workBlocks.range, { from: at(thursday, 0), to: at(friday, 0) }));
  expect(blocks.map((each) => [each.task.title, each.task.status.kind, each.minutes])).toEqual([
    ["Open", "open", 30],
    ["Done", "completed", 30],
  ]);
  expect(unwrap(await t.query(api.planner.workBlocks.range, { from: at(friday, 0), to: at(friday, 24) }))).toEqual([]);
});

test("placing between two keyed Tasks writes one key, and placing among unkeyed Tasks rekeys the day", () => {
  const keyed = [
    { _id: "a", plan: { date: thursday, order: "a0" } },
    { _id: "b", plan: { date: thursday, order: "a1" } },
  ];
  const between = placeInDay(keyed, "c", 1, thursday);
  expect(between.map((mark) => mark.taskId)).toEqual(["c"]);
  expect(between[0]!.plan.order > "a0" && between[0]!.plan.order < "a1").toBe(true);

  const stale = [{ _id: "a", plan: { date: "2026-11-01", order: "a0" } }, { _id: "b" }];
  const rekeyed = placeInDay(stale, "c", 2, thursday);
  expect(rekeyed.map((mark) => mark.taskId)).toEqual(["a", "b", "c"]);
  const sorted = [{ _id: "c" }, { _id: "b" }, { _id: "a" }]
    .map((task) => ({ ...task, plan: rekeyed.find((mark) => mark.taskId === task._id)?.plan }))
    .toSorted(byDayPlan(thursday, () => 0));
  expect(sorted.map((task) => task._id)).toEqual(["a", "b", "c"]);
});

test("a day's load counts Work Blocks over Estimates, Smart Estimates as guesses, and the rest as not estimated", () => {
  const study = { colour: "violet" };
  const tasks = [
    { _id: "a", estimateMinutes: 60, area: study },
    { _id: "b", estimateMinutes: 30 },
    { _id: "c" },
    { _id: "d", area: study },
  ];
  const guesses = new Map([["c", 20]]);
  const plain = dayLoad(tasks, [], (taskId) => guesses.get(taskId));
  expect(plain).toMatchObject({ plannedMinutes: 90, guessedMinutes: 20, unestimated: 1 });
  expect(plain.slices.map((slice) => [slice.id, slice.area?.colour ?? null, slice.minutes, slice.source])).toEqual([
    ["a", "violet", 60, "estimate"],
    ["b", null, 30, "estimate"],
    ["c", null, 20, "guess"],
  ]);

  const blocks = [
    { _id: "w1", taskId: "a", minutes: 45 },
    { _id: "w2", taskId: "a", minutes: 45 },
    { _id: "w3", taskId: "z", minutes: 15, area: study },
  ];
  expect(dayLoad(tasks, blocks, () => undefined)).toMatchObject({ plannedMinutes: 135, guessedMinutes: 0, unestimated: 2 });
});

const suggest = (t: Backend, taskId: Id<"tasks">, minutes: number) =>
  t.run(async (ctx) => {
    await ctx.db.insert("estimateSuggestions", {
      taskId,
      requestedAt: 1,
      outcome: {
        kind: "suggested",
        minutes,
        guesses: [{ minutes, probability: 0.8 }],
        modelMinutes: minutes,
        reason: "Like a past Task",
        confidence: 0.8,
        probabilities: [],
        model: "gpt-6-luna",
        inputsHash: "hash",
        at: 1,
      },
    });
  });

const tooVague = (t: Backend, taskId: Id<"tasks">) =>
  t.run(async (ctx) => {
    await ctx.db.insert("estimateSuggestions", { taskId, requestedAt: 1, outcome: { kind: "unclear", vague: 0.9, inputsHash: "hash", at: 1 } });
  });

test("the meter counts every planned Task, with or without an Area, and shows Smart Estimates as guesses", async () => {
  const t = await newBackend();
  const { areaId } = unwrap(await t.mutation(api.planner.areas.create, { title: "University" }));
  const essay = await add(t, "Essay", { when: on(thursday), estimateMinutes: 90 });
  unwrap(await t.mutation(api.planner.tasks.move, { taskId: essay, parent: { kind: "area", areaId } }));
  await add(t, "Call the bank", { when: on(thursday), estimateMinutes: 30 });
  const guessed = await add(t, "Tidy the desk", { when: on(thursday) });
  const vague = await add(t, "Plan the trip", { when: on(thursday) });
  await add(t, "Something else", { when: on(thursday) });
  await suggest(t, guessed, 20);
  await tooVague(t, vague);

  const thursdayLoad = async () => (await week(t)).days[0];
  expect(await thursdayLoad()).toMatchObject({ plannedMinutes: 120, guessedMinutes: 0, unestimated: 3 });

  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  expect(await thursdayLoad()).toMatchObject({ plannedMinutes: 120, guessedMinutes: 20, unestimated: 2 });
  expect((await week(t)).guesses).toEqual([{ taskId: guessed, minutes: 20 }]);

  unwrap(await t.mutation(api.platform.preferences.setSmartEstimates, { enabled: false }));
  expect(await thursdayLoad()).toMatchObject({ plannedMinutes: 120, guessedMinutes: 0, unestimated: 3 });
  vi.unstubAllEnvs();
});

test("a day's Goal defaults to its free time, can be set and reset, and each change undoes in one step", async () => {
  const t = await newBackend();
  await meeting(t, 10, 11.5);
  const goals = async () => (await week(t)).days.map((day) => [day.goalMinutes, day.goalSet]);
  expect(await goals()).toEqual([
    [420, false],
    [510, false],
  ]);

  const set = unwrap(await t.mutation(api.planner.plan.setGoal, { date: thursday, minutes: 240 }));
  expect(set.changed).toBe(true);
  expect(await goals()).toEqual([
    [240, true],
    [510, false],
  ]);

  const raised = unwrap(await t.mutation(api.planner.plan.setGoal, { date: thursday, minutes: 360 }));
  const reset = unwrap(await t.mutation(api.planner.plan.setGoal, { date: thursday, minutes: null }));
  expect(await goals()).toEqual([
    [420, false],
    [510, false],
  ]);

  unwrap(await t.mutation(api.platform.undo.undo, { activityId: reset.activityId! }));
  expect((await goals())[0]).toEqual([360, true]);
  unwrap(await t.mutation(api.platform.undo.undo, { activityId: raised.activityId! }));
  expect((await goals())[0]).toEqual([240, true]);
  unwrap(await t.mutation(api.platform.undo.undo, { activityId: set.activityId! }));
  expect((await goals())[0]).toEqual([420, false]);

  const nothing = unwrap(await t.mutation(api.planner.plan.setGoal, { date: friday, minutes: null }));
  expect(nothing).toMatchObject({ changed: false, activityId: null });
});

test("a Goal must be whole minutes within one day, on a real date", async () => {
  const t = await newBackend();
  for (const minutes of [-15, 12.5, 24 * 60 + 1])
    expect(await t.mutation(api.planner.plan.setGoal, { date: thursday, minutes })).toEqual({
      ok: false,
      error: { kind: "invalid_plan", reason: "goal" },
    });
  expect(await t.mutation(api.planner.plan.setGoal, { date: "2026-02-30", minutes: 60 })).toEqual({
    ok: false,
    error: { kind: "invalid_plan", reason: "range" },
  });
  unwrap(await t.mutation(api.planner.plan.setGoal, { date: thursday, minutes: 0 }));
  expect((await week(t)).days[0]).toMatchObject({ goalMinutes: 0, goalSet: true });
});

test("a dropped Task gets a block from its Estimate in 15 minute steps, and a multi-day Estimate gets one 4 hour session", () => {
  expect([undefined, 5, 50, 90, 2550].map(blockMinutesFor)).toEqual([30, 15, 45, 90, 240]);
});
