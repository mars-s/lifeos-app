import { Result } from "effect";
import { expect, test } from "vitest";
import { UnreadableEstimate } from "./errors";
import { MAX_ESTIMATE_MINUTES, parseEstimateText, shortEstimate } from "./estimate";
import { resultToWire } from "./result";

const minutes = (input: string) => Result.getOrNull(parseEstimateText(input));

test("a bare number is minutes, and hours can be written the ways people type them", () => {
  expect(
    ["45", "45m", "45 min", "1h", "2 hours", "1h30", "1h 30m", "1H30M", " 1:30 ", "1.5h", "0:10", "90"].map(minutes),
  ).toEqual([45, 45, 45, 60, 120, 90, 90, 90, 90, 90, 10, 90]);
});

test("an Estimate must be between one minute and 200 hours, and readable", () => {
  expect(["", "0", "0h", "soon", "1h90x", "1:75", "201h", "12001", "-5", "1h30h"].map(minutes)).toEqual(
    Array.from({ length: 10 }, () => null),
  );
  expect([minutes("24h"), minutes("200h")]).toEqual([1440, 12_000]);
  expect(resultToWire(parseEstimateText("soon"))).toStrictEqual({ ok: false, error: { kind: "unreadable_estimate", input: "soon" } });
});

test("a short Estimate reads as minutes, hours, or both", () => {
  expect([10, 45, 60, 90, 120, 1440].map(shortEstimate)).toEqual(["10m", "45m", "1h", "1h 30m", "2h", "24h"]);
});

test("an Estimate reads as minutes, and an unreadable one fails with UnreadableEstimate", () => {
  expect(["45", "1h30", " 1:30 ", "1.5h"].map(parseEstimateText)).toStrictEqual([45, 90, 90, 90].map((n) => Result.succeed(n)));
  expect(parseEstimateText("200h")).toStrictEqual(Result.succeed(MAX_ESTIMATE_MINUTES));
  expect(parseEstimateText("201h")).toStrictEqual(Result.fail(new UnreadableEstimate({ input: "201h" })));
  expect(parseEstimateText("soon")).toStrictEqual(Result.fail(new UnreadableEstimate({ input: "soon" })));
});
