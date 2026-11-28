import { Context, Effect, Layer } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { USER_AGENT } from "../../shared/ai";
import type { TravelMode } from "../../shared/features";
import {
  GeocoderInvalidResponse,
  GeocoderUnavailable,
  GeocoderUnreachable,
  PlacesInvalidResponse,
  PlacesRateLimited,
  PlacesUnauthorised,
  PlacesUnavailable,
  type GeocodeFailure,
  type PlacesFailure,
} from "./errors";
import { geocodeUrl, nearestPlaces, OVERPASS_URL, overpassQuery, parseGeocode, routingUrl, withTravel, type Geocoded } from "./model";
import type { Place, Position } from "./tables";

const failureOf = (status: number) => {
  if (status === 401 || status === 403) return new PlacesUnauthorised();
  if (status === 429) return new PlacesRateLimited();
  return new PlacesUnavailable({ status });
};

export class Places extends Context.Service<
  Places,
  {
    geocode(address: string): Effect.Effect<Geocoded | null, GeocodeFailure>;
    nearest(query: string, from: Position): Effect.Effect<ReadonlyArray<Place>, PlacesFailure>;
    routed(mode: TravelMode, from: Position, places: ReadonlyArray<Place>): Effect.Effect<ReadonlyArray<Place>, PlacesFailure>;
  }
>()("lifeos/places/Places") {
  static readonly layerNoDeps = Layer.effect(
    Places,
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient;

      const provider = Effect.fn("Places.provider")(function* (request: HttpClientRequest.HttpClientRequest) {
        const response = yield* http.execute(request).pipe(Effect.mapError(() => new PlacesUnavailable({})));
        if (response.status < 200 || response.status >= 300) return yield* failureOf(response.status);
        return yield* response.json.pipe(Effect.mapError(() => new PlacesInvalidResponse()));
      });

      const geocode = Effect.fn("Places.geocode")(function* (address: string) {
        const request = HttpClientRequest.get(geocodeUrl(address)).pipe(
          HttpClientRequest.setHeaders({ "user-agent": USER_AGENT, "accept-language": "en-AU" }),
        );
        const response = yield* http.execute(request).pipe(Effect.mapError(() => new GeocoderUnreachable()));
        if (response.status < 200 || response.status >= 300) return yield* new GeocoderUnavailable({ status: response.status });
        const body = yield* response.json.pipe(Effect.mapError(() => new GeocoderInvalidResponse()));
        return yield* Effect.fromResult(parseGeocode(body));
      });

      const nearest = Effect.fn("Places.nearest")(function* (query: string, from: Position) {
        const request = HttpClientRequest.post(OVERPASS_URL).pipe(
          HttpClientRequest.setHeader("user-agent", USER_AGENT),
          HttpClientRequest.bodyUrlParams({ data: overpassQuery(query, from) }),
        );
        const body = yield* provider(request);
        return yield* Effect.fromResult(nearestPlaces(body, from));
      });

      const routed = Effect.fn("Places.routed")(function* (mode: TravelMode, from: Position, places: ReadonlyArray<Place>) {
        const request = HttpClientRequest.get(routingUrl(mode, from, places)).pipe(HttpClientRequest.setHeader("user-agent", USER_AGENT));
        const body = yield* provider(request);
        return yield* Effect.fromResult(withTravel(body, places));
      });

      return Places.of({ geocode, nearest, routed });
    }),
  );

  static readonly layer = Places.layerNoDeps.pipe(Layer.provide(FetchHttpClient.layer));

  static readonly layerTest = (canned: {
    geocoded?: Geocoded | null;
    nearest?: ReadonlyArray<Place>;
    travel?: ReadonlyArray<Place>;
    geocodeFailure?: GeocodeFailure;
    failure?: PlacesFailure;
  }) =>
    Layer.succeed(
      Places,
      Places.of({
        geocode: () => (canned.geocodeFailure ? Effect.fail(canned.geocodeFailure) : Effect.succeed(canned.geocoded ?? null)),
        nearest: () => (canned.failure ? Effect.fail(canned.failure) : Effect.succeed(canned.nearest ?? [])),
        routed: (_mode, _from, places) => (canned.failure ? Effect.fail(canned.failure) : Effect.succeed(canned.travel ?? places)),
      }),
    );
}
