import { expect, expectTypeOf, test } from "vitest";
import { InvalidDate, InvalidSchedule, UnreadableEstimate } from "./errors";
import { wireError, type SameWire } from "./result";

type DateError = { readonly kind: "invalid_date"; readonly input: string };
type EstimateTextError = { readonly kind: "unreadable_estimate"; readonly input: string };
type ScheduleError = {
  readonly kind: "invalid_schedule";
  readonly reason: "every" | "days" | "day" | "month" | "end" | "count" | "time_zone";
};

test("the shared parse failures cross the wire as the plain errors the apps already read", () => {
  expectTypeOf<SameWire<InvalidDate, DateError>>().toEqualTypeOf<true>();
  expectTypeOf<SameWire<UnreadableEstimate, EstimateTextError>>().toEqualTypeOf<true>();
  expectTypeOf<SameWire<InvalidSchedule, ScheduleError>>().toEqualTypeOf<true>();
});

test("a shared parse failure carries its wire kind and fields, and nothing else", () => {
  expect(wireError(new InvalidDate({ input: "2026-02-30" }))).toStrictEqual({ kind: "invalid_date", input: "2026-02-30" });
  expect(wireError(new UnreadableEstimate({ input: "soon" }))).toStrictEqual({ kind: "unreadable_estimate", input: "soon" });
  expect(wireError(new InvalidSchedule({ reason: "time_zone" }))).toStrictEqual({ kind: "invalid_schedule", reason: "time_zone" });
});
