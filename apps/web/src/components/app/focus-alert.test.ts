import { describe, expect, test } from "vitest";
import { tabTitle } from "./focus-alert";

describe("tabTitle", () => {
  const view = { title: "Write chapter two", phase: "focus", status: "running", seconds: 24 * 60 + 13, ring: 1, timed: true } as const;

  test("shows the time left first, so it reads in a narrow tab", () => {
    expect(tabTitle(view)).toBe("24:13 · Write chapter two");
    expect(tabTitle({ ...view, status: "paused" })).toBe("24:13 paused · Write chapter two");
    expect(tabTitle({ ...view, phase: "break", seconds: 299, longBreak: true })).toBe("04:59 · Long break");
  });

  test("says when time is up", () => {
    expect(tabTitle({ ...view, status: "done", seconds: 1500 })).toBe("Time is up · Write chapter two");
    expect(tabTitle({ ...view, phase: "break", status: "done" })).toBe("Break over · Write chapter two");
  });
});
