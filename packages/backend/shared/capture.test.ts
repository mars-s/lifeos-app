import { expect, test } from "vitest";
import { parseCapture, parseDatePhrase, parseEstimateToken, parseWhenPhrase, slugOf } from "./capture";
import type { IsoDate } from "./date";

const THURSDAY = "2026-11-19" as IsoDate;

const capture = (input: string, literal?: readonly string[]) => {
  const { tokens: _tokens, ...fields } = parseCapture(input, THURSDAY, literal ? { literal: new Set(literal) } : {});
  return fields;
};

test("a plain line is only a title", () => {
  expect(capture("Call the dentist")).toEqual({ title: "Call the dentist", labels: [] });
  expect(capture("  ")).toEqual({ title: "", labels: [] });
});

test("each shortcut leaves the title and lands in its own field", () => {
  expect(capture("Write essay tomorrow 1h30 #deep-work !fri @uni")).toEqual({
    title: "Write essay",
    when: { kind: "scheduled", date: "2026-11-20", evening: false },
    deadline: "2026-11-20",
    estimateMinutes: 90,
    labels: ["deep-work"],
    list: "uni",
  });
});

test("When reads days, weekdays, spans and dates", () => {
  const dates = ["today", "tomorrow", "tmr", "fri", "thursday", "next week", "next fri", "in 3 days", "in 2 weeks", "12 dec", "Jan 3", "weekend"];
  expect(dates.map((phrase) => parseDatePhrase(phrase, THURSDAY))).toEqual([
    "2026-11-19",
    "2026-11-20",
    "2026-11-20",
    "2026-11-20",
    "2026-11-26",
    "2026-11-23",
    "2026-11-27",
    "2026-11-22",
    "2026-12-03",
    "2026-12-12",
    "2027-01-03",
    "2026-11-21",
  ]);
  expect(parseWhenPhrase("tonight", THURSDAY)).toEqual({ kind: "scheduled", date: THURSDAY, evening: true });
  expect(parseWhenPhrase("Someday", THURSDAY)).toEqual({ kind: "someday" });
  expect(["soon", "31 feb", "next", "fr", "12"].map((phrase) => parseDatePhrase(phrase, THURSDAY))).toEqual([
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ]);
});

test("a phrase of several words is one shortcut", () => {
  expect(capture("Plan trip next week !12 dec")).toEqual({
    title: "Plan trip",
    when: { kind: "scheduled", date: "2026-11-23", evening: false },
    deadline: "2026-12-12",
    labels: [],
  });
});

test("an Estimate needs a unit, so a bare number stays in the title", () => {
  expect(["30m", "1h", "1h30", "1h30m", "1.5h", "90min", "30", "0m", "201h", "h"].map(parseEstimateToken)).toEqual([
    30, 60, 90, 90, 90, 90, undefined, undefined, undefined, undefined,
  ]);
  expect(capture("Buy 30 eggs")).toEqual({ title: "Buy 30 eggs", labels: [] });
});

test("the first When wins, Labels add up, and a Deadline is separate from When", () => {
  expect(capture("Ring mum fri tomorrow #home #Admin #home")).toEqual({
    title: "Ring mum tomorrow #home",
    when: { kind: "scheduled", date: "2026-11-20", evening: false },
    labels: ["home", "admin"],
  });
  expect(capture("Tax return !fri")).toEqual({ title: "Tax return", deadline: "2026-11-20", labels: [] });
});

test("a shortcut marked literal stays in the title", () => {
  expect(capture("Read Friday Night Lights", ["friday"])).toEqual({ title: "Read Friday Night Lights", labels: [] });
  expect(capture("Email @sam tomorrow", ["@sam"])).toEqual({
    title: "Email @sam",
    when: { kind: "scheduled", date: "2026-11-20", evening: false },
    labels: [],
  });
});

test("tokens say where each shortcut sits in the text", () => {
  expect(parseCapture("Essay next week 30m", THURSDAY).tokens).toEqual([
    { field: "when", start: 6, end: 15, text: "next week" },
    { field: "estimate", start: 16, end: 19, text: "30m" },
  ]);
});

test("a slug ignores case, spaces and punctuation", () => {
  expect(["Deep Work", "deep-work", " Uni / Sem 2 "].map(slugOf)).toEqual(["deep-work", "deep-work", "uni-sem-2"]);
});
