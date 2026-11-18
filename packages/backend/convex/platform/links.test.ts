import { expect, test } from "vitest";
import { api } from "../_generated/api";
import { newBackend, unwrap } from "../backend.test-utils";

test("linking two things shows a backlink, and undo removes it", async () => {
  const t = newBackend();
  const thesis = unwrap(await t.mutation(api.planner.tasks.create, { title: "Write thesis" }));
  const reading = unwrap(await t.mutation(api.planner.tasks.create, { title: "Read Smith 2024" }));
  const from = { table: "tasks" as const, id: reading.taskId };
  const to = { table: "tasks" as const, id: thesis.taskId };
  const linked = unwrap(await t.mutation(api.platform.links.link, { from, to }));
  expect(await t.query(api.platform.links.backlinks, { to })).toEqual([{ linkId: linked.linkId, from }]);
  expect(await t.query(api.platform.links.backlinks, { to: from })).toEqual([]);
  unwrap(await t.mutation(api.platform.undo.undo, { activityId: linked.activityId! }));
  expect(await t.query(api.platform.links.backlinks, { to })).toEqual([]);
});
