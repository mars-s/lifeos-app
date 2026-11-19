import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  newBackend,
  newSignedOutBackend,
  ownerGithubId,
  refusal,
  signInWithGithub,
  strangerSession,
  unwrap,
} from "../backend.test-utils";
import type { RepeatEnd, Schedule } from "../../shared/recurrence";

const melbourne = "Australia/Melbourne";
const never = { kind: "never" } as const;
const daily = { kind: "days", every: 1 } as const;

const nineAm = (date: string) => Date.parse(`${date}T09:00:00+11:00`);

const at = (instant: number) => vi.setSystemTime(instant);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at(nineAm("2026-11-19"));
});

afterEach(() => {
  vi.useRealTimers();
});

type TaskFields = { when?: { kind: "scheduled"; date: string; evening: boolean }; deadline?: string; estimateMinutes?: number };

const setup = async () => {
  const t = await newBackend();
  const make = async (title: string, fields: TaskFields = {}) =>
    unwrap(await t.mutation(api.planner.tasks.create, { title, ...fields })).taskId;
  const setRepeat = async (taskId: Id<"tasks">, schedule: Schedule, end: RepeatEnd = never, timeZone = melbourne) =>
    t.mutation(api.planner.recurrence.setRepeat, { taskId, schedule, end, timeZone });
  const generate = () => t.mutation(internal.planner.recurrence.generate, {});
  const rule = async (ruleId: Id<"recurrenceRules">) => t.run((ctx) => ctx.db.get("recurrenceRules", ruleId));
  const occurrences = async (ruleId: Id<"recurrenceRules">) =>
    t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_repeat", (q) => q.eq("repeat.ruleId", ruleId))
        .collect(),
    );
  const datesOf = async (ruleId: Id<"recurrenceRules">) => (await occurrences(ruleId)).map((task) => task.repeat?.date);
  const card = async (taskId: Id<"tasks">) => t.query(api.planner.tasks.card, { taskId });
  return { t, make, setRepeat, generate, rule, occurrences, datesOf, card };
};

test("setting a repeat makes the Task its first occurrence and snapshots its shape, in one undoable step", async () => {
  const { t, make, setRepeat, rule, card } = await setup();
  const taskId = await make("Water the plants", {
    when: { kind: "scheduled", date: "2026-11-18", evening: true },
    deadline: "2026-11-21",
    estimateMinutes: 30,
  });
  unwrap(await t.mutation(api.planner.checklist.add, { taskId, title: "Fill the can" }));
  const before = await card(taskId);

  const { ruleId, activityId } = unwrap(await setRepeat(taskId, { kind: "weeks", every: 1, days: [1] }));
  expect(await card(taskId)).toMatchObject({
    when: { kind: "scheduled", date: "2026-11-23", evening: true },
    repeat: { ruleId, date: "2026-11-23" },
    deadline: "2026-11-21",
  });
  expect(await rule(ruleId)).toMatchObject({
    task: { title: "Water the plants", estimateMinutes: 30, checklist: ["Fill the can"], deadlineOffsetDays: 3 },
    evening: true,
    anchor: "2026-11-19",
    lastDate: "2026-11-23",
    count: 1,
    next: { kind: "due", date: "2026-11-30" },
  });

  unwrap(await t.mutation(api.platform.undo.undo, { activityId: activityId! }));
  expect(await card(taskId)).toEqual(before);
  expect(await rule(ruleId)).toBeNull();
});

test("an end before the first occurrence is refused", async () => {
  const { make, setRepeat } = await setup();
  const taskId = await make("Water the plants");
  expect(await setRepeat(taskId, { kind: "weeks", every: 1, days: [1] }, { kind: "on", date: "2026-11-22" })).toEqual({
    ok: false,
    error: { kind: "invalid_schedule", reason: "end" },
  });
});

