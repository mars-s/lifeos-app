import { expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import { newBackend, registerWorker, unwrap } from "../backend.test-utils";
import { snapshotOf, thingsTask } from "./things.test-utils";

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
  await t.mutation(api.planner.things.sync, {
    token,
    snapshot: snapshotOf({
      areas: [{ thingsId: "A1", title: "University", index: 0 }],
      projects: [
        {
          thingsId: "P1",
          title: "Thesis",
          notes: "",
          status: "open",
          when: { kind: "anytime" },
          tags: [],
          areaThingsId: "A1",
          index: 0,
          modifiedAt: 1,
        },
      ],
      tasks: [
        thingsTask("T2", "Read chapter", { list: "today", index: 1, when: scheduled(today), areaThingsId: "A1" }),
        thingsTask("T1", "Draft intro", { list: "today", index: 0, when: scheduled(today), projectThingsId: "P1" }),
        thingsTask("T3", "Loose errand", { list: "today", index: 2, when: scheduled(today) }),
      ],
    }),
  });
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
