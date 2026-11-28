import { describe, expect, it, layer } from "@effect/vitest";
import { Effect, Layer, Redacted } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { TestClock } from "effect/testing";
import { asWire } from "../wire";
import { lastNights, Oura, OuraToken } from "./oura";

const nights = [
  { day: "2026-11-25", score: 71 },
  { day: "2026-11-27", score: null },
  { day: "2026-11-28", score: 88 },
];

layer(Oura.layerTest(nights))("health logic on the test Layer", (scoped) => {
  scoped.effect("keeps the scored nights inside the window, on the test clock", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-11-28T09:00:00Z"));
      expect(yield* lastNights(2)).toStrictEqual([{ day: "2026-11-28", score: 88 }]);
    }),
  );
});

const answering = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Oura.layerNoDeps.pipe(
    Layer.provide(Layer.succeed(OuraToken, Redacted.make("test-token"))),
    Layer.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.succeed(HttpClientResponse.fromWeb(request, new Response(JSON.stringify(body), { status, headers }))),
        ),
      ),
    ),
  );

const sleep = Oura.use((oura) => oura.sleepSince("2026-11-01"));

describe("the Oura boundary", () => {
  it.effect("decodes a page with Schema", () =>
    Effect.gen(function* () {
      expect(yield* sleep).toStrictEqual([{ day: "2026-11-28", score: 88 }]);
    }).pipe(Effect.provide(answering(200, { data: [{ day: "2026-11-28", score: 88, contributors: {} }] }))),
  );

  it.effect("refuses a body that is not the shape Oura documents", () =>
    Effect.gen(function* () {
      expect(yield* asWire(sleep)).toStrictEqual({ ok: false, error: { kind: "invalid_response" } });
    }).pipe(Effect.provide(answering(200, { data: [{ day: 28 }] }))),
  );

  it.effect("turns a 429 into the stored rate_limited refusal", () =>
    Effect.gen(function* () {
      expect(yield* asWire(sleep)).toStrictEqual({ ok: false, error: { kind: "rate_limited", retryAfterSeconds: 30 } });
    }).pipe(Effect.provide(answering(429, {}, { "retry-after": "30" }))),
  );
});
