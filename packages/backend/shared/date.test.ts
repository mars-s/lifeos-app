import { expect, test } from "vitest";
import { Result } from "effect";
import { parseIsoDate } from "./date";
import { InvalidDate } from "./errors";

test("an ISO date that exists parses; anything else fails with InvalidDate", () => {
  expect(parseIsoDate("2028-02-29")).toStrictEqual(Result.succeed("2028-02-29"));
  for (const input of ["2026-02-29", "2026-13-01", "26-01-01", "soon", ""]) {
    expect(parseIsoDate(input)).toStrictEqual(Result.fail(new InvalidDate({ input })));
  }
});
