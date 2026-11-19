import { describe, expect, test } from "vitest";
import { spreadDay, type Span } from "./spread";

const hm = (hours: number, minutes = 0) => hours * 60 + minutes;
const clock = (minute: number) => `${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, "0")}`;
const workingDay: Span = { start: hm(9), end: hm(17, 30) };

const tasks = (...estimates: (number | undefined)[]) =>
  estimates.map((estimateMinutes, index) => ({ _id: `t${index + 1}`, estimateMinutes }));

const spread = (
  list: { _id: string; estimateMinutes?: number | undefined }[],
  { busy = [] as Span[], window = workingDay, boxed = new Set<string>(), guesses = new Map<string, number>() } = {},
) => {
  const { placed, unfit } = spreadDay({ tasks: list, boxed, guessOf: (id) => guesses.get(id), busy, window });
  return { placed: placed.map((block) => `${block.taskId} ${clock(block.start)}+${block.minutes}`), unfit: unfit.map((task) => task._id) };
};

describe("Spread across the day", () => {
  test("places Tasks in Day Plan order from the start of Working Hours, ten minutes apart", () => {
    expect(spread(tasks(60, 30, 45))).toEqual({ placed: ["t1 9:00+60", "t2 10:10+30", "t3 10:50+45"], unfit: [] });
  });

  test("leaves a buffer around an External Commitment and fills the gap before it when a Task fits", () => {
    const standup = { start: hm(10), end: hm(11) };
    expect(spread(tasks(45, 90, 15), { busy: [standup] })).toEqual({
      placed: ["t1 9:00+45", "t2 11:10+90", "t3 12:50+15"],
      unfit: [],
    });
  });

  test("never overlaps existing Work Blocks and skips Tasks that already have one that day", () => {
    const existing = { start: hm(9), end: hm(10, 30) };
    expect(spread(tasks(30, 60, 30), { busy: [existing], boxed: new Set(["t2"]) })).toEqual({
      placed: ["t1 10:40+30", "t3 11:20+30"],
      unfit: [],
    });
  });

  test("stays out of the Sleep Window when Working Hours reach into it", () => {
    const lateDay = { start: hm(20), end: hm(23, 59) };
    const sleep = { start: hm(22, 30), end: hm(24) };
    expect(spread(tasks(60, 60, 60), { window: lateDay, busy: [sleep] })).toEqual({
      placed: ["t1 20:00+60", "t2 21:10+60"],
      unfit: ["t3"],
    });
  });

  test("reports Tasks that do not fit and keeps placing smaller ones after them", () => {
    const morning = { start: hm(9), end: hm(12) };
    expect(spread(tasks(120, 90, 30), { window: morning })).toEqual({ placed: ["t1 9:00+120", "t3 11:10+30"], unfit: ["t2"] });
  });

  test("sizes a Task by its Estimate, then its Smart Estimate, then half an hour, on the 15 minute grid", () => {
    const list = [{ _id: "est", estimateMinutes: 50 }, { _id: "guess" }, { _id: "none" }];
    expect(spread(list, { guesses: new Map([["guess", 20]]) })).toEqual({
      placed: ["est 9:00+45", "guess 9:55+15", "none 10:20+30"],
      unfit: [],
    });
  });

  test("starts on the five minute grid when the window opens mid-hour, as it does later today", () => {
    expect(spread(tasks(30), { window: { start: hm(13, 7), end: hm(17, 30) } })).toEqual({ placed: ["t1 13:10+30"], unfit: [] });
  });
});
