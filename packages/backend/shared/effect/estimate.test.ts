import { expect, test } from "vitest";
import { Result } from "effect";
import { UnreadableEstimate } from "./errors";
import { MAX_ESTIMATE_MINUTES, parseEstimateText } from "./estimate";

test("an Estimate reads as minutes, and an unreadable one fails with UnreadableEstimate", () => {
  expect(["45", "1h30", " 1:30 ", "1.5h"].map(parseEstimateText)).toStrictEqual([45, 90, 90, 90].map((n) => Result.succeed(n)));
  expect(parseEstimateText("200h")).toStrictEqual(Result.succeed(MAX_ESTIMATE_MINUTES));
  expect(parseEstimateText("201h")).toStrictEqual(Result.fail(new UnreadableEstimate({ input: "201h" })));
  expect(parseEstimateText("soon")).toStrictEqual(Result.fail(new UnreadableEstimate({ input: "soon" })));
});
