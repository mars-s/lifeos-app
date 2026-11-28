import { expect, expectTypeOf, test } from "vitest";
import { wireError, type SameWire } from "../../shared/effect/wire";
import { FeatureOff, InvalidBlock, NameTaken, NotFound, type PlannerFailure } from "./errors";
import type { PlannerError } from "./model";

test("every planner failure crosses the wire as the PlannerError the apps already read", () => {
  expectTypeOf<SameWire<PlannerFailure, PlannerError>>().toEqualTypeOf<true>();
});

test("a failure carries its wire kind and fields, and nothing else", () => {
  expect(wireError(new NotFound({ table: "tasks", id: "t1" }))).toStrictEqual({ kind: "not_found", table: "tasks", id: "t1" });
  expect(wireError(new InvalidBlock({ reason: "overlap" }))).toStrictEqual({ kind: "invalid_block", reason: "overlap" });
  expect(wireError(new NameTaken({ taken: "Deep Work" }))).toStrictEqual({ kind: "name_taken", name: "Deep Work" });
  expect(wireError(new FeatureOff({ feature: "templates" }))).toStrictEqual({ kind: "feature_off", feature: "templates" });
});