test("the generator creates a due Task once, and a Task already holding its key blocks a duplicate", async () => {
  const { t, make, setRepeat, generate, rule, occurrences, datesOf } = await setup();
  const taskId = await make("Water the plants", { deadline: "2026-11-21" });
  unwrap(await t.mutation(api.planner.checklist.add, { taskId, title: "Fill the can" }));
  const { ruleId } = unwrap(await setRepeat(taskId, daily));
  expect(await datesOf(ruleId)).toEqual(["2026-11-19"]);

  await generate();
  expect(await datesOf(ruleId)).toEqual(["2026-11-19"]);

  at(nineAm("2026-11-20"));
  await generate();
  await generate();
  expect(await datesOf(ruleId)).toEqual(["2026-11-19", "2026-11-20"]);
  const created = (await occurrences(ruleId)).find((task) => task.repeat?.date === "2026-11-20")!;
  expect(created).toMatchObject({
    title: "Water the plants",
    when: { kind: "scheduled", date: "2026-11-20", evening: false },
    deadline: "2026-11-22",
    status: { kind: "open" },
  });
  const [original, fresh] = await Promise.all(
    [taskId, created._id].map((id) => t.query(api.planner.tasks.card, { taskId: id })),
  );
  expect(fresh?.checklist.map((item) => item.title)).toEqual(["Fill the can"]);
  expect(fresh?.checklist[0]?._id).not.toBe(original?.checklist[0]?._id);

  const generation = await t.run((ctx) =>
    ctx.db
      .query("activity")
      .order("desc")
      .filter((q) => q.eq(q.field("action"), "recurrence.generate"))
      .first(),
  );
  expect(generation?.actor).toEqual({ kind: "recurrence" });
  expect(await t.mutation(api.platform.undo.undo, { activityId: generation!._id })).toEqual({
    ok: false,
    error: { kind: "not_undoable", reason: "recurrence" },
  });

  at(nineAm("2026-11-21"));
  await t.run(async (ctx) => {
    await ctx.db.insert("tasks", {
      title: "Made elsewhere",
      notes: "",
      when: { kind: "scheduled", date: "2026-11-21", evening: false },
      parent: { kind: "loose" },
      labelIds: [],
      status: { kind: "open" },
      order: "a0",
      repeat: { ruleId, date: "2026-11-21" },
    });
  });
  await generate();
  expect(await datesOf(ruleId)).toEqual(["2026-11-19", "2026-11-20", "2026-11-21"]);
  expect(await rule(ruleId)).toMatchObject({ lastDate: "2026-11-21", count: 2, next: { kind: "due", date: "2026-11-22" } });
});

test("after an outage only the latest missed occurrence is created", async () => {
  const { make, setRepeat, generate, rule, datesOf } = await setup();
  const { ruleId } = unwrap(await setRepeat(await make("Water the plants"), daily));
  at(nineAm("2026-11-25"));
  await generate();
  expect(await datesOf(ruleId)).toEqual(["2026-11-19", "2026-11-25"]);
  expect(await rule(ruleId)).toMatchObject({ count: 2, lastDate: "2026-11-25", next: { kind: "due", date: "2026-11-26" } });
});

test("an end after a count or on a date stops the rule", async () => {
  const { make, setRepeat, generate, rule, datesOf } = await setup();
  const counted = unwrap(await setRepeat(await make("Water the plants"), daily, { kind: "after", count: 2 })).ruleId;
  const dated = unwrap(await setRepeat(await make("Stand-up"), { kind: "weekdays" }, { kind: "on", date: "2026-11-20" })).ruleId;
  at(nineAm("2026-11-20"));
  await generate();
  expect((await rule(counted))?.next).toEqual({ kind: "ended" });
  expect((await rule(dated))?.next).toEqual({ kind: "ended" });
  at(nineAm("2026-11-24"));
  await generate();
  expect(await datesOf(counted)).toEqual(["2026-11-19", "2026-11-20"]);
  expect(await datesOf(dated)).toEqual(["2026-11-19", "2026-11-20"]);
});

