import { expect, test } from "vitest";
import { api } from "../_generated/api";
import { newBackend, unwrap } from "../backend.test-utils";

const nineAm = Date.UTC(2026, 10, 18, 22, 0);
const hour = 60 * 60 * 1000;

const setup = async () => {
  const t = await newBackend();
  const { taskId } = unwrap(
    await t.mutation(api.planner.tasks.create, { title: "Write chapter two", deadline: "2026-11-27" }),
  );
  const card = async () => (await t.query(api.planner.tasks.card, { taskId }))!;
  return { t, taskId, card };
};

test("Work Blocks are created, moved, resized, completed and removed, each undoable, without touching the Deadline", async () => {
  const { t, taskId, card } = await setup();
  const created = unwrap(
    await t.mutation(api.planner.workBlocks.create, { taskId, start: nineAm, minutes: 90, timeZone: "Australia/Sydney" }),
  );
  const { blockId } = created;
  const moved = unwrap(await t.mutation(api.planner.workBlocks.move, { blockId, start: nineAm + hour }));
  const resized = unwrap(await t.mutation(api.planner.workBlocks.resize, { blockId, minutes: 60 }));
  const completed = unwrap(await t.mutation(api.planner.workBlocks.complete, { blockId, done: true }));
  expect((await card()).workBlocks).toMatchObject([{ start: nineAm + hour, minutes: 60, done: true }]);
  expect((await card()).deadline).toBe("2026-11-27");

  const removed = unwrap(await t.mutation(api.planner.workBlocks.remove, { blockId }));
  expect((await card()).workBlocks).toEqual([]);

  for (const { activityId } of [removed, completed, resized, moved]) {
    unwrap(await t.mutation(api.platform.undo.undo, { activityId: activityId! }));
  }
  expect((await card()).workBlocks).toMatchObject([
    { start: nineAm, minutes: 90, done: false, timeZone: "Australia/Sydney" },
  ]);
  unwrap(await t.mutation(api.platform.undo.undo, { activityId: created.activityId! }));
  expect((await card()).workBlocks).toEqual([]);
});

test("a Work Block needs a real start, a positive length and a real time zone", async () => {
  const { t, taskId } = await setup();
  const block = { taskId, start: nineAm, minutes: 30, timeZone: "Australia/Sydney" };
  expect(await t.mutation(api.planner.workBlocks.create, { ...block, minutes: 0 })).toEqual({
    ok: false,
    error: { kind: "invalid_block", reason: "minutes" },
  });
  expect(await t.mutation(api.planner.workBlocks.create, { ...block, start: Number.NaN })).toEqual({
    ok: false,
    error: { kind: "invalid_block", reason: "start" },
  });
  expect(await t.mutation(api.planner.workBlocks.create, { ...block, timeZone: "Mars/Olympus" })).toEqual({
    ok: false,
    error: { kind: "invalid_block", reason: "time_zone" },
  });
});

test("a removed Work Block cannot be moved, resized, completed or removed again", async () => {
  const { t, taskId } = await setup();
  const { blockId } = unwrap(
    await t.mutation(api.planner.workBlocks.create, { taskId, start: nineAm, minutes: 30, timeZone: "Australia/Sydney" }),
  );
  unwrap(await t.mutation(api.planner.workBlocks.remove, { blockId }));
  const missing = { ok: false, error: { kind: "not_found", table: "workBlocks", id: blockId } };
  expect(await t.mutation(api.planner.workBlocks.move, { blockId, start: nineAm + hour })).toEqual(missing);
  expect(await t.mutation(api.planner.workBlocks.resize, { blockId, minutes: 60 })).toEqual(missing);
  expect(await t.mutation(api.planner.workBlocks.complete, { blockId, done: true })).toEqual(missing);
  expect(await t.mutation(api.planner.workBlocks.remove, { blockId })).toEqual(missing);
});

test("a list row carries its Task's Work Blocks in start order, without the removed ones", async () => {
  const { t, taskId } = await setup();
  const block = { taskId, minutes: 30, timeZone: "Australia/Sydney" };
  unwrap(await t.mutation(api.planner.workBlocks.create, { ...block, start: nineAm + hour }));
  unwrap(await t.mutation(api.planner.workBlocks.create, { ...block, start: nineAm, minutes: 90 }));
  const gone = unwrap(await t.mutation(api.planner.workBlocks.create, { ...block, start: nineAm + 2 * hour }));
  unwrap(await t.mutation(api.planner.workBlocks.remove, { blockId: gone.blockId }));

  const { tasks } = await t.query(api.planner.lists.inbox, {});
  expect(tasks.map((task) => task.workBlocks.map(({ start, minutes, done }) => [start, minutes, done]))).toEqual([
    [
      [nineAm, 90, false],
      [nineAm + hour, 30, false],
    ],
  ]);
});
