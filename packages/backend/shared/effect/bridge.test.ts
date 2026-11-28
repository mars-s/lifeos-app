import { describe, expect, it } from "@effect/vitest";
import { ConvexError } from "convex/values";
import { Cause, Effect, Exit, Result } from "effect";
import { err, errAsync, ok, okAsync, type Result as Outcome } from "neverthrow";
import { expectTypeOf } from "vitest";
import { effectFromNeverthrow, fromNeverthrow, toNeverthrow } from "./bridge";
import { InvalidDate } from "./errors";

type Missing = { readonly kind: "not_found"; readonly table: "tasks"; readonly id: string };

const missing: Missing = { kind: "not_found", table: "tasks", id: "t1" };

describe("the neverthrow bridge", () => {
  it("reads a neverthrow Result as an Effect Result", () => {
    expect(fromNeverthrow(ok<number, Missing>(3))).toStrictEqual(Result.succeed(3));
    expect(fromNeverthrow(err<number, Missing>(missing))).toStrictEqual(Result.fail(missing));
  });

  it("hands an old caller a neverthrow Result whose error is the plain wire error", () => {
    const refused = toNeverthrow(Result.fail(new InvalidDate({ input: "soon" })));
    expect(refused.isErr() && refused.error).toStrictEqual({ kind: "invalid_date", input: "soon" });
    const saved = toNeverthrow(Result.succeed({ taskId: "t1" }));
    expect(saved.isOk() && saved.value).toStrictEqual({ taskId: "t1" });
    expectTypeOf(refused).toEqualTypeOf<Outcome<never, { readonly kind: "invalid_date"; readonly input: string }>>();
  });

  it("passes a plain refusal from old code through unchanged", () => {
    const refused = toNeverthrow(Result.fail(missing));
    expect(refused.isErr() && refused.error).toStrictEqual(missing);
  });

  it.effect("runs a thunk that returns a Result, a promise of one or a ResultAsync", () =>
    Effect.gen(function* () {
      expect(yield* effectFromNeverthrow(() => ok<number, Missing>(1))).toBe(1);
      expect(yield* effectFromNeverthrow(async () => ok<number, Missing>(2))).toBe(2);
      expect(yield* effectFromNeverthrow(() => okAsync<number, Missing>(3))).toBe(3);
      expect(yield* Effect.flip(effectFromNeverthrow(() => err<number, Missing>(missing)))).toStrictEqual(missing);
      expect(yield* Effect.flip(effectFromNeverthrow(async () => err<number, Missing>(missing)))).toStrictEqual(missing);
      expect(yield* Effect.flip(effectFromNeverthrow(() => errAsync<number, Missing>(missing)))).toStrictEqual(missing);
    }),
  );

  it.effect("keeps a throw from old code a defect, as the same error", () =>
    Effect.gen(function* () {
      const thrown = new ConvexError({ kind: "not_owner" });
      const throwing: () => Outcome<number, Missing> = () => {
        throw thrown;
      };
      const exit = yield* Effect.exit(effectFromNeverthrow(throwing));
      expect(Exit.isFailure(exit) && Exit.hasDies(exit) && Cause.squash(exit.cause)).toBe(thrown);
    }),
  );
});