test("editing a rule changes future occurrences only", async () => {
  const { t, make, setRepeat, generate, rule, occurrences } = await setup();
  const taskId = await make("Water the plants", { estimateMinutes: 15 });
  const { ruleId } = unwrap(await setRepeat(taskId, daily));
  at(nineAm("2026-11-20"));
  await generate();
  const second = (await occurrences(ruleId)).find((task) => task.repeat?.date === "2026-11-20")!._id;

  unwrap(await t.mutation(api.planner.tasks.rename, { taskId: second, title: "Water the ferns" }));
  unwrap(await t.mutation(api.planner.tasks.setEstimate, { taskId: second, minutes: 45 }));
  unwrap(await setRepeat(second, daily));
  expect(await rule(ruleId)).toMatchObject({ task: { title: "Water the ferns", estimateMinutes: 45 }, next: { kind: "due", date: "2026-11-21" } });

  at(nineAm("2026-11-21"));
  await generate();
  expect((await occurrences(ruleId)).map(({ title, estimateMinutes }) => ({ title, estimateMinutes }))).toEqual([
    { title: "Water the plants", estimateMinutes: 15 },
    { title: "Water the ferns", estimateMinutes: 45 },
    { title: "Water the ferns", estimateMinutes: 45 },
  ]);
});

test("an edit starts after the latest occurrence, even when that occurrence is still ahead", async () => {
  const { make, setRepeat, rule, datesOf } = await setup();
  const taskId = await make("Water the plants");
  const { ruleId } = unwrap(await setRepeat(taskId, { kind: "weeks", every: 1, days: [1] }));
  unwrap(await setRepeat(taskId, daily));
  expect(await rule(ruleId)).toMatchObject({ anchor: "2026-11-24", next: { kind: "due", date: "2026-11-24" } });
  expect(await datesOf(ruleId)).toEqual(["2026-11-23"]);
});

test("editing only the end keeps an every-n-weeks rhythm", async () => {
  const { make, setRepeat, rule, occurrences } = await setup();
  const fortnightly: Schedule = { kind: "weeks", every: 2, days: [4] };
  const bins = unwrap(await setRepeat(await make("Put the bins out"), fortnightly)).ruleId;
  expect((await rule(bins))?.next).toEqual({ kind: "due", date: "2026-12-03" });
  at(nineAm("2026-11-23"));
  const binsTask = (await occurrences(bins))[0]!._id;
  unwrap(await setRepeat(binsTask, fortnightly, { kind: "after", count: 10 }));
  expect((await rule(bins))?.next).toEqual({ kind: "due", date: "2026-12-03" });
});

test("skipping moves past one occurrence without creating it, and a stale skip is refused", async () => {
  const { t, make, setRepeat, rule, datesOf } = await setup();
  const { ruleId } = unwrap(await setRepeat(await make("Water the plants"), daily));
  const skipped = unwrap(await t.mutation(api.planner.recurrence.skip, { ruleId, date: "2026-11-20" }));
  expect(skipped.next).toEqual({ kind: "due", date: "2026-11-21" });
  expect(await t.mutation(api.planner.recurrence.skip, { ruleId, date: "2026-11-20" })).toEqual({
    ok: false,
    error: { kind: "stale_occurrence", ruleId, date: "2026-11-20" },
  });
  expect(await datesOf(ruleId)).toEqual(["2026-11-19"]);
  unwrap(await t.mutation(api.platform.undo.undo, { activityId: skipped.activityId! }));
  expect((await rule(ruleId))?.next).toEqual({ kind: "due", date: "2026-11-20" });
});

