import { expect, test } from "vitest";
import type { IsoDate } from "./date";
import {
  afterCompletionDate,
  describeSchedule,
  firstAfter,
  firstOnOrAfter,
  localDateIn,
  parseEnd,
  parseSchedule,
  parseTimeZone,
  withinEnd,
  type Schedule,
  uncreatedDates,
} from "./recurrence";

const day = (date: string) => date as IsoDate;

const occurrences = (schedule: Schedule, anchor: string, count: number) => {
  const dates: string[] = [];
  let next = firstOnOrAfter(schedule, day(anchor), day(anchor));
  while (next && dates.length < count) {
    dates.push(next);
    next = firstAfter(schedule, day(anchor), next);
  }
  return dates;
};

test("every day, every n days and every weekday land on the right dates", () => {
  expect(occurrences({ kind: "days", every: 1 }, "2026-11-19", 3)).toEqual(["2026-11-19", "2026-11-20", "2026-11-21"]);
  expect(occurrences({ kind: "days", every: 3 }, "2026-11-19", 3)).toEqual(["2026-11-19", "2026-11-22", "2026-11-25"]);
  expect(occurrences({ kind: "weekdays" }, "2026-11-20", 3)).toEqual(["2026-11-20", "2026-11-23", "2026-11-24"]);
});

test("every n weeks counts weeks from the anchor's week, and picks each chosen day", () => {
  expect(occurrences({ kind: "weeks", every: 1, days: [4] }, "2026-11-18", 3)).toEqual(["2026-11-19", "2026-11-26", "2026-12-03"]);
  expect(occurrences({ kind: "weeks", every: 2, days: [1, 4] }, "2026-11-18", 5)).toEqual([
    "2026-11-19",
    "2026-11-30",
    "2026-12-03",
    "2026-12-14",
    "2026-12-17",
  ]);
});

test("a month day past the end of the month falls on its last day, and leap years count", () => {
  expect(occurrences({ kind: "months", every: 1, on: { kind: "day", day: 31 } }, "2027-01-15", 4)).toEqual([
    "2027-01-31",
    "2027-02-28",
    "2027-03-31",
    "2027-04-30",
  ]);
  expect(firstOnOrAfter({ kind: "months", every: 1, on: { kind: "day", day: 30 } }, day("2028-02-01"), day("2028-02-01"))).toBe(
    "2028-02-29",
  );
  expect(occurrences({ kind: "months", every: 2, on: { kind: "day", day: 15 } }, "2026-11-19", 3)).toEqual([
    "2027-01-15",
    "2027-03-15",
    "2027-05-15",
  ]);
});

test("the first, fourth and last weekday of a month", () => {
  expect(occurrences({ kind: "months", every: 1, on: { kind: "weekday", nth: 1, weekday: 4 } }, "2026-11-19", 3)).toEqual([
    "2026-12-03",
    "2027-01-07",
    "2027-02-04",
  ]);
  expect(occurrences({ kind: "months", every: 1, on: { kind: "weekday", nth: -1, weekday: 5 } }, "2026-11-01", 3)).toEqual([
    "2026-11-27",
    "2026-12-25",
    "2027-01-29",
  ]);
  expect(firstOnOrAfter({ kind: "months", every: 1, on: { kind: "weekday", nth: -1, weekday: 1 } }, day("2026-11-01"), day("2026-11-01"))).toBe(
    "2026-11-30",
  );
  expect(firstOnOrAfter({ kind: "months", every: 1, on: { kind: "weekday", nth: 4, weekday: 1 } }, day("2026-11-01"), day("2026-11-01"))).toBe(
    "2026-11-23",
  );
});

test("a yearly 29 Feb falls on 28 Feb in common years, and 2100 is not a leap year", () => {
  expect(occurrences({ kind: "years", every: 1, month: 2, day: 29 }, "2026-03-01", 3)).toEqual(["2027-02-28", "2028-02-29", "2029-02-28"]);
  expect(occurrences({ kind: "years", every: 1, month: 2, day: 29 }, "2096-03-01", 2)).toEqual(["2097-02-28", "2098-02-28"]);
  expect(firstOnOrAfter({ kind: "years", every: 1, month: 2, day: 29 }, day("2099-03-01"), day("2099-03-01"))).toBe("2100-02-28");
  expect(occurrences({ kind: "years", every: 2, month: 6, day: 30 }, "2026-11-19", 2)).toEqual(["2028-06-30", "2030-06-30"]);
});

