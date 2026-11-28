import { expect, expectTypeOf, test } from "vitest";
import { wireError, type SameWire } from "../../shared/effect/wire";
import { CalendarNotFound, InvalidCalendarRange, InvalidCalendarTimeZone, InvalidWindow, type CalendarFailure } from "./errors";
import type { CalendarError } from "./model";

test("every calendar failure crosses the wire as the CalendarError the apps already read", () => {
  expectTypeOf<SameWire<CalendarFailure, CalendarError>>().toEqualTypeOf<true>();
});

test("a failure carries its wire kind and fields, and nothing else", () => {
  expect(wireError(new InvalidWindow())).toStrictEqual({ kind: "invalid_window" });
  expect(wireError(new InvalidCalendarRange())).toStrictEqual({ kind: "invalid_range" });
  expect(wireError(new InvalidCalendarTimeZone({ timeZone: "Mars/Olympus" }))).toStrictEqual({ kind: "invalid_time_zone", timeZone: "Mars/Olympus" });
  expect(wireError(new CalendarNotFound())).toStrictEqual({ kind: "not_found" });
});
