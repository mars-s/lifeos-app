import { expect, expectTypeOf, test } from "vitest";
import { wireError, type SameWire } from "../../shared/result";
import { InvalidHealthRange, OuraForbidden, OuraRateLimited, OuraUnavailable, type OuraFailure } from "./errors";
import type { OuraError } from "./tables";

test("every Oura failure crosses the wire as the OuraError stored in the sync outcome", () => {
  expectTypeOf<SameWire<OuraFailure, OuraError>>().toEqualTypeOf<true>();
  expectTypeOf<SameWire<InvalidHealthRange, { kind: "invalid_range" }>>().toEqualTypeOf<true>();
});

test("a failure carries its wire kind and only the fields it was given", () => {
  expect(wireError(new OuraForbidden())).toStrictEqual({ kind: "forbidden" });
  expect(wireError(new OuraRateLimited({}))).toStrictEqual({ kind: "rate_limited" });
  expect(wireError(new OuraRateLimited({ retryAfterSeconds: 30 }))).toStrictEqual({ kind: "rate_limited", retryAfterSeconds: 30 });
  expect(wireError(new OuraUnavailable({}))).toStrictEqual({ kind: "unavailable" });
  expect(wireError(new OuraUnavailable({ status: 503 }))).toStrictEqual({ kind: "unavailable", status: 503 });
  expect(wireError(new InvalidHealthRange())).toStrictEqual({ kind: "invalid_range" });
});
