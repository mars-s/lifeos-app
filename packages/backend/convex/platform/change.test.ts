import { v } from "convex/values";
import { err, ok } from "neverthrow";
import { expect, test } from "vitest";
import { newBackend } from "../backend.test-utils";
import { changeAs, changeMutation } from "./change";

const addThenMaybeRefuse = changeMutation({
  action: "test.addThenMaybeRefuse",
  args: { refuse: v.boolean() },
  handler: async (_ctx, { refuse }, record) => {
    await record.insert("areas", { title: "Half done", colour: "teal", order: "a0" });
    return refuse ? err({ kind: "refused" as const }) : ok({ done: true });
  },
});

const counts = (t: Awaited<ReturnType<typeof newBackend>>) =>
  t.run(async (ctx) => [(await ctx.db.query("areas").collect()).length, (await ctx.db.query("activity").collect()).length]);

test("a change refused after it wrote keeps none of it and records no Activity", async () => {
  const t = await newBackend();
  await expect(t.run((ctx) => changeAs(ctx, { kind: "avi" }, addThenMaybeRefuse, { refuse: true }))).rejects.toThrow(
    "test.addThenMaybeRefuse was refused after it had written",
  );
  expect(await counts(t)).toEqual([0, 0]);
});

test("a change that succeeds keeps its writes and its Activity", async () => {
  const t = await newBackend();
  const kept = await t.run(async (ctx) => (await changeAs(ctx, { kind: "avi" }, addThenMaybeRefuse, { refuse: false })).isOk());
  expect(kept).toBe(true);
  expect(await counts(t)).toEqual([1, 1]);
});
