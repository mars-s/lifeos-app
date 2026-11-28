import type { RegisteredMutation } from "convex/server";
import { ConvexError, v } from "convex/values";
import { Effect, Schema } from "effect";
import { expect, expectTypeOf, test } from "vitest";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { newBackend, registerWorker, runIn, type Backend } from "../backend.test-utils";
import { readAsOwner as readAsOwnerIn } from "./access";
import {
  changeAs,
  changeMutation,
  CurrentActor,
  CurrentWorker,
  internalAction,
  internalMutation,
  ownerQuery,
  reading,
  readAsOwner,
  recording,
  runChange,
  workerMutation,
  writing,
  Writes,
} from "./effect";
import type { Wire, SerialisedResult } from "../../shared/result";

class EmptyTitle extends Schema.TaggedError<EmptyTitle>()("EffectTestEmptyTitle", { kind: Schema.tag("empty_title") }) {}

class AreaNotFound extends Schema.TaggedError<AreaNotFound>()("EffectTestAreaNotFound", {
  kind: Schema.tag("not_found"),
  table: Schema.tag("areas"),
  id: Schema.String,
}) {}

const parseTitle = (title: string) => (title.trim() ? Effect.succeed(title.trim()) : Effect.fail(new EmptyTitle()));

const loadArea = Effect.fn("effectTest.loadArea")(function* (areaId: Id<"areas">) {
  const area = yield* reading((ctx) => ctx.db.get("areas", areaId));
  if (!area) return yield* new AreaNotFound({ id: areaId });
  return area;
});

const addArea = changeMutation({
  action: "effectTest.addArea",
  args: { title: v.string() },
  handler: Effect.fn("effectTest.addArea")(function* ({ title }) {
    const areaId = yield* recording((record) => record.insert("areas", { title, colour: "teal", order: "a0" }));
    const named = yield* parseTitle(title);
    const actor = yield* CurrentActor;
    return { areaId, named, by: actor.kind };
  }),
});

const renameArea = changeMutation({
  action: "effectTest.renameArea",
  args: { areaId: v.id("areas"), title: v.string() },
  handler: Effect.fn("effectTest.renameArea")(function* ({ areaId, title }) {
    const named = yield* parseTitle(title);
    const area = yield* loadArea(areaId);
    return { changed: yield* recording((record) => record.patch("areas", area._id, { title: named })) };
  }),
});

const areaTitles = ownerQuery({
  args: {},
  handler: () => reading(async (ctx) => (await ctx.db.query("areas").collect()).map((area) => area.title)),
});

const strict = ownerQuery({
  args: {},
  handler: () =>
    reading(() => {
      throw new ConvexError({ kind: "not_owner", message: "This is not your LifeOS." });
    }),
});

const touchWorker = workerMutation({
  args: {},
  handler: () =>
    Effect.gen(function* () {
      const worker = yield* CurrentWorker;
      return yield* writing(async (ctx) => {
        await ctx.db.patch("workers", worker._id, { capabilities: ["notes"] });
        return worker.name;
      });
    }),
});

const countAreas = internalMutation({
  args: {},
  returns: v.number(),
  handler: () => reading(async (ctx) => (await ctx.db.query("areas").collect()).length),
});

const waitABit = internalAction({
  args: { ms: v.number() },
  handler: ({ ms }) => Effect.sleep(ms).pipe(Effect.as(ms)),
});

type Handled<Args, Output> = { _handler: (ctx: unknown, args: Args) => Promise<Output> };

const handlerOf = <Args, Output>(registered: unknown) => (registered as Handled<Args, Output>)._handler;

const counts = (t: Backend) =>
  t.run(async (ctx) => [(await ctx.db.query("areas").collect()).length, (await ctx.db.query("activity").collect()).length]);

const seedArea = (t: Backend) => t.run((ctx) => ctx.db.insert("areas", { title: "Home", colour: "teal", order: "a0" }));

test("a change keeps the wire type it had: the value with its activityId, and the plain refusal", () => {
  type Returned = typeof renameArea extends RegisteredMutation<"public", infer _Args, Promise<infer R>> ? R : never;
  expectTypeOf<Returned>().toEqualTypeOf<
    SerialisedResult<{ changed: boolean } & { activityId: Id<"activity"> | null }, Wire<EmptyTitle | AreaNotFound>>
  >();
  expectTypeOf<Wire<EmptyTitle | AreaNotFound>>().toEqualTypeOf<
    { readonly kind: "empty_title" } | { readonly kind: "not_found"; readonly table: "areas"; readonly id: string }
  >();
});

