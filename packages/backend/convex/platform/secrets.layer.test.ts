import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Redacted } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import type { ActionCtx } from "../_generated/server";
import { asWire } from "../../shared/result";
import { Acts } from "./effect";
import { saveSecret, Secrets } from "./secrets";

const answering = (status: number, asked: string[]) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      asked.push(request.headers.authorization ?? "");
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response("{}", { status })));
    }),
  );

const storing = (stored: unknown[]) => {
  const ctx = { runMutation: async (_ref: unknown, args: unknown) => (stored.push(args), null) };
  return Layer.succeed(Acts, ctx as unknown as ActionCtx);
};

describe("saving a key on the test Layers", () => {
  it.effect("checks the key with the provider, seals it and stores only the sealed copy", () =>
    Effect.gen(function* () {
      const asked: string[] = [];
      const stored: unknown[] = [];
      const saved = yield* saveSecret("openai", " sk-test-wxyz ").pipe(
        Effect.provide(Layer.mergeAll(Secrets.layerTest({}), answering(200, asked), storing(stored))),
      );
      expect(saved).toStrictEqual({ last4: "wxyz", savedAt: 0 });
      expect(asked).toStrictEqual(["Bearer sk-test-wxyz"]);
      expect(stored).toStrictEqual([{ name: "openai", iv: "test", ciphertext: "openai:12", last4: "wxyz", savedAt: 0 }]);
    }),
  );

  it.effect("turns a 401 into refused and stores nothing", () =>
    Effect.gen(function* () {
      const stored: unknown[] = [];
      const wire = yield* asWire(saveSecret("openai", "sk-wrong")).pipe(
        Effect.provide(Layer.mergeAll(Secrets.layerTest({}), answering(401, []), storing(stored))),
      );
      expect(wire).toStrictEqual({ ok: false, error: { kind: "refused" } });
      expect(stored).toStrictEqual([]);
    }),
  );

  it.effect("asks no provider while the sealing key is missing", () =>
    Effect.gen(function* () {
      const asked: string[] = [];
      const wire = yield* asWire(saveSecret("openai", "sk-test")).pipe(
        Effect.provide(Layer.mergeAll(Secrets.layerTest({}, "not_set_up"), answering(200, asked), storing([]))),
      );
      expect(wire).toStrictEqual({ ok: false, error: { kind: "not_set_up" } });
      expect(asked).toStrictEqual([]);
    }),
  );

  it.effect("reveals a fixed key as Redacted", () =>
    Effect.gen(function* () {
      const secrets = yield* Secrets;
      expect(Option.map(yield* secrets.reveal("openai"), Redacted.value)).toStrictEqual(Option.some("sk-fixed"));
      expect(yield* secrets.reveal("opencodeGo")).toStrictEqual(Option.none());
    }).pipe(Effect.provide(Secrets.layerTest({ openai: "sk-fixed" }))),
  );
});
