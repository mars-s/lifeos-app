import { expect, test } from "vitest";
import { api } from "../_generated/api";
import { newBackend, registerWorker, unwrap } from "../backend.test-utils";
import { packDate, rowsOf, thingsItem, thingsProject } from "./things.test-utils";

const today = "2026-11-18";
const scheduled = (date: string, evening = false) => ({ kind: "scheduled" as const, date, evening });

const titles = (tasks: { title: string }[]) => tasks.map((task) => task.title);

test("Today holds open Tasks scheduled on or before the date and Tasks due by then, with This Evening apart", async () => {
  const t = await newBackend();
  const create = async (title: string, fields: Record<string, unknown> = {}) =>
    unwrap(await t.mutation(api.planner.tasks.create, { title, ...fields })).taskId;
  await create("Overdue essay", { when: scheduled("2026-11-16") });
  await create("Due today", { when: { kind: "anytime" }, deadline: today });
  await create("Cook dinner", { when: scheduled(today, true) });
  await create("Gym", { when: scheduled(today) });
  await create("Tomorrow", { when: scheduled("2026-11-19") });
  await create("Inbox thought");
  await create("Someday but due", { when: { kind: "someday" }, deadline: today });
  const done = await create("Already done", { when: scheduled(today) });
  const binned = await create("Binned", { when: scheduled(today) });
  await t.mutation(api.planner.tasks.complete, { taskId: done });
  await t.mutation(api.planner.tasks.trash, { taskId: binned });

  const view = unwrap(await t.query(api.planner.today.get, { date: today }));
  expect(titles(view.tasks)).toEqual(["Overdue essay", "Gym", "Due today"]);
  expect(titles(view.evening)).toEqual(["Cook dinner"]);
});

test("Things' own Today order leads, and each Task carries its Project or Area as context", async () => {
  const t = await newBackend();
  const token = await registerWorker(t, "things", ["things"]);
  const onToday = { start: 1, startDate: packDate(today) };
  unwrap(
    await t.action(api.planner.things.importRows, {
      token,
      rows: rowsOf({
        areas: [{ uuid: "A1", title: "University", index: 0 }],
        items: [
          thingsProject("P1", "Thesis", { area: "A1" }),
          thingsItem("T2", "Read chapter", { ...onToday, todayIndex: -10, area: "A1" }),
          thingsItem("T1", "Draft intro", { ...onToday, todayIndex: -50, project: "P1" }),
          thingsItem("T3", "Loose errand", { ...onToday, todayIndex: 461 }),
        ],
      }),
    }),
  );
  unwrap(await t.mutation(api.planner.tasks.create, { title: "LifeOS only", when: scheduled("2026-11-17") }));

  const view = unwrap(await t.query(api.planner.today.get, { date: today }));
  expect(view.tasks.map(({ title, context }) => [title, context])).toEqual([
    ["Draft intro", "Thesis"],
    ["Read chapter", "University"],
    ["Loose errand", undefined],
    ["LifeOS only", undefined],
  ]);
});

test("Today refuses a date that is not a real calendar date", async () => {
  const t = await newBackend();
  expect(await t.query(api.planner.today.get, { date: "2026-13-01" })).toEqual({
    ok: false,
    error: { kind: "invalid_date", input: "2026-13-01" },
  });
});

test("a hand order in Today replaces Things' order from the first drag, and undo puts Things' order back", async () => {
  const t = await newBackend();
  const token = await registerWorker(t, "things", ["things"]);
  const onToday = { start: 1, startDate: packDate(today) };
  unwrap(
    await t.action(api.planner.things.importRows, {
      token,
      rows: rowsOf({
        items: [
          thingsItem("T1", "Draft intro", { ...onToday, todayIndex: -50 }),
          thingsItem("T2", "Read chapter", { ...onToday, todayIndex: -10 }),
        ],
      }),
    }),
  );
  const own = unwrap(await t.mutation(api.planner.tasks.create, { title: "LifeOS only", when: scheduled("2026-11-17") })).taskId;
  const view = async () => unwrap(await t.query(api.planner.today.get, { date: today }));
  const [intro, chapter] = (await view()).tasks.map((task) => task._id);

  const dragged = unwrap(await t.mutation(api.planner.plan.place, { taskId: own, date: today, order: [intro!, own, chapter!] }));
  expect(titles((await view()).tasks)).toEqual(["Draft intro", "LifeOS only", "Read chapter"]);

  unwrap(await t.mutation(api.platform.undo.undo, { activityId: dragged.activityId! }));
  expect(titles((await view()).tasks)).toEqual(["Draft intro", "Read chapter", "LifeOS only"]);
});