test("completing the current after-completion instance schedules the next one, and undo or reopening reverts it", async () => {
  const { t, make, setRepeat, generate, rule, occurrences, card } = await setup();
  const taskId = await make("Descale the kettle");
  const { ruleId } = unwrap(await setRepeat(taskId, { kind: "afterCompletion", every: 3, unit: "day" }));
  expect(await card(taskId)).toMatchObject({ when: { kind: "inbox" }, repeat: { ruleId, date: "2026-11-19" } });
  expect((await rule(ruleId))?.next).toEqual({ kind: "waiting" });

  const { activityId } = unwrap(await t.mutation(api.planner.tasks.complete, { taskId }));
  expect((await rule(ruleId))?.next).toEqual({ kind: "due", date: "2026-11-22" });
  unwrap(await t.mutation(api.platform.undo.undo, { activityId: activityId! }));
  expect((await rule(ruleId))?.next).toEqual({ kind: "waiting" });

  unwrap(await t.mutation(api.planner.tasks.complete, { taskId }));
  unwrap(await t.mutation(api.planner.tasks.uncomplete, { taskId }));
  expect((await rule(ruleId))?.next).toEqual({ kind: "waiting" });

  unwrap(await t.mutation(api.planner.tasks.complete, { taskId }));
  unwrap(await t.mutation(api.planner.recurrence.skip, { ruleId, date: "2026-11-22" }));
  unwrap(await t.mutation(api.planner.selection.complete, { taskIds: [taskId] }));
  expect((await rule(ruleId))?.next).toEqual({ kind: "due", date: "2026-11-25" });

  at(nineAm("2026-11-25"));
  await generate();
  const next = (await occurrences(ruleId)).find((task) => task.repeat?.date === "2026-11-25")!;
  expect(next.when).toEqual({ kind: "scheduled", date: "2026-11-25", evening: false });
  expect((await rule(ruleId))?.next).toEqual({ kind: "waiting" });
  unwrap(await t.mutation(api.planner.tasks.uncomplete, { taskId }));
  unwrap(await t.mutation(api.planner.tasks.complete, { taskId }));
  expect((await rule(ruleId))?.next).toEqual({ kind: "waiting" });

  at(nineAm("2026-11-26"));
  unwrap(await t.mutation(api.planner.selection.complete, { taskIds: [next._id] }));
  expect((await rule(ruleId))?.next).toEqual({ kind: "due", date: "2026-11-29" });
});

test("completing and reopening a Project moves its after-completion Tasks on and back", async () => {
  const { t, make, setRepeat, rule } = await setup();
  const { projectId } = unwrap(await t.mutation(api.planner.projects.create, { title: "Garden" }));
  const taskId = await make("Mulch the beds");
  unwrap(await t.mutation(api.planner.tasks.move, { taskId, parent: { kind: "project", projectId } }));
  const { ruleId } = unwrap(await setRepeat(taskId, { kind: "afterCompletion", every: 1, unit: "week" }));
  unwrap(await t.mutation(api.planner.projects.complete, { projectId }));
  expect((await rule(ruleId))?.next).toEqual({ kind: "due", date: "2026-11-26" });
  unwrap(await t.mutation(api.planner.projects.reopen, { projectId }));
  expect((await rule(ruleId))?.next).toEqual({ kind: "waiting" });
});

test("a rule rolls over at local midnight on both daylight-saving change days", async () => {
  const days = [
    { start: "2026-04-04T01:00:00Z", steps: [["2026-04-04T12:59:59Z", "2026-04-04T13:00:00Z", "2026-04-05"], ["2026-04-05T13:59:59Z", "2026-04-05T14:00:00Z", "2026-04-06"]] },
    { start: "2026-10-03T02:00:00Z", steps: [["2026-10-03T13:59:59Z", "2026-10-03T14:00:00Z", "2026-10-04"], ["2026-10-04T12:59:59Z", "2026-10-04T13:00:00Z", "2026-10-05"]] },
  ] as const;
  for (const timeZone of ["Australia/Melbourne", "Australia/Sydney"]) {
    for (const { start, steps } of days) {
      at(Date.parse(start));
      const { make, setRepeat, generate, datesOf } = await setup();
      const { ruleId } = unwrap(await setRepeat(await make("Water the plants"), daily, never, timeZone));
      for (const [before, midnight, date] of steps) {
        at(Date.parse(before));
        await generate();
        const dates = await datesOf(ruleId);
        expect(dates).not.toContain(date);
        at(Date.parse(midnight));
        await generate();
        expect(await datesOf(ruleId)).toEqual([...dates, date]);
      }
    }
  }
});

