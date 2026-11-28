import type { FunctionArgs } from "convex/server";
import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import { newBackend, registerWorker, unwrap } from "../backend.test-utils";
import fixture from "../../../../apps/desktop/src-tauri/fixtures/calendar-window.json";

type Snapshot = Omit<FunctionArgs<typeof api.calendar.sync.applyWindow>, "token">;

const snapshot = fixture as Snapshot;
const DAY = 86_400_000;
const SYDNEY = "Australia/Sydney";

const synced = async () => {
  const t = await newBackend();
  const token = await registerWorker(t, "mac", ["calendar"]);
  const report = await t.mutation(api.calendar.sync.applyWindow, { ...snapshot, token });
  return { t, token, report };
};

describe("calendar sync on the wire", () => {
  test("applyWindow answers with the report, and refuses a window that is backwards or too long", async () => {
    const { t, token, report } = await synced();
    expect(report).toStrictEqual({
      ok: true,
      value: {
        calendars: { inserted: 3, updated: 0, removed: 0 },
        commitments: { inserted: 8, updated: 0, unchanged: 0, removed: 0, skipped: 0 },
      },
    });
    const again = await t.mutation(api.calendar.sync.applyWindow, { ...snapshot, token });
    expect(again).toStrictEqual({
      ok: true,
      value: {
        calendars: { inserted: 0, updated: 0, removed: 0 },
        commitments: { inserted: 0, updated: 0, unchanged: 8, removed: 0, skipped: 0 },
      },
    });
    for (const window of [
      { start: snapshot.window.end, end: snapshot.window.start },
      { start: snapshot.window.start, end: snapshot.window.start + 200 * DAY },
      { start: Number.NaN, end: 1 },
    ]) {
      expect(await t.mutation(api.calendar.sync.applyWindow, { ...snapshot, window, commitments: [], token })).toStrictEqual({
        ok: false,
        error: { kind: "invalid_window" },
      });
    }
  });
});

describe("calendars on the wire", () => {
  test("list answers with the calendars sorted by source and title, and when they were synced", async () => {
    const t = await newBackend();
    expect(await t.query(api.calendar.calendars.list, {})).toStrictEqual({ calendars: [], syncedAt: null });
    const { t: filled } = await synced();
    const listed = await filled.query(api.calendar.calendars.list, {});
    expect(listed.syncedAt).toEqual(expect.any(Number));
    expect(listed.calendars).toStrictEqual([
      { _id: expect.any(String), calendarId: "CAL-WORK", title: "Work", colour: "#3399e6", source: "iCloud", kind: "calDAV", included: true },
      { _id: expect.any(String), calendarId: "CAL-HOME", title: "Home", colour: "#f2bf1a", source: "On My Mac", kind: "local", included: true },
      {
        _id: expect.any(String),
        calendarId: "CAL-HOLIDAYS",
        title: "Australian Holidays",
        colour: "#66cc4d",
        source: "Other",
        kind: "subscription",
        included: false,
      },
    ]);
  });

  test("setIncluded answers with the calendar and its Activity, and refuses a calendar that is gone", async () => {
    const { t } = await synced();
    const holidays = (await t.query(api.calendar.calendars.list, {})).calendars.find((calendar) => calendar.calendarId === "CAL-HOLIDAYS")!;
    expect(await t.mutation(api.calendar.calendars.setIncluded, { calendarId: holidays._id, included: true })).toStrictEqual({
      ok: true,
      value: { calendarId: holidays._id, activityId: expect.any(String) },
    });
    const gone = await t.run(async (ctx) => {
      await ctx.db.delete("calendars", holidays._id);
      return holidays._id;
    });
    expect(await t.mutation(api.calendar.calendars.setIncluded, { calendarId: gone, included: false })).toStrictEqual({
      ok: false,
      error: { kind: "not_found" },
    });
  });
});

