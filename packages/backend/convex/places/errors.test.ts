import { expect, expectTypeOf, test } from "vitest";
import { wireError, type SameWire } from "../../shared/effect/wire";
import {
  GeocoderUnavailable,
  NoTrip,
  PlacesRateLimited,
  PlacesRefused,
  PlacesUnavailable,
  type PlacesFailure,
  type SavePlaceFailure,
  type TripFailure,
} from "./errors";
import type { SavePlaceError } from "./saved";
import type { PlacesError } from "./tables";
import type { TripError } from "./trips";

test("every Places failure crosses the wire as the error the apps and the database already read", () => {
  expectTypeOf<SameWire<PlacesFailure, PlacesError>>().toEqualTypeOf<true>();
  expectTypeOf<SameWire<SavePlaceFailure, SavePlaceError>>().toEqualTypeOf<true>();
  expectTypeOf<SameWire<TripFailure, TripError>>().toEqualTypeOf<true>();
});

test("a failure carries its wire kind and only the fields it was given", () => {
  expect(wireError(new PlacesRateLimited())).toStrictEqual({ kind: "rate_limited" });
  expect(wireError(new PlacesRefused())).toStrictEqual({ kind: "refused" });
  expect(wireError(new PlacesUnavailable({}))).toStrictEqual({ kind: "unavailable" });
  expect(wireError(new PlacesUnavailable({ status: 503 }))).toStrictEqual({ kind: "unavailable", status: 503 });
  expect(wireError(new GeocoderUnavailable({ status: 500 }))).toStrictEqual({ kind: "unavailable", status: 500 });
  expect(wireError(new NoTrip())).toStrictEqual({ kind: "no_trip" });
});
