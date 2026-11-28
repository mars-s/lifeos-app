import { expect, expectTypeOf, test } from "vitest";
import type { DateError } from "../date";
import type { EstimateTextError } from "../estimate";
import type { ScheduleError } from "../recurrence";
import { InvalidDate, InvalidSchedule, UnreadableEstimate } from "./errors";
import { wireError, type SameWire } from "./wire";

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