test("a generated Task leaves a trashed Area and drops a removed Label", async () => {
  const { t, make, setRepeat, generate, occurrences } = await setup();
  const { areaId } = unwrap(await t.mutation(api.planner.areas.create, { title: "Home" }));
  const { labelId: kept } = unwrap(await t.mutation(api.planner.labels.create, { name: "Errand", colour: "green" }));
  const { labelId: removed } = unwrap(await t.mutation(api.planner.labels.create, { name: "Chore", colour: "rose" }));
  const taskId = await make("Water the plants");
  unwrap(await t.mutation(api.planner.tasks.move, { taskId, parent: { kind: "area", areaId } }));
  unwrap(await t.mutation(api.planner.tasks.setLabels, { taskId, labelIds: [kept, removed] }));
  const { ruleId } = unwrap(await setRepeat(taskId, daily));
  unwrap(await t.mutation(api.planner.areas.trash, { areaId }));
  unwrap(await t.mutation(api.planner.labels.remove, { labelId: removed }));
  at(nineAm("2026-11-20"));
  await generate();
  const created = (await occurrences(ruleId)).find((task) => task.repeat?.date === "2026-11-20");
  expect(created).toMatchObject({ parent: { kind: "loose" }, labelIds: [kept] });
  expect(created?.trashedAt).toBeUndefined();
});

test("rows carry the repeat, Upcoming shows each rule's next occurrence, and stopping ends both", async () => {
  const { t, make, setRepeat } = await setup();
  const { areaId } = unwrap(await t.mutation(api.planner.areas.create, { title: "Home" }));
  const taskId = await make("Water the plants", { estimateMinutes: 15 });
  unwrap(await t.mutation(api.planner.tasks.move, { taskId, parent: { kind: "area", areaId } }));
  const { ruleId } = unwrap(await setRepeat(taskId, daily));
  const row = async () => unwrap(await t.query(api.planner.today.get, { date: "2026-11-19" })).tasks.find((task) => task._id === taskId);
  expect((await row())?.repeat).toEqual({
    ruleId,
    date: "2026-11-19",
    active: true,
    schedule: daily,
    end: never,
    next: { kind: "due", date: "2026-11-20" },
  });
  expect(unwrap(await t.query(api.planner.recurrence.upcoming, { date: "2026-11-19", days: 7 }))).toEqual([
    {
      ruleId,
      taskId,
      date: "2026-11-20",
      title: "Water the plants",
      estimateMinutes: 15,
      evening: false,
      schedule: daily,
      end: never,
      area: expect.objectContaining({ _id: areaId, title: "Home" }),
    },
  ]);
  expect(unwrap(await t.query(api.planner.recurrence.upcoming, { date: "2026-11-20", days: 7 }))).toEqual([]);

  expect(unwrap(await t.mutation(api.planner.recurrence.stopRepeat, { taskId })).changed).toBe(true);
  expect((await row())?.repeat).toMatchObject({ ruleId, active: false, next: { kind: "ended" } });
  expect(unwrap(await t.query(api.planner.recurrence.upcoming, { date: "2026-11-19", days: 7 }))).toEqual([]);
});

test("a stranger or a signed-out caller cannot read or change Recurrence Rules", async () => {
  const anonymous = newSignedOutBackend();
  const owner = await signInWithGithub(anonymous, ownerGithubId, "avi");
  const stranger = await strangerSession(anonymous);
  const { taskId } = unwrap(await owner.mutation(api.planner.tasks.create, { title: "Water the plants" }));
  const repeat = { taskId, schedule: daily, end: never, timeZone: melbourne };
  const { ruleId } = unwrap(await owner.mutation(api.planner.recurrence.setRepeat, repeat));
  for (const [caller, kind] of [
    [anonymous, "signed_out"],
    [stranger, "not_owner"],
  ] as const) {
    expect(
      await Promise.all([
        refusal(caller.mutation(api.planner.recurrence.setRepeat, repeat)),
        refusal(caller.mutation(api.planner.recurrence.stopRepeat, { taskId })),
        refusal(caller.mutation(api.planner.recurrence.skip, { ruleId, date: "2026-11-20" })),
        refusal(caller.query(api.planner.recurrence.upcoming, { date: "2026-11-19", days: 7 })),
      ]),
    ).toEqual(Array.from({ length: 4 }, () => kind));
  }
  expect((await owner.run((ctx) => ctx.db.get("recurrenceRules", ruleId)))?.next).toEqual({ kind: "due", date: "2026-11-20" });
});