test("an after-completion schedule never falls on a calendar date, and counts from the completion day", () => {
  expect(firstOnOrAfter({ kind: "afterCompletion", every: 3, unit: "day" }, day("2026-11-19"), day("2026-11-19"))).toBeNull();
  expect(afterCompletionDate({ kind: "afterCompletion", every: 3, unit: "day" }, day("2026-11-30"))).toBe("2026-12-03");
  expect(afterCompletionDate({ kind: "afterCompletion", every: 2, unit: "week" }, day("2026-11-19"))).toBe("2026-12-03");
  expect(afterCompletionDate({ kind: "afterCompletion", every: 1, unit: "month" }, day("2027-01-31"))).toBe("2027-02-28");
  expect(afterCompletionDate({ kind: "afterCompletion", every: 13, unit: "month" }, day("2026-11-19"))).toBe("2027-12-19");
});

test("an end on a date or after a count stops occurrences past it", () => {
  expect(withinEnd({ kind: "never" }, day("2099-01-01"), 998)).toBe(true);
  expect(withinEnd({ kind: "on", date: "2026-12-01" }, day("2026-12-01"), 0)).toBe(true);
  expect(withinEnd({ kind: "on", date: "2026-12-01" }, day("2026-12-02"), 0)).toBe(false);
  expect(withinEnd({ kind: "after", count: 5 }, day("2026-12-02"), 4)).toBe(true);
  expect(withinEnd({ kind: "after", count: 5 }, day("2026-12-02"), 5)).toBe(false);
});

const instant = (iso: string) => Date.parse(iso);

test("the local date turns over at local midnight on both daylight-saving change days in Melbourne and Sydney", () => {
  for (const zone of ["Australia/Melbourne", "Australia/Sydney"]) {
    expect(
      [
        "2026-04-04T12:59:59Z",
        "2026-04-04T13:00:00Z",
        "2026-04-05T13:59:59Z",
        "2026-04-05T14:00:00Z",
        "2026-10-03T13:59:59Z",
        "2026-10-03T14:00:00Z",
        "2026-10-04T12:59:59Z",
        "2026-10-04T13:00:00Z",
      ].map((at) => localDateIn(zone, instant(at))),
    ).toEqual(["2026-04-04", "2026-04-05", "2026-04-05", "2026-04-06", "2026-10-03", "2026-10-04", "2026-10-04", "2026-10-05"]);
  }
});

const reason = (schedule: Schedule) =>
  parseSchedule(schedule).match(
    () => null,
    (error) => error.reason,
  );

test("schedules outside their bounds are refused with a reason, and chosen days are tidied", () => {
  expect(reason({ kind: "days", every: 0 })).toBe("every");
  expect(reason({ kind: "days", every: 1.5 })).toBe("every");
  expect(reason({ kind: "weeks", every: 53, days: [1] })).toBe("every");
  expect(reason({ kind: "months", every: 25, on: { kind: "day", day: 1 } })).toBe("every");
  expect(reason({ kind: "years", every: 11, month: 1, day: 1 })).toBe("every");
  expect(reason({ kind: "afterCompletion", every: 100, unit: "day" })).toBe("every");
  expect(reason({ kind: "weeks", every: 1, days: [] })).toBe("days");
  expect(reason({ kind: "months", every: 1, on: { kind: "day", day: 32 } })).toBe("day");
  expect(reason({ kind: "years", every: 1, month: 13, day: 1 })).toBe("month");
  expect(reason({ kind: "years", every: 1, month: 4, day: 31 })).toBe("day");
  expect(reason({ kind: "years", every: 1, month: 2, day: 29 })).toBeNull();
  expect(parseSchedule({ kind: "weeks", every: 1, days: [4, 1, 4] })._unsafeUnwrap()).toEqual({ kind: "weeks", every: 1, days: [1, 4] });
  expect(parseEnd({ kind: "after", count: 0 })._unsafeUnwrapErr().reason).toBe("count");
  expect(parseEnd({ kind: "after", count: 1000 })._unsafeUnwrapErr().reason).toBe("count");
  expect(parseEnd({ kind: "on", date: "2026-02-30" })._unsafeUnwrapErr().reason).toBe("end");
  expect(parseTimeZone("Mars/Olympus")._unsafeUnwrapErr().reason).toBe("time_zone");
  expect(parseTimeZone("Australia/Melbourne").isOk()).toBe(true);
});

