import type { FunctionArgs } from "convex/server";
import { expect, test } from "vitest";
import { api } from "../_generated/api";
import {
  newBackend,
  newSignedOutBackend,
  ownerGithubId,
  registerWorker,
  signInWithGithub,
  strangerSession,
  unwrap,
  type Backend,
} from "../backend.test-utils";
import fixture from "../../../../apps/desktop/src-tauri/fixtures/calendar-window.json";

type Snapshot = Omit<FunctionArgs<typeof api.calendar.sync.applyWindow>, "token">;

const snapshot = fixture as Snapshot;
const DAY = 86_400_000;

const setup = async () => {
  const t = await newBackend();
  const token = await registerWorker(t, "mac", ["calendar"]);
  const apply = async (window: Snapshot) => unwrap(await t.mutation(api.calendar.sync.applyWindow, { ...window, token }));
  const everything = () => t.run((ctx) => ctx.db.query("externalCommitments").collect());
  return { t, token, apply, everything };
};

const includeAll = async (t: Backend) => {
  const { calendars } = await t.query(api.calendar.calendars.list, {});
  for (const calendar of calendars) {
    unwrap(await t.mutation(api.calendar.calendars.setIncluded, { calendarId: calendar._id, included: true }));
  }
};

test("the same window twice inserts once and then changes nothing", async () => {
  const { apply, everything } = await setup();
  const first = await apply(snapshot);
  expect(first.commitments).toEqual({ inserted: 8, updated: 0, unchanged: 0, removed: 0, skipped: 0 });
  expect(first.calendars).toEqual({ inserted: 3, updated: 0, removed: 0 });
  const before = await everything();

  const second = await apply(snapshot);
  expect(second.commitments).toEqual({ inserted: 0, updated: 0, unchanged: 8, removed: 0, skipped: 0 });
  expect(second.calendars).toEqual({ inserted: 0, updated: 0, removed: 0 });
  expect(await everything()).toEqual(before);
});

test("each recurring occurrence is its own commitment, and a moved event keeps its row", async () => {
  const { apply, everything } = await setup();
  await apply(snapshot);
  const standups = (await everything()).filter((row) => row.title === "Standup");
  expect(standups).toHaveLength(2);
  expect(new Set(standups.map((row) => row.eventKey)).size).toBe(2);

  const dentist = (await everything()).find((row) => row.eventKey === "EV-DENTIST")!;
  const moved = snapshot.commitments.map((row) =>
    row.eventKey === "EV-DENTIST" ? { ...row, start: row.start + 3_600_000, end: row.end + 3_600_000, title: "Dentist (moved)" } : row,
  );
  const report = await apply({ ...snapshot, commitments: moved });
  expect(report.commitments).toMatchObject({ inserted: 0, updated: 1, unchanged: 7, removed: 0 });
  const after = (await everything()).find((row) => row.eventKey === "EV-DENTIST")!;
  expect(after._id).toBe(dentist._id);
  expect(after).toMatchObject({ title: "Dentist (moved)", start: dentist.start + 3_600_000, location: "Surry Hills" });
});

test("an event that disappears is removed inside the window, and rows outside the window are left alone", async () => {
  const { t, apply, everything } = await setup();
  await apply(snapshot);
  const outside = await t.run((ctx) =>
    ctx.db.insert("externalCommitments", {
      calendarId: "CAL-WORK",
      eventKey: "EV-LAST-MONTH",
      title: "Old planning session",
      start: snapshot.window.start - 20 * DAY,
      end: snapshot.window.start - 20 * DAY + 3_600_000,
      allDay: false,
      availability: "busy",
      recurring: false,
    }),
  );

  const report = await apply({ ...snapshot, commitments: snapshot.commitments.filter((row) => row.eventKey !== "EV-LUNCH") });
  expect(report.commitments).toMatchObject({ removed: 1, unchanged: 7 });
  const keys = (await everything()).map((row) => row.eventKey);
  expect(keys).not.toContain("EV-LUNCH");
  expect(keys).toContain("EV-LAST-MONTH");
  expect(await t.run((ctx) => ctx.db.get("externalCommitments", outside))).not.toBeNull();
});

test("calendars mirror the Mac: new ones default by kind, changes update, missing ones go", async () => {
  const { t, apply } = await setup();
  await apply(snapshot);
  const listed = await t.query(api.calendar.calendars.list, {});
  expect(listed.syncedAt).toEqual(expect.any(Number));
  expect(listed.calendars.map(({ title, colour, included }) => ({ title, colour, included }))).toEqual([
    { title: "Work", colour: "#3399e6", included: true },
    { title: "Home", colour: "#f2bf1a", included: true },
    { title: "Australian Holidays", colour: "#66cc4d", included: false },
  ]);

  const renamed = snapshot.calendars.flatMap((calendar) =>
    calendar.calendarId === "CAL-HOLIDAYS" ? [] : [calendar.calendarId === "CAL-HOME" ? { ...calendar, title: "Family" } : calendar],
  );
  const report = await apply({
    ...snapshot,
    calendars: renamed,
    commitments: snapshot.commitments.filter((row) => row.calendarId !== "CAL-HOLIDAYS"),
  });
  expect(report.calendars).toEqual({ inserted: 0, updated: 1, removed: 1 });
  expect((await t.query(api.calendar.calendars.list, {})).calendars.map(({ title }) => title)).toEqual(["Work", "Family"]);
});

