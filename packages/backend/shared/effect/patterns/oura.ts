import { Clock, Context, Effect, Layer, Redacted, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

export class OuraUnauthorised extends Schema.TaggedError<OuraUnauthorised>()("OuraUnauthorised", {
  kind: Schema.tag("unauthorised"),
}) {}

export class OuraRateLimited extends Schema.TaggedError<OuraRateLimited>()("OuraRateLimited", {
  kind: Schema.tag("rate_limited"),
  retryAfterSeconds: Schema.optional(Schema.Number),
}) {}

export class OuraUnavailable extends Schema.TaggedError<OuraUnavailable>()("OuraUnavailable", {
  kind: Schema.tag("unavailable"),
  status: Schema.optional(Schema.Number),
}) {}

export class OuraInvalidResponse extends Schema.TaggedError<OuraInvalidResponse>()("OuraInvalidResponse", {
  kind: Schema.tag("invalid_response"),
}) {}

export type OuraError = OuraUnauthorised | OuraRateLimited | OuraUnavailable | OuraInvalidResponse;

export const SleepDay = Schema.Struct({
  day: Schema.String,
  score: Schema.NullOr(Schema.Number),
});

const SleepPage = Schema.Struct({ data: Schema.Array(SleepDay) });

const refusalFor = (status: number, retryAfter: string | undefined) => {
  if (status === 401) return new OuraUnauthorised();
  if (status === 429) return new OuraRateLimited(retryAfter ? { retryAfterSeconds: Number(retryAfter) } : {});
  return new OuraUnavailable({ status });
};

export class OuraToken extends Context.Service<OuraToken, Redacted.Redacted>()("lifeos/health/OuraToken") {}

export class Oura extends Context.Service<
  Oura,
  {
    sleepSince(day: string): Effect.Effect<ReadonlyArray<typeof SleepDay.Type>, OuraError>;
  }
>()("lifeos/health/Oura") {
  static readonly layerNoDeps = Layer.effect(
    Oura,
    Effect.gen(function* () {
      const token = yield* OuraToken;
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest((request) =>
          request.pipe(
            HttpClientRequest.prependUrl("https://api.ouraring.com/v2/usercollection"),
            HttpClientRequest.bearerToken(Redacted.value(token)),
            HttpClientRequest.acceptJson,
          ),
        ),
      );

      const sleepSince = Effect.fn("Oura.sleepSince")(function* (day: string) {
        const response = yield* client
          .get("/daily_sleep", { urlParams: { start_date: day } })
          .pipe(Effect.mapError(() => new OuraUnavailable({})));
        if (response.status !== 200) return yield* refusalFor(response.status, response.headers["retry-after"]);
        const page = yield* HttpClientResponse.schemaBodyJson(SleepPage)(response).pipe(
          Effect.mapError(() => new OuraInvalidResponse()),
        );
        return page.data;
      });

      return Oura.of({ sleepSince });
    }),
  );

  static readonly layer = Oura.layerNoDeps.pipe(Layer.provide(FetchHttpClient.layer));

  static readonly layerTest = (days: ReadonlyArray<typeof SleepDay.Type>) =>
    Layer.succeed(Oura, Oura.of({ sleepSince: (day) => Effect.succeed(days.filter((slept) => slept.day >= day)) }));
}

const DAY_MS = 86_400_000;

export const lastNights = Effect.fn("health.lastNights")(function* (nights: number) {
  const oura = yield* Oura;
  const now = yield* Clock.currentTimeMillis;
  const since = new Date(now - nights * DAY_MS).toISOString().slice(0, 10);
  const days = yield* oura.sleepSince(since);
  return days.flatMap((slept) => (slept.score === null ? [] : [{ day: slept.day, score: slept.score }]));
});
