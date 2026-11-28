import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Result } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { asWire } from "../../shared/result";
import { GeocoderUnreachable, PlacesRateLimited } from "./errors";
import { Places } from "./provider";
import type { Place } from "./tables";

const HOME = { lat: -33.877, lon: 151.203 };

const answering = (reply: () => Response, asked: string[] = []) =>
  Places.layerNoDeps.pipe(
    Layer.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) => {
          asked.push(`${request.method} ${request.url}`);
          return Effect.succeed(HttpClientResponse.fromWeb(request, reply()));
        }),
      ),
    ),
  );

const branch = (key: string, lat: number, lon: number) => ({ key, name: "Officeworks", position: { lat, lon }, straightMetres: 100 }) satisfies Place;

describe("the Places boundary on a canned HttpClient", () => {
  it.effect("geocodes an address to a position and a short name", () =>
    Effect.gen(function* () {
      const asked: string[] = [];
      const found = yield* Places.use((places) => places.geocode("12 Harbour Street")).pipe(
        Effect.provide(
          answering(
            () =>
              Response.json([{ lat: "-33.8765", lon: "151.2032", address: { house_number: "12", road: "Harbour Street", suburb: "Haymarket" } }]),
            asked,
          ),
        ),
      );
      expect(found).toStrictEqual({ position: { lat: -33.8765, lon: 151.2032 }, found: "12 Harbour Street, Haymarket" });
      expect(asked[0]).toContain("nominatim.openstreetmap.org/search");
    }),
  );

  it.effect("answers null for an address the geocoder does not know, and refuses a body that is not a list", () =>
    Effect.gen(function* () {
      const none = yield* Places.use((places) => places.geocode("Nowhere")).pipe(Effect.provide(answering(() => Response.json([]))));
      expect(none).toBeNull();
      const wire = yield* asWire(Places.use((places) => places.geocode("Nowhere"))).pipe(
        Effect.provide(answering(() => Response.json({ error: "Bad" }))),
      );
      expect(wire).toStrictEqual({ ok: false, error: { kind: "invalid_response" } });
      const down = yield* asWire(Places.use((places) => places.geocode("Nowhere"))).pipe(
        Effect.provide(answering(() => new Response("{}", { status: 500 }))),
      );
      expect(down).toStrictEqual({ ok: false, error: { kind: "unavailable", status: 500 } });
    }),
  );

  it.effect("searches Overpass and keeps the nearest named places, and turns a refusal into the stored error", () =>
    Effect.gen(function* () {
      const asked: string[] = [];
      const found = yield* Places.use((places) => places.nearest("officeworks", HOME)).pipe(
        Effect.provide(
          answering(
            () =>
              Response.json({
                elements: [
                  { type: "node", id: 1, lat: -33.9, lon: 151.15, tags: { name: "Officeworks", "addr:suburb": "Lewisham" } },
                  { type: "node", id: 2, lat: -33.88, lon: 151.2, tags: {} },
                ],
              }),
            asked,
          ),
        ),
      );
      expect(found.map(({ key, name, suburb }) => ({ key, name, suburb }))).toStrictEqual([{ key: "node/1", name: "Officeworks", suburb: "Lewisham" }]);
      expect(asked[0]).toBe("POST https://overpass-api.de/api/interpreter");
      const limited = yield* asWire(Places.use((places) => places.nearest("officeworks", HOME))).pipe(
        Effect.provide(answering(() => new Response("{}", { status: 429 }))),
      );
      expect(limited).toStrictEqual({ ok: false, error: { kind: "rate_limited" } });
    }),
  );

  it.effect("adds travel times from the routing table, and refuses a table without durations", () =>
    Effect.gen(function* () {
      const places = [branch("node/1", -33.9, 151.15), branch("node/2", -33.88, 151.205)];
      const timed = yield* Places.use((provider) => provider.routed("walk", HOME, places)).pipe(
        Effect.provide(answering(() => Response.json({ code: "Ok", durations: [[0, 900, 300]], distances: [[0, 1200, 400]] }))),
      );
      expect(timed.map(({ key, travel }) => [key, travel])).toStrictEqual([
        ["node/2", { seconds: 300, metres: 400 }],
        ["node/1", { seconds: 900, metres: 1200 }],
      ]);
      const wire = yield* asWire(Places.use((provider) => provider.routed("walk", HOME, places))).pipe(
        Effect.provide(answering(() => Response.json({ code: "Ok", durations: [] }))),
      );
      expect(wire).toStrictEqual({ ok: false, error: { kind: "invalid_response" } });
    }),
  );
});

describe("the Places test Layer", () => {
  it.effect("answers from canned places, and can be told to refuse", () =>
    Effect.gen(function* () {
      const places = yield* Places;
      expect(yield* places.geocode("anywhere")).toStrictEqual({ position: HOME, found: "Home" });
      expect(yield* places.nearest("officeworks", HOME)).toStrictEqual([branch("node/1", -33.9, 151.15)]);
      expect(yield* places.routed("drive", HOME, [branch("node/9", 0, 0)])).toStrictEqual([branch("node/9", 0, 0)]);
    }).pipe(Effect.provide(Places.layerTest({ geocoded: { position: HOME, found: "Home" }, nearest: [branch("node/1", -33.9, 151.15)] }))),
  );

  it.effect("fails the way the live Layer fails", () =>
    Effect.gen(function* () {
      const nearest = yield* Effect.result(Places.use((places) => places.nearest("officeworks", HOME)));
      const geocode = yield* Effect.result(Places.use((places) => places.geocode("anywhere")));
      expect(Result.isFailure(nearest) && nearest.failure).toBeInstanceOf(PlacesRateLimited);
      expect(Result.isFailure(geocode) && geocode.failure).toBeInstanceOf(GeocoderUnreachable);
    }).pipe(Effect.provide(Places.layerTest({ failure: new PlacesRateLimited(), geocodeFailure: new GeocoderUnreachable() }))),
  );
});