test("a Recurrence Rule reads as plain Australian English", () => {
  const never = { kind: "never" } as const;
  expect(
    [
      describeSchedule({ kind: "days", every: 1 }, never),
      describeSchedule({ kind: "days", every: 3 }, never),
      describeSchedule({ kind: "weekdays" }, never),
      describeSchedule({ kind: "weeks", every: 1, days: [4] }, never),
      describeSchedule({ kind: "weeks", every: 2, days: [1, 4] }, never),
      describeSchedule({ kind: "months", every: 1, on: { kind: "day", day: 31 } }, never),
      describeSchedule({ kind: "months", every: 1, on: { kind: "day", day: 22 } }, never),
      describeSchedule({ kind: "months", every: 1, on: { kind: "day", day: 12 } }, never),
      describeSchedule({ kind: "months", every: 1, on: { kind: "weekday", nth: 1, weekday: 4 } }, never),
      describeSchedule({ kind: "months", every: 3, on: { kind: "weekday", nth: -1, weekday: 5 } }, never),
      describeSchedule({ kind: "years", every: 1, month: 2, day: 29 }, never),
      describeSchedule({ kind: "afterCompletion", every: 3, unit: "day" }, never),
      describeSchedule({ kind: "afterCompletion", every: 1, unit: "week" }, never),
      describeSchedule({ kind: "days", every: 1 }, { kind: "after", count: 5 }),
      describeSchedule({ kind: "days", every: 1 }, { kind: "after", count: 1 }),
      describeSchedule({ kind: "weekdays" }, { kind: "on", date: "2027-06-30" }),
    ],
  ).toEqual([
    "Every day",
    "Every 3 days",
    "Every weekday",
    "Every week on Thu",
    "Every 2 weeks on Mon, Thu",
    "Every month on the 31st",
    "Every month on the 22nd",
    "Every month on the 12th",
    "Every month on the first Thu",
    "Every 3 months on the last Fri",
    "Every year on 29 Feb",
    "3 days after completion",
    "1 week after completion",
    "Every day, 5 times",
    "Every day, once",
    "Every weekday, until 30 Jun",
  ]);
});

const dueRule = (schedule: Schedule, end: Parameters<typeof uncreatedDates>[0]["end"] = { kind: "never" }, count = 1) => ({
  schedule,
  anchor: "2026-11-19",
  end,
  count,
  next: { kind: "due", date: "2026-11-20" } as const,
});

test("the dates a rule has not created yet stop at the window, the end and the count, and after completion shows only the next", () => {
  const daily = { kind: "days", every: 1 } as const;
  expect(uncreatedDates(dueRule(daily), day("2026-11-21"), day("2026-11-23"))).toEqual(["2026-11-21", "2026-11-22", "2026-11-23"]);
  expect(uncreatedDates(dueRule(daily, { kind: "on", date: "2026-11-21" }), day("2026-11-19"), day("2026-11-30"))).toEqual(["2026-11-20", "2026-11-21"]);
  expect(uncreatedDates(dueRule(daily, { kind: "after", count: 3 }), day("2026-11-19"), day("2026-11-30"))).toEqual(["2026-11-20", "2026-11-21"]);
  expect(uncreatedDates(dueRule({ kind: "afterCompletion", every: 1, unit: "day" }), day("2026-11-19"), day("2026-11-30"))).toEqual(["2026-11-20"]);
  expect(uncreatedDates({ ...dueRule(daily), next: { kind: "waiting" } }, day("2026-11-19"), day("2026-11-30"))).toEqual([]);
});

test("a month day of 29, 30 or 31 falls on the last day of February, and on its own day again in March", () => {
  for (const monthDay of [29, 30, 31]) {
    const schedule = { kind: "months", every: 1, on: { kind: "day", day: monthDay } } as const;
    expect(occurrences(schedule, "2027-01-20", 3)).toEqual([`2027-01-${monthDay}`, "2027-02-28", `2027-03-${monthDay}`]);
    expect(occurrences(schedule, "2028-01-20", 3)).toEqual([`2028-01-${monthDay}`, "2028-02-29", `2028-03-${monthDay}`]);
  }
});

test("a weekly rule keeps its weekday through both daylight-saving Sundays", () => {
  const sundays: Schedule = { kind: "weeks", every: 1, days: [7] };
  expect(occurrences(sundays, "2026-03-23", 3)).toEqual(["2026-03-29", "2026-04-05", "2026-04-12"]);
  expect(occurrences(sundays, "2026-09-21", 3)).toEqual(["2026-09-27", "2026-10-04", "2026-10-11"]);
});

test("the local date follows the zone on both sides of the date line", () => {
  const noonUtc = instant("2026-11-19T12:00:00Z");
  expect(["Pacific/Kiritimati", "UTC", "Pacific/Pago_Pago"].map((zone) => localDateIn(zone, noonUtc))).toEqual([
    "2026-11-20",
    "2026-11-19",
    "2026-11-19",
  ]);
  expect(localDateIn("Pacific/Pago_Pago", instant("2026-11-19T10:59:59Z"))).toBe("2026-11-18");
});

test("an nth weekday month schedule is accepted as given", () => {
  const schedule = { kind: "months", every: 1, on: { kind: "weekday", nth: -1, weekday: 5 } } as const;
  expect(parseSchedule(schedule)._unsafeUnwrap()).toEqual(schedule);
});

test("month days read with the right ordinal suffix", () => {
  const never = { kind: "never" } as const;
  expect([1, 2, 3, 4, 11, 12, 13, 21, 23, 30].map((n) => describeSchedule({ kind: "months", every: 1, on: { kind: "day", day: n } }, never))).toEqual(
    ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "23rd", "30th"].map((suffix) => `Every month on the ${suffix}`),
  );
});