describe("commitments on the wire", () => {
  test("range answers with each commitment and its calendar, and refuses a range that is empty, backwards or too long", async () => {
    const { t } = await synced();
    const offsite = snapshot.commitments.find((row) => row.eventKey === "EV-OFFSITE")!;
    const from = offsite.start + 12 * 3_600_000;
    const row = await t.run(async (ctx) => (await ctx.db.query("externalCommitments").collect()).find((each) => each.eventKey === "EV-OFFSITE")!);
    expect(await t.query(api.calendar.commitments.range, { from, to: from + 15 * DAY })).toStrictEqual({
      ok: true,
      value: [{ ...row, calendar: { title: "Work", colour: "#3399e6" } }],
    });
    for (const range of [
      { from, to: from },
      { from: from + DAY, to: from },
      { from, to: from + 101 * DAY },
      { from: Number.NaN, to: from },
    ]) {
      expect(await t.query(api.calendar.commitments.range, range)).toStrictEqual({ ok: false, error: { kind: "invalid_range" } });
    }
  });
});

describe("Capacity on the wire", () => {
  test("days answers with working hours and each day's minutes, and refuses a bad date, count or time zone", async () => {
    const t = await newBackend();
    expect(await t.query(api.calendar.capacity.days, { from: "2026-11-20", days: 2, timeZone: SYDNEY })).toStrictEqual({
      ok: true,
      value: {
        workingHours: { startMinute: 540, endMinute: 1050 },
        days: [
          { date: "2026-11-20", workingMinutes: 510, busyMinutes: 0, freeMinutes: 510 },
          { date: "2026-11-21", workingMinutes: 510, busyMinutes: 0, freeMinutes: 510 },
        ],
      },
    });
    const invalidRange = { ok: false, error: { kind: "invalid_range" } };
    expect(await t.query(api.calendar.capacity.days, { from: "someday", days: 1, timeZone: SYDNEY })).toStrictEqual(invalidRange);
    expect(await t.query(api.calendar.capacity.days, { from: "2026-11-20", days: 0, timeZone: SYDNEY })).toStrictEqual(invalidRange);
    expect(await t.query(api.calendar.capacity.days, { from: "2026-11-20", days: 63, timeZone: SYDNEY })).toStrictEqual(invalidRange);
    expect(await t.query(api.calendar.capacity.days, { from: "2026-11-20", days: 1.5, timeZone: SYDNEY })).toStrictEqual(invalidRange);
    expect(await t.query(api.calendar.capacity.days, { from: "2026-11-20", days: 1, timeZone: "Mars/Olympus" })).toStrictEqual({
      ok: false,
      error: { kind: "invalid_time_zone", timeZone: "Mars/Olympus" },
    });
    expect(await t.query(api.calendar.capacity.days, { from: "someday", days: 0, timeZone: "Mars/Olympus" })).toStrictEqual(invalidRange);
  });
});

describe("working hours on the wire", () => {
  test("get answers with the defaults, set answers with the hours and its Activity, and refuses hours that do not fit a day", async () => {
    const t = await newBackend();
    expect(await t.query(api.calendar.workingHours.get, {})).toStrictEqual({ startMinute: 540, endMinute: 1050 });
    expect(await t.mutation(api.calendar.workingHours.set, { startMinute: 480, endMinute: 960 })).toStrictEqual({
      ok: true,
      value: { startMinute: 480, endMinute: 960, activityId: expect.any(String) },
    });
    expect(await t.query(api.calendar.workingHours.get, {})).toStrictEqual({ startMinute: 480, endMinute: 960 });
    for (const hours of [
      { startMinute: 600, endMinute: 600 },
      { startMinute: 700, endMinute: 600 },
      { startMinute: -1, endMinute: 600 },
      { startMinute: 0, endMinute: 1441 },
      { startMinute: 0.5, endMinute: 600 },
    ]) {
      expect(await t.mutation(api.calendar.workingHours.set, hours)).toStrictEqual({ ok: false, error: { kind: "invalid_hours" } });
    }
    expect(unwrap(await t.mutation(api.calendar.workingHours.set, { startMinute: 0, endMinute: 1440 }))).toMatchObject({ endMinute: 1440 });
  });
});