test("a drag into This Evening moves the Task there at that place, and back out again", async () => {
  const t = await newBackend();
  const create = async (title: string, evening = false) =>
    unwrap(await t.mutation(api.planner.tasks.create, { title, when: scheduled(today, evening) })).taskId;
  const gym = await create("Gym");
  const cook = await create("Cook dinner", true);
  const read = await create("Read", true);
  const view = async () => unwrap(await t.query(api.planner.today.get, { date: today }));

  unwrap(await t.mutation(api.planner.plan.place, { taskId: gym, date: today, order: [cook, gym, read], evening: true }));
  expect([titles((await view()).tasks), titles((await view()).evening)]).toEqual([[], ["Cook dinner", "Gym", "Read"]]);

  unwrap(await t.mutation(api.planner.plan.place, { taskId: read, date: today, order: [read], evening: false }));
  expect([titles((await view()).tasks), titles((await view()).evening)]).toEqual([["Read"], ["Cook dinner", "Gym"]]);
});

test("a new Task can take a place in Today and on an Upcoming day, and one undo removes it", async () => {
  const t = await newBackend();
  const create = async (title: string, date = today) => unwrap(await t.mutation(api.planner.tasks.create, { title, when: scheduled(date) })).taskId;
  const first = await create("First");
  const second = await create("Second");
  const monday = "2026-11-23";
  const early = await create("Early", monday);
  const late = await create("Late", monday);

  const made = unwrap(
    await t.mutation(api.planner.tasks.create, { title: "Between", when: scheduled(today), place: { date: today, order: [first, second], at: 1 } }),
  );
  expect(titles(unwrap(await t.query(api.planner.today.get, { date: today })).tasks)).toEqual(["First", "Between", "Second"]);

  unwrap(await t.mutation(api.planner.tasks.create, { title: "Top", when: scheduled(monday), place: { date: monday, order: [early, late], at: 0 } }));
  const upcoming = unwrap(await t.query(api.planner.lists.upcoming, { date: today, days: 14 }));
  expect(titles(upcoming.days.find((day) => day.date === monday)?.tasks ?? [])).toEqual(["Top", "Early", "Late"]);

  unwrap(await t.mutation(api.platform.undo.undo, { activityId: made.activityId! }));
  expect(titles(unwrap(await t.query(api.planner.today.get, { date: today })).tasks)).toEqual(["First", "Second"]);
});

test("an Upcoming day keeps its hand order, and a drag to another day moves the Task there", async () => {
  const t = await newBackend();
  const monday = "2026-11-23";
  const tuesday = "2026-11-24";
  const create = async (title: string, date: string) => unwrap(await t.mutation(api.planner.tasks.create, { title, when: scheduled(date) })).taskId;
  const one = await create("One", monday);
  const two = await create("Two", monday);
  const three = await create("Three", tuesday);
  const days = async () =>
    unwrap(await t.query(api.planner.lists.upcoming, { date: today, days: 14 })).days.map((day) => [day.date, titles(day.tasks)]);

  unwrap(await t.mutation(api.planner.plan.place, { taskId: two, date: monday, order: [two, one] }));
  expect(await days()).toEqual([
    [monday, ["Two", "One"]],
    [tuesday, ["Three"]],
  ]);

  unwrap(await t.mutation(api.planner.plan.place, { taskId: one, date: tuesday, order: [three, one] }));
  expect(await days()).toEqual([
    [monday, ["Two"]],
    [tuesday, ["Three", "One"]],
  ]);
});

test("a new Task's place is refused when its day is not real or its spot is outside the day, and nothing is made", async () => {
  const t = await newBackend();
  expect(await t.mutation(api.planner.tasks.create, { title: "Lost", when: scheduled(today), place: { date: "2026-02-31", order: [], at: 0 } })).toEqual({
    ok: false,
    error: { kind: "invalid_plan", reason: "range" },
  });
  expect(await t.mutation(api.planner.tasks.create, { title: "Lost", when: scheduled(today), place: { date: today, order: [], at: 3 } })).toEqual({
    ok: false,
    error: { kind: "invalid_plan", reason: "order" },
  });
  expect(unwrap(await t.query(api.planner.today.get, { date: today })).tasks).toEqual([]);
});
