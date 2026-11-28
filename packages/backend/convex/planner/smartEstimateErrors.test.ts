import { expect, expectTypeOf, test } from "vitest";
import { wireError, type SameWire } from "../../shared/result";
import { EstimateInvalidResponse, EstimateRefused, type DecisionFailure } from "./smartEstimateErrors";
import type { SmartEstimateError } from "./tables";

test("a decision failure crosses the wire as the SmartEstimateError kinds the outcome stores", () => {
  expectTypeOf<SameWire<DecisionFailure, Extract<SmartEstimateError, { kind: "invalid_response" | "refused" }>>>().toEqualTypeOf<true>();
});

test("a decision failure carries its kind and nothing else", () => {
  expect(wireError(new EstimateInvalidResponse())).toStrictEqual({ kind: "invalid_response" });
  expect(wireError(new EstimateRefused())).toStrictEqual({ kind: "refused" });
});
