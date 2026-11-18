import { expect, test } from "vitest";
import { api, internal } from "../_generated/api";
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

test("the MCP today tool reads the same Today through its internal query", async () => {
  const t = await newBackend();
  unwrap(await t.mutation(api.planner.tasks.create, { title: "Gym", when: scheduled(today) }));
  const view = unwrap(await t.query(internal.planner.today.getForAgent, { date: today }));
  expect(titles(view.tasks)).toEqual(["Gym"]);
});
