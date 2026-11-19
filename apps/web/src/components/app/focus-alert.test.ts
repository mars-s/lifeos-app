import { describe, expect, test } from "vitest";
import { tabTitle, timeUpAlert } from "./focus-alert";

const minute = 60_000;
const nine = Date.UTC(2026, 10, 19, 22, 0);
const pomodoro = { focusMinutes: 25, breakMinutes: 5, longBreakMinutes: 20 };
const focus = {
  kind: "focus",
  title: "Write chapter two",
  start: nine,
  pausedMs: 0,
  plannedMinutes: 25,
  state: { kind: "running" },
  pomodoro: { ...pomodoro, round: 1 },
} as const;

describe("timeUpAlert", () => {
  test("a running Pomodoro rings when its planned time is used up, after any pauses", () => {
    expect(timeUpAlert({ ...focus, pausedMs: 3 * minute })).toEqual({
      endsAt: nine + 28 * minute,
      title: "Focus Session complete",
      body: "Time for a break from Write chapter two.",
    });
  });

  test("the fourth Pomodoro offers the long break, and a break ends by sending Avi back", () => {
    expect(timeUpAlert({ ...focus, pomodoro: { ...pomodoro, round: 4 } })?.body).toBe("Time for a long break from Write chapter two.");
    expect(timeUpAlert({ ...focus, kind: "break", plannedMinutes: 5 })).toMatchObject({ endsAt: nine + 5 * minute, title: "Break over", body: "Back to Write chapter two." });
  });

  test("nothing rings for a paused session or a Stopwatch", () => {
    expect(timeUpAlert({ ...focus, state: { kind: "paused", at: nine + minute } })).toBeNull();
    expect(timeUpAlert({ ...focus, plannedMinutes: undefined, pomodoro: undefined })).toBeNull();
  });
});

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
