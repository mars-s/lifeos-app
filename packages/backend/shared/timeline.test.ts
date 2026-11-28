import { describe, expect, test } from "vitest";
import type { Span } from "./spread";
import { inkLoad, predictDay, type EnergyWindows } from "./timeline";

const hm = (hours: number, minutes = 0) => hours * 60 + minutes;
const clock = (minute: number) => `${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, "0")}`;
const workingDay: Span = { start: hm(9), end: hm(17, 30) };
const energy: EnergyWindows = { peak: { start: hm(10), end: hm(12) }, dip: { start: hm(14), end: hm(15, 30) }, low: false };

type Task = { _id: string; estimateMinutes?: number; labels?: { name: string }[] };

const predict = (
  tasks: Task[],
  { busy = [] as Span[], window = workingDay, windows = null as EnergyWindows | null, trips = new Map<string, number>(), guesses = new Map<string, number>() } = {},
) => {
  const { placed, unfit } = predictDay({
    tasks,
    boxed: new Set(),
    guessOf: (id) => guesses.get(id),
    travelOf: (id) => trips.get(id) ?? 0,
    busy,
    window,
    cap: 480,
    energy: windows,
  });
  return {
    placed: placed.map((block) => `${block.taskId} ${clock(block.start)}+${block.minutes}${block.fit ? ` ${block.fit}` : ""}${block.guess ? " ~" : ""}`),
    unfit: unfit.map((task) => task._id),
  };
};

describe("Predicting a day", () => {
  test("without an Energy Curve it places Tasks in Day Plan order, like a Spread", () => {
    expect(predict([{ _id: "a", estimateMinutes: 60 }, { _id: "b", estimateMinutes: 30 }])).toEqual({ placed: ["a 9:00+60", "b 10:10+30"], unfit: [] });
  });

  test("focus work goes to the peak and light work to the dip, and each says so", () => {
    const tasks = [
      { _id: "email", estimateMinutes: 15 },
      { _id: "chapter", estimateMinutes: 90 },
      { _id: "review", estimateMinutes: 45 },
      { _id: "invoices", estimateMinutes: 30, labels: [{ name: "Admin" }] },
    ];
    expect(predict(tasks, { windows: energy })).toEqual({
      placed: ["review 9:00+45", "chapter 10:00+90 peak", "email 14:00+15 dip", "invoices 14:25+30 dip"],
      unfit: [],
    });
  });

  test("a Deep Work Label counts as focus even when the Task is short", () => {
    expect(predict([{ _id: "think", estimateMinutes: 30, labels: [{ name: "deep work" }] }], { windows: energy }).placed).toEqual(["think 10:00+30 peak"]);
  });

  test("when the peak is taken, focus work falls back to the first free gap", () => {
    expect(predict([{ _id: "chapter", estimateMinutes: 90 }], { windows: energy, busy: [{ start: hm(11), end: hm(17) }] }).placed).toEqual(["chapter 9:00+90"]);
  });

  test("a Trip reserves the drive there and back around the Task", () => {
    expect(predict([{ _id: "parcel", estimateMinutes: 30 }, { _id: "next", estimateMinutes: 30 }], { trips: new Map([["parcel", 15]]) }).placed).toEqual([
      "parcel 9:15+30",
      "next 10:10+30",
    ]);
  });

  test("a low energy day leaves more Buffer between blocks", () => {
    const low = { ...energy, low: true, peak: { start: hm(9), end: hm(9) }, dip: { start: hm(9), end: hm(9) } };
    expect(predict([{ _id: "a", estimateMinutes: 45 }, { _id: "b", estimateMinutes: 45 }], { windows: low }).placed).toEqual(["a 9:00+45", "b 10:00+45"]);
  });

  test("a Smart Estimate is used and marked as a guess, and what does not fit stays unplaced", () => {
    expect(predict([{ _id: "a" }, { _id: "b", estimateMinutes: 120 }], { guesses: new Map([["a", 45]]), window: { start: hm(16), end: hm(17, 30) } })).toEqual({
      placed: ["a 16:00+45 ~"],
      unfit: ["b"],
    });
  });

  test("the day's load is counted in three inks", () => {
    expect(inkLoad([{ minutes: 30, done: true }, { minutes: 45, done: false }], [{ minutes: 60 }])).toEqual({ done: 30, kept: 45, predicted: 60 });
  });
});
