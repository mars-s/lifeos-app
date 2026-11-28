import { ConvexError, v } from "convex/values";
import { Effect, Schema } from "effect";
import { expect, test } from "vitest";
import { newBackend, type Backend } from "../../../convex/backend.test-utils";
import type { Id } from "../../../convex/_generated/dataModel";
import { changeHandler, CurrentActor, queryHandler, reading, recording } from "./convex";

class EmptyTitle extends Schema.TaggedError<EmptyTitle>()("EmptyTitle", { kind: Schema.tag("empty_title") }) {}

class AreaNotFound extends Schema.TaggedError<AreaNotFound>()("AreaNotFound", {
  kind: Schema.tag("not_found"),
  table: Schema.tag("areas"),
  id: Schema.String,
}) {}

const parseTitle = (title: string) => (title.trim() ? Effect.succeed(title.trim()) : Effect.fail(new EmptyTitle()));

const loadArea = Effect.fn("areas.load")(function* (areaId: Id<"areas">) {
  const area = yield* reading((ctx) => ctx.db.get("areas", areaId));
  if (!area) return yield* new AreaNotFound({ id: areaId });
  return area;
});

const addArea = changeHandler({
  action: "pattern.addArea",
  args: { title: v.string() },
  handler: Effect.fn("pattern.addArea")(function* ({ title }) {
    const areaId = yield* recording((record) => record.insert("areas", { title, colour: "teal", order: "a0" }));
    const named = yield* parseTitle(title);
    const actor = yield* CurrentActor;
    return { areaId, named, by: actor.kind };
  }),
});

const renameArea = changeHandler({
  action: "pattern.renameArea",
  args: { areaId: v.id("areas"), title: v.string() },
  handler: Effect.fn("pattern.renameArea")(function* ({ areaId, title }) {
    const named = yield* parseTitle(title);
    const area = yield* loadArea(areaId);
    return { changed: yield* recording((record) => record.patch("areas", area._id, { title: named })) };
  }),
});

const areaTitles = queryHandler({
  args: {},
  handler: () => reading(async (ctx) => (await ctx.db.query("areas").collect()).map((area) => area.title)),
});

const strict = queryHandler({
  args: {},
  handler: () =>
    reading(() => {
      throw new ConvexError({ kind: "not_owner", message: "This is not your LifeOS." });
    }),
});

const counts = (t: Backend) =>
  t.run(async (ctx) => [(await ctx.db.query("areas").collect()).length, (await ctx.db.query("activity").collect()).length]);

test("a change that succeeds returns the same wire shape as before, with its Activity", async () => {
  const t = await newBackend();
  const saved = await t.run((ctx) => addArea(ctx, { title: " Home " }, { kind: "avi" }));
  expect(saved).toStrictEqual({ ok: true, value: { areaId: expect.any(String), named: "Home", by: "avi", activityId: expect.any(String) } });
  expect(await counts(t)).toEqual([1, 1]);
  expect(await t.run((ctx) => areaTitles(ctx, {}))).toEqual([" Home "]);
});

test("a refusal before any write crosses the wire as { ok: false, error: { kind } }", async () => {
  const t = await newBackend();
  const { areaId } = await t.run(async (ctx) => ({ areaId: await ctx.db.insert("areas", { title: "Home", colour: "teal", order: "a0" }) }));
  const refused = await t.run((ctx) => renameArea(ctx, { areaId, title: "  " }, { kind: "avi" }));
  expect(refused).toStrictEqual({ ok: false, error: { kind: "empty_title" } });
  expect(await counts(t)).toEqual([1, 0]);
});

test("a change refused after it wrote keeps none of it", async () => {
  const t = await newBackend();
  await expect(t.run((ctx) => addArea(ctx, { title: "  " }, { kind: "avi" }))).rejects.toThrow(
    "pattern.addArea was refused after it had written",
  );
  expect(await counts(t)).toEqual([0, 0]);
});

test("a throw inside an Effect leaves the function as the same error, not a wrapped one", async () => {
  const t = await newBackend();
  const thrown = await t.run((ctx) => strict(ctx, {})).catch((error: unknown) => error);
  expect(thrown).toBeInstanceOf(ConvexError);
  expect((thrown as ConvexError<{ kind: string }>).data.kind).toBe("not_owner");
});