test("a change that succeeds returns the same wire shape as before, with its Activity", async () => {
  const t = await newBackend();
  const saved = await t.run((ctx) => handlerOf<{ title: string }, unknown>(addArea)(ctx, { title: " Home " }));
  expect(saved).toStrictEqual({ ok: true, value: { areaId: expect.any(String), named: "Home", by: "avi", activityId: expect.any(String) } });
  expect(await counts(t)).toEqual([1, 1]);
  expect(await t.run((ctx) => readAsOwnerIn(ctx, areaTitles, {}))).toEqual([" Home "]);
});

test("a refusal before any write crosses the wire as { ok: false, error: { kind } }", async () => {
  const t = await newBackend();
  const areaId = await seedArea(t);
  const refused = await t.run((ctx) => handlerOf<{ areaId: Id<"areas">; title: string }, unknown>(renameArea)(ctx, { areaId, title: "  " }));
  expect(refused).toStrictEqual({ ok: false, error: { kind: "empty_title" } });
  expect(await counts(t)).toEqual([1, 0]);
});

test("a change refused after it wrote keeps none of it", async () => {
  const t = await newBackend();
  await expect(t.run((ctx) => handlerOf<{ title: string }, unknown>(addArea)(ctx, { title: "  " }))).rejects.toThrow(
    "effectTest.addArea was refused after it had written",
  );
  expect(await counts(t)).toEqual([0, 0]);
});

test("a throw inside an Effect leaves the function as the same error, not a wrapped one", async () => {
  const t = await newBackend();
  const thrown = await t.run((ctx) => readAsOwnerIn(ctx, strict, {})).catch((error: unknown) => error);
  expect(thrown).toBeInstanceOf(ConvexError);
  expect((thrown as ConvexError<{ kind: string }>).data.kind).toBe("not_owner");
});

test("changeAs runs a change built with the Effect builder, and a refusal after a write is a defect", async () => {
  const t = await newBackend();
  await expect(runIn(t, changeAs({ kind: "avi" }, addArea, { title: " " }))).rejects.toThrow("refused after it had written");
  expect(await counts(t)).toEqual([0, 0]);
});

test("changeAs and readAsOwner give agent tools the same results as Effects", async () => {
  const t = await newBackend();
  const areaId = await seedArea(t);
  const run = Effect.gen(function* () {
    const renamed = yield* changeAs({ kind: "avi" }, renameArea, { areaId, title: "Uni" });
    const refused = yield* Effect.flip(changeAs({ kind: "avi" }, renameArea, { areaId, title: "" }));
    const titles = yield* readAsOwner(areaTitles, {});
    return { renamed, refused, titles };
  });
  expect(await runIn(t, run)).toStrictEqual({
    renamed: { changed: true, activityId: expect.any(String) },
    refused: { kind: "empty_title" },
    titles: ["Uni"],
  });
});

test("runChange records one Activity for an in-process change, as the given actor", async () => {
  const t = await newBackend();
  const areaId = await seedArea(t);
  const renamed = await runIn(
    t,
    Writes.use((ctx) => runChange(ctx, { kind: "recurrence" }, "effectTest.rename", renameBody(areaId, "Uni"))),
  );
  const activity = await t.run(async (ctx) => ctx.db.query("activity").unique());
  expect(renamed).toStrictEqual({ changed: true, activityId: activity!._id });
  expect(activity).toMatchObject({ actor: { kind: "recurrence" }, action: "effectTest.rename" });
});

const renameBody = (areaId: Id<"areas">, title: string) =>
  Effect.gen(function* () {
    const named = yield* parseTitle(title);
    const area = yield* loadArea(areaId);
    return { changed: yield* recording((record) => record.patch("areas", area._id, { title: named })) };
  });

test("a Worker mutation gets its Worker and may write directly; an internal mutation keeps its returns validator", async () => {
  const t = await newBackend();
  const token = await registerWorker(t, "mac", []);
  expect(await t.run((ctx) => handlerOf<{ token: string }, string>(touchWorker)(ctx, { token }))).toBe("mac");
  expect(await t.run(async (ctx) => (await ctx.db.query("workers").unique())?.capabilities)).toEqual(["notes"]);
  expect(JSON.parse((countAreas as unknown as { exportReturns(): string }).exportReturns())).toMatchObject({ type: "number" });
  expect(await t.run((ctx) => handlerOf<Record<string, never>, number>(countAreas)(ctx, {}))).toBe(0);
});

test("an action runs on the default scheduler, so it may wait on a timer", async () => {
  expect(await handlerOf<{ ms: number }, number>(waitABit)({} as ActionCtx, { ms: 5 })).toBe(5);
});