test("a commitment for a calendar the Mac did not list is skipped", async () => {
  const { apply } = await setup();
  const stray = { ...snapshot.commitments[0]!, calendarId: "CAL-UNKNOWN", eventKey: "EV-STRAY" };
  const report = await apply({ ...snapshot, commitments: [...snapshot.commitments, stray] });
  expect(report.commitments).toMatchObject({ inserted: 8, skipped: 1 });
});

test("a window that ends before it starts or spans too long changes nothing", async () => {
  const { apply, t, token, everything } = await setup();
  await apply(snapshot);
  for (const window of [
    { start: snapshot.window.end, end: snapshot.window.start },
    { start: snapshot.window.start, end: snapshot.window.start + 200 * DAY },
  ]) {
    expect(await t.mutation(api.calendar.sync.applyWindow, { ...snapshot, window, commitments: [], token })).toEqual({
      ok: false,
      error: { kind: "invalid_window" },
    });
  }
  expect(await everything()).toHaveLength(8);
});

test("only a Worker with the calendar capability can send a window", async () => {
  const t = await newBackend();
  const thingsOnly = await registerWorker(t, "things", ["things"]);
  await expect(t.mutation(api.calendar.sync.applyWindow, { ...snapshot, token: thingsOnly })).rejects.toThrow(
    "This Worker cannot do calendar work.",
  );
  await expect(t.mutation(api.calendar.sync.applyWindow, { ...snapshot, token: "not-a-token" })).rejects.toThrow(
    "This Worker token is not valid.",
  );
});

test("commitments for a range come with their calendar, skip excluded calendars, and include events already under way", async () => {
  const { t, apply } = await setup();
  await apply(snapshot);
  const offsite = snapshot.commitments.find((row) => row.eventKey === "EV-OFFSITE")!;
  const midOffsite = offsite.start + 12 * 3_600_000;
  const range = unwrap(await t.query(api.calendar.commitments.range, { from: midOffsite, to: midOffsite + 15 * DAY }));
  expect(range.map((row) => row.eventKey)).toEqual(["EV-OFFSITE"]);
  expect(range[0]!.calendar).toEqual({ title: "Work", colour: "#3399e6" });

  await includeAll(t);
  const withHolidays = unwrap(await t.query(api.calendar.commitments.range, { from: midOffsite, to: midOffsite + 15 * DAY }));
  expect(withHolidays.map((row) => row.eventKey)).toEqual(["EV-OFFSITE", "EV-HOLIDAY"]);

  expect(await t.query(api.calendar.commitments.range, { from: midOffsite, to: midOffsite + 200 * DAY })).toEqual({
    ok: false,
    error: { kind: "invalid_range" },
  });
});

test("only the owner reads commitments, Capacity and calendars, or changes them", async () => {
  const anonymous = newSignedOutBackend();
  const owner = await signInWithGithub(anonymous, ownerGithubId, "avi");
  const token = await registerWorker(owner, "mac", ["calendar"]);
  unwrap(await owner.mutation(api.calendar.sync.applyWindow, { ...snapshot, token }));
  const { calendars } = await owner.query(api.calendar.calendars.list, {});
  const calendarId = calendars[0]!._id;
  const stranger = await strangerSession(anonymous);
  for (const [caller, message] of [
    [anonymous, "Sign in to use LifeOS."],
    [stranger, "This is not your LifeOS."],
  ] as const) {
    await expect(caller.query(api.calendar.commitments.range, { from: 0, to: DAY })).rejects.toThrow(message);
    await expect(
      caller.query(api.calendar.capacity.days, { from: "2026-11-20", days: 1, timeZone: "Australia/Sydney" }),
    ).rejects.toThrow(message);
    await expect(caller.query(api.calendar.calendars.list, {})).rejects.toThrow(message);
    await expect(caller.query(api.calendar.workingHours.get, {})).rejects.toThrow(message);
    await expect(caller.mutation(api.calendar.calendars.setIncluded, { calendarId, included: false })).rejects.toThrow(message);
    await expect(caller.mutation(api.calendar.workingHours.set, { startMinute: 0, endMinute: 60 })).rejects.toThrow(message);
  }
  expect((await owner.query(api.calendar.calendars.list, {})).calendars[0]!.included).toBe(true);
});
