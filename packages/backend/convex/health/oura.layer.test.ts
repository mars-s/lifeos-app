import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Redacted } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { TestClock } from "effect/testing";
import { vi } from "vitest";
import { asWire } from "../../shared/effect/wire";
import { OuraUnauthorised } from "./errors";
import { Oura, OuraToken } from "./oura";

type Asked = { url: string; method: string; authorization: string | undefined; body: string };

const answering = (replies: ReadonlyArray<{ status?: number; body: unknown; headers?: Record<string, string> }>, asked: Asked[]) => {
  const remaining = [...replies];
  return Oura.layerNoDeps.pipe(
    Layer.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) => {
          const reply = remaining.shift() ?? { status: 500, body: {} };
          const sent = request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";
          asked.push({
            url: Option.match(HttpClientRequest.toUrl(request), { onNone: () => request.url, onSome: (url) => url.toString() }),
            method: request.method,
            authorization: request.headers.authorization,
            body: sent,
          });
          return Effect.succeed(
            HttpClientResponse.fromWeb(request, new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: reply.headers })),
          );
        }),
      ),
    ),
  );
};

const withToken = Layer.succeed(OuraToken, Redacted.make("test-token"));

describe("the Oura boundary on a canned HttpClient", () => {
  it.effect("exchanges a grant at the token endpoint and decodes the pair against the clock", () =>
    Effect.gen(function* () {
      vi.stubEnv("OURA_CLIENT_ID", "client");
      vi.stubEnv("OURA_CLIENT_SECRET", "secret");
      yield* TestClock.setTime(1_000_000);
      const asked: Asked[] = [];
      const tokens = yield* Oura.use((oura) => oura.exchange({ grant_type: "refresh_token", refresh_token: "r1" })).pipe(
        Effect.provide(answering([{ body: { access_token: "a2", refresh_token: "r2", expires_in: 3600 } }], asked)),
      );
      expect(tokens).toStrictEqual({ accessToken: "a2", refreshToken: "r2", expiresAt: 1_000_000 + 3_600_000, scope: "daily" });
      expect(asked).toHaveLength(1);
      expect(asked[0]?.method).toBe("POST");
      expect(new URLSearchParams(asked[0]?.body)).toEqual(
        new URLSearchParams({ grant_type: "refresh_token", refresh_token: "r1", client_id: "client", client_secret: "secret" }),
      );
      vi.unstubAllEnvs();
    }),
  );

  it.effect("says not configured when the Oura app has no id or secret, without asking Oura", () =>
    Effect.gen(function* () {
      vi.stubEnv("OURA_CLIENT_ID", "");
      const asked: Asked[] = [];
      const wire = yield* asWire(Oura.use((oura) => oura.exchange({ grant_type: "refresh_token", refresh_token: "r1" }))).pipe(
        Effect.provide(answering([], asked)),
      );
      expect(wire).toStrictEqual({ ok: false, error: { kind: "not_configured" } });
      expect(asked).toStrictEqual([]);
      vi.unstubAllEnvs();
    }),
  );

  it.effect("follows next_token across pages with the bearer token, and keeps every document", () =>
    Effect.gen(function* () {
      const asked: Asked[] = [];
      const docs = yield* Oura.use((oura) => oura.collection("sleep", "2026-11-01" as never, "2026-11-20" as never)).pipe(
        Effect.provide(
          Layer.mergeAll(
            answering([{ body: { data: [{ id: 1 }], next_token: "page-2" } }, { body: { data: [{ id: 2 }], next_token: "" } }], asked),
            withToken,
          ),
        ),
      );
      expect(docs).toStrictEqual([{ id: 1 }, { id: 2 }]);
      expect(asked.map(({ authorization }) => authorization)).toStrictEqual(["Bearer test-token", "Bearer test-token"]);
      expect(asked[1]?.url).toContain("next_token=page-2");
    }),
  );

  it.effect("turns a refusal into the stored error, and a body without data into invalid_response", () =>
    Effect.gen(function* () {
      const collect = Oura.use((oura) => oura.collection("daily_sleep", "2026-11-01" as never, "2026-11-20" as never));
      const run = (reply: { status?: number; body: unknown; headers?: Record<string, string> }) =>
        asWire(collect).pipe(Effect.provide(Layer.mergeAll(answering([reply], []), withToken)));
      expect(yield* run({ status: 401, body: {} })).toStrictEqual({ ok: false, error: { kind: "unauthorised" } });
      expect(yield* run({ status: 403, body: {} })).toStrictEqual({ ok: false, error: { kind: "forbidden" } });
      expect(yield* run({ status: 429, body: {}, headers: { "retry-after": "30" } })).toStrictEqual({
        ok: false,
        error: { kind: "rate_limited", retryAfterSeconds: 30 },
      });
      expect(yield* run({ status: 429, body: {} })).toStrictEqual({ ok: false, error: { kind: "rate_limited" } });
      expect(yield* run({ status: 503, body: {} })).toStrictEqual({ ok: false, error: { kind: "unavailable", status: 503 } });
      expect(yield* run({ body: { items: [] } })).toStrictEqual({ ok: false, error: { kind: "invalid_response" } });
    }),
  );
});

describe("the Oura test Layer", () => {
  it.effect("answers from canned collections and tokens", () =>
    Effect.gen(function* () {
      const oura = yield* Oura;
      expect(yield* oura.collection("sleep", "2026-11-01" as never, "2026-11-02" as never)).toStrictEqual([{ id: "night" }]);
      expect(yield* oura.collection("daily_sleep", "2026-11-01" as never, "2026-11-02" as never)).toStrictEqual([]);
      expect((yield* oura.exchange({})).accessToken).toBe("test-access");
    }).pipe(Effect.provide(Oura.layerTest({ collections: { sleep: [{ id: "night" }] } })), Effect.provide(withToken)),
  );

  it.effect("can be told to refuse", () =>
    Effect.gen(function* () {
      const wire = yield* asWire(Oura.use((oura) => oura.exchange({}))).pipe(Effect.provide(Oura.layerTest({ failure: new OuraUnauthorised() })));
      expect(wire).toStrictEqual({ ok: false, error: { kind: "unauthorised" } });
    }),
  );
});
