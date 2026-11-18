import type { FunctionArgs } from "convex/server";
import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import { newBackend, registerWorker, unwrap } from "../backend.test-utils";
import type { IsoDate } from "../../shared/date";
import { capacityOfDay, zonedMoment, type Blocking, type Interval } from "./model";
import fixture from "../../../../apps/desktop/src-tauri/fixtures/calendar-window.json";

const snapshot = fixture as Omit<FunctionArgs<typeof api.calendar.sync.applyWindow>, "token">;
const SYDNEY = "Australia/Sydney";
const HOUR = 3_600_000;
const nine = Date.UTC(2026, 10, 19, 22);
const day = { start: nine, end: nine + 8.5 * HOUR };

const event = (startHour: number, endHour: number, extra: Partial<Blocking> = {}) =>
  ({
    start: nine + startHour * HOUR,
    end: nine + endHour * HOUR,
    allDay: false,
    availability: "busy",
    ...extra,
  }) satisfies Interval & Blocking;

const allDay = (availability: Blocking["availability"]) => event(-9, 15, { allDay: true, availability });

describe("Capacity of one day", () => {
  test("an empty day is all free", () => {
    expect(capacityOfDay(day, [])).toEqual({ workingMinutes: 510, busyMinutes: 0, freeMinutes: 510 });
  });

  test("overlapping commitments count their shared time once", () => {
    expect(capacityOfDay(day, [event(1, 3), event(2, 4), event(2.5, 3)])).toMatchObject({ busyMinutes: 180, freeMinutes: 330 });
  });

  test("time before and after working hours is not counted", () => {
    expect(capacityOfDay(day, [event(-2, 0.5), event(8, 12), event(10, 11)])).toMatchObject({ busyMinutes: 60, freeMinutes: 450 });
  });

  test("free and declined events leave the time free, tentative and unavailable take it", () => {
    expect(
      capacityOfDay(day, [
        event(0, 1, { availability: "free" }),
        event(1, 2, { response: "declined" }),
        event(2, 3, { availability: "tentative" }),
        event(3, 4, { availability: "unavailable" }),
        event(4, 5, { availability: "unknown" }),
      ]),
    ).toMatchObject({ busyMinutes: 180 });
  });

  test("an all-day event takes the day only when it is marked busy", () => {
    expect(capacityOfDay(day, [allDay("free")])).toMatchObject({ freeMinutes: 510 });
    expect(capacityOfDay(day, [allDay("unknown")])).toMatchObject({ freeMinutes: 510 });
    expect(capacityOfDay(day, [allDay("busy")])).toMatchObject({ freeMinutes: 0 });
  });
});

describe("working hours in a time zone", () => {
  test("9:00 in Sydney is 22:00 UTC the day before in summer and 23:00 in winter", () => {
    expect(zonedMoment("2026-11-20" as IsoDate, 540, SYDNEY)).toBe(Date.UTC(2026, 10, 19, 22));
    expect(zonedMoment("2026-06-20" as IsoDate, 540, SYDNEY)).toBe(Date.UTC(2026, 5, 19, 23));
  });

  test("a day that crosses a daylight saving change keeps its wall-clock hours", () => {
    expect(zonedMoment("2026-10-04" as IsoDate, 17 * 60, SYDNEY) - zonedMoment("2026-10-04" as IsoDate, 9 * 60, SYDNEY)).toBe(8 * HOUR);
  });
});

const setup = async () => {
  const t = await newBackend();
  const token = await registerWorker(t, "mac", ["calendar"]);
  unwrap(await t.mutation(api.calendar.sync.applyWindow, { ...snapshot, token }));
  const capacity = async (from: string, days = 1) =>
    unwrap(await t.query(api.calendar.capacity.days, { from, days, timeZone: SYDNEY }));
  return { t, capacity };
};

test("Capacity for a synced day takes out busy commitments inside working hours only", async () => {
  const { capacity } = await setup();
  const { workingHours, days } = await capacity("2026-11-20", 5);
  expect(workingHours).toEqual({ startMinute: 540, endMinute: 1050 });
  expect(days).toEqual([
    { date: "2026-11-20", workingMinutes: 510, busyMinutes: 75, freeMinutes: 435 },
    { date: "2026-11-21", workingMinutes: 510, busyMinutes: 0, freeMinutes: 510 },
    { date: "2026-11-22", workingMinutes: 510, busyMinutes: 0, freeMinutes: 510 },
    { date: "2026-11-23", workingMinutes: 510, busyMinutes: 15, freeMinutes: 495 },
    { date: "2026-11-24", workingMinutes: 510, busyMinutes: 0, freeMinutes: 510 },
  ]);
});

test("excluding a calendar gives its time back, and undo takes it away again", async () => {
  const { t, capacity } = await setup();
  const home = (await t.query(api.calendar.calendars.list, {})).calendars.find((calendar) => calendar.title === "Home")!;
  const { activityId } = unwrap(await t.mutation(api.calendar.calendars.setIncluded, { calendarId: home._id, included: false }));
  expect((await capacity("2026-11-20")).days[0]).toMatchObject({ busyMinutes: 15 });
  unwrap(await t.mutation(api.platform.undo.undo, { activityId: activityId! }));
  expect((await capacity("2026-11-20")).days[0]).toMatchObject({ busyMinutes: 75 });
});

test("working hours change Capacity, can be undone, and must be a real span", async () => {
  const { t, capacity } = await setup();
  const { activityId } = unwrap(await t.mutation(api.calendar.workingHours.set, { startMinute: 10 * 60, endMinute: 22 * 60 }));
  expect((await capacity("2026-11-20")).days[0]).toEqual({
    date: "2026-11-20",
    workingMinutes: 720,
    busyMinutes: 120 + 60,
    freeMinutes: 540,
  });
  unwrap(await t.mutation(api.platform.undo.undo, { activityId: activityId! }));
  expect(await t.query(api.calendar.workingHours.get, {})).toEqual({ startMinute: 540, endMinute: 1050 });

  for (const hours of [
    { startMinute: 600, endMinute: 600 },
    { startMinute: -1, endMinute: 600 },
    { startMinute: 0, endMinute: 1441 },
    { startMinute: 0.5, endMinute: 60 },
  ]) {
    expect(await t.mutation(api.calendar.workingHours.set, hours)).toEqual({ ok: false, error: { kind: "invalid_hours" } });
  }
});

test("Capacity refuses a bad date, day count or time zone", async () => {
  const { t } = await setup();
  const ask = (args: { from: string; days: number; timeZone: string }) => t.query(api.calendar.capacity.days, args);
  expect(await ask({ from: "2026-02-30", days: 1, timeZone: SYDNEY })).toEqual({ ok: false, error: { kind: "invalid_range" } });
  expect(await ask({ from: "2026-11-20", days: 0, timeZone: SYDNEY })).toEqual({ ok: false, error: { kind: "invalid_range" } });
  expect(await ask({ from: "2026-11-20", days: 1, timeZone: "Mars/Olympus" })).toEqual({
    ok: false,
    error: { kind: "invalid_time_zone", timeZone: "Mars/Olympus" },
  });
});
