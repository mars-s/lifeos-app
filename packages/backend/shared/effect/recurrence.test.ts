import { expect, test } from "vitest";
import { Result } from "effect";
import { InvalidSchedule } from "./errors";
import { parseEnd, parseSchedule, parseTimeZone } from "./recurrence";

const refused = (reason: InvalidSchedule["reason"]) => Result.fail(new InvalidSchedule({ reason }));

test("a schedule is checked and tidied, and each fault names its reason", () => {
  expect(parseSchedule({ kind: "weeks", every: 1, days: [4, 1, 4] })).toStrictEqual(Result.succeed({ kind: "weeks", every: 1, days: [1, 4] }));
  expect(parseSchedule({ kind: "days", every: 0 })).toStrictEqual(refused("every"));
  expect(parseSchedule({ kind: "weeks", every: 1, days: [] })).toStrictEqual(refused("days"));
  expect(parseSchedule({ kind: "months", every: 1, on: { kind: "day", day: 32 } })).toStrictEqual(refused("day"));
  expect(parseSchedule({ kind: "years", every: 1, month: 13, day: 1 })).toStrictEqual(refused("month"));
  expect(parseSchedule({ kind: "years", every: 1, month: 2, day: 30 })).toStrictEqual(refused("day"));
});

test("an end and a time zone are checked", () => {
  expect(parseEnd({ kind: "on", date: "2026-12-31" })).toStrictEqual(Result.succeed({ kind: "on", date: "2026-12-31" }));
  expect(parseEnd({ kind: "on", date: "2026-02-30" })).toStrictEqual(refused("end"));
  expect(parseEnd({ kind: "after", count: 1000 })).toStrictEqual(refused("count"));
  expect(parseTimeZone("Australia/Melbourne")).toStrictEqual(Result.succeed("Australia/Melbourne"));
  expect(parseTimeZone("Mars/Olympus")).toStrictEqual(refused("time_zone"));
});
