import { describe, expect, it } from "@effect/vitest";
import { Effect, Result } from "effect";
import { deserialise, serialise } from "../result";
import { err, ok } from "neverthrow";
import { InvalidDate } from "./errors";
import { asWire, resultToWire, wireError, wireToEffect, wireToResult } from "./wire";

describe("the Result wire format", () => {
  it("drops the tag and keeps the kind, so a refusal reads as it always has", () => {
    expect(wireError(new InvalidDate({ input: "2026-02-30" }))).toStrictEqual({ kind: "invalid_date", input: "2026-02-30" });
  });

  it("matches neverthrow's serialise byte for byte", () => {
    const refused = resultToWire(Result.fail(new InvalidDate({ input: "soon" })));
    const saved = resultToWire(Result.succeed({ taskId: "t1", activityId: null }));
    expect(JSON.stringify(refused)).toBe(JSON.stringify(serialise(err({ kind: "invalid_date", input: "soon" }))));
    expect(JSON.stringify(saved)).toBe(JSON.stringify(serialise(ok({ taskId: "t1", activityId: null }))));
  });

  it("is read by the neverthrow decoder an installed app still runs", () => {
    const refused = deserialise(resultToWire(Result.fail(new InvalidDate({ input: "soon" }))));
    expect(refused.isErr() && refused.error.kind).toBe("invalid_date");
  });

  it("passes a refusal from code not yet migrated through unchanged", () => {
    expect(resultToWire(Result.fail({ kind: "not_found", table: "tasks", id: "t1" } as const))).toStrictEqual({
      ok: false,
      error: { kind: "not_found", table: "tasks", id: "t1" },
    });
  });

  it("reads a refusal the same whether or not a tag leaked onto the wire", () => {
    const clean = wireToResult({ ok: false, error: { kind: "empty_title" } });
    const leaked = wireToResult({ ok: false, error: { _tag: "EmptyTitle", kind: "empty_title" } });
    expect(leaked).toStrictEqual(clean);
  });

  it.effect("turns a typed failure into a refusal and leaves the Effect unfailed", () =>
    Effect.gen(function* () {
      const wire = yield* asWire(Effect.fail(new InvalidDate({ input: "soon" })));
      expect(wire).toStrictEqual({ ok: false, error: { kind: "invalid_date", input: "soon" } });
    }),
  );

  it.effect("reads a refusal back into the error channel on the client", () =>
    Effect.gen(function* () {
      const refusal = yield* Effect.flip(wireToEffect<{ taskId: string }, { kind: "invalid_date"; input: string }>({ ok: false, error: { kind: "invalid_date", input: "soon" } }));
      expect(refusal.kind).toBe("invalid_date");
      expect(Result.isSuccess(wireToResult({ ok: true, value: 1 }))).toBe(true);
    }),
  );
});
