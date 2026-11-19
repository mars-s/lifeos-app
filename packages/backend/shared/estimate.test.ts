import { expect, test } from "vitest";
import { parseEstimateText, shortEstimate } from "./estimate";

const minutes = (input: string) => parseEstimateText(input).unwrapOr(null);

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
  expect(parseEstimateText("soon")._unsafeUnwrapErr()).toEqual({ kind: "unreadable_estimate", input: "soon" });
});

test("a short Estimate reads as minutes, hours, or both", () => {
  expect([10, 45, 60, 90, 120, 1440].map(shortEstimate)).toEqual(["10m", "45m", "1h", "1h 30m", "2h", "24h"]);
});
