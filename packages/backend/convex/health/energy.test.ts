import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import { zonedMoment } from "../calendar/model";
import { newBackend, newSignedOutBackend, unwrap, type Backend } from "../backend.test-utils";
import { addDays, type IsoDate } from "../../shared/date";

const SYDNEY = "Australia/Sydney";
const TODAY = "2026-11-19" as IsoDate;
const SYNCED = Date.parse("2026-11-19T08:15:00+11:00");

type Night = { asleep?: number; wake?: number; readiness?: number; sleep?: false };

const seed = async (t: Backend, last: IsoDate, count: number, nights: Record<string, Night> = {}, sync = SYNCED, timeZone = SYDNEY) =>
  t.run(async (ctx) => {
    for (let index = 0; index < count; index += 1) {
      const day = addDays(last, -index);
      const night = nights[day] ?? {};
      const asleep = night.asleep ?? 470;
      const end = zonedMoment(day, night.wake ?? 420, timeZone);
      const offsetMinutes = Math.round((zonedMoment(day, night.wake ?? 420, "UTC") - end) / 60_000);
      await ctx.db.insert("healthDays", {
        source: "oura",
        day,
        ...(night.sleep === false ? {} : { sleep: { start: end - (asleep + 30) * 60_000, end, offsetMinutes, asleepMinutes: asleep } }),
        sleepScore: 80,
        readinessScore: night.readiness ?? 82,
        sleepTime: { status: "optimal_found", window: { startOffset: -5400, endOffset: -1800, dayTz: offsetMinutes * 60 } },
        syncedAt: sync,
      });
    }
    await ctx.db.insert("ouraConnection", {
      accessToken: "seed",
      refreshToken: "seed",
      expiresAt: sync + 86_400_000,
      scope: "daily",
      connectedAt: sync,
      sync: { kind: "ok", at: sync },
    });
  });

const energy = async (t: Backend, from: string, to: string, today: string = TODAY, timeZone = SYDNEY) =>
  unwrap(await t.query(api.health.energy.days, { from, to, today, timeZone }));

const one = async (t: Backend, date: string, today: string = TODAY, timeZone = SYDNEY) => {
  const [day] = await energy(t, date, date, today, timeZone);
  if (!day) throw new Error("no day");
  return day;
};

const curveOf = async (t: Backend, date: string, today: string = TODAY, timeZone = SYDNEY) => {
  const day = await one(t, date, today, timeZone);
  if (day.kind !== "solid" && day.kind !== "usual") throw new Error(`no curve: ${day.kind}`);
  return day;
};

const levelAt = (day: { points: { minute: number; level: number }[] }, minute: number) => day.points.find((point) => point.minute === minute)?.level;

describe("energy days", () => {
  test("only the owner can read energy", async () => {
    const t = newSignedOutBackend();
    await expect(t.query(api.health.energy.days, { from: TODAY, to: TODAY, today: TODAY, timeZone: SYDNEY })).rejects.toThrow();
  });

  test("without Oura every day has no curve", async () => {
    const t = await newBackend();
    const days = await energy(t, "2026-11-18", "2026-11-21");
    expect(days.map((day) => [day.date, day.kind])).toEqual([
      ["2026-11-18", "none"],
      ["2026-11-19", "none"],
      ["2026-11-20", "none"],
      ["2026-11-21", "none"],
    ]);
  });

  test("with fewer than five nights it is still learning and says how many", async () => {
    const t = await newBackend();
    await seed(t, TODAY, 3);
    expect(await one(t, TODAY)).toEqual({ date: TODAY, kind: "learning", reading: { nights: 3 } });
  });

  test("today after a good night is solid, from waking to Oura's bedtime, with a late-morning peak and an afternoon dip", async () => {
    const t = await newBackend();
    await seed(t, TODAY, 14);
    const day = await curveOf(t, TODAY);
    expect(day).toMatchObject({ kind: "solid", wake: 7 * 60, bedtime: 22 * 60 + 30, bedtimeFrom: "oura", low: false });
    expect(day.reading).toEqual({ asleepMinutes: 470, readiness: 82, debtMinutes: 75, nights: 14, syncedAt: SYNCED });
    expect(day.points[0]?.minute).toBe(7 * 60);
    expect(day.points.at(-1)?.minute).toBe(22 * 60 + 30);
    expect(day.points.slice(1).every((point, index) => point.minute - (day.points[index]?.minute ?? 0) === 15)).toBe(true);
    expect(day.points.every((point) => point.level >= 0 && point.level <= 1)).toBe(true);
    expect(day.peak.start).toBeGreaterThanOrEqual(9 * 60);
    expect(day.peak.end).toBeLessThanOrEqual(11 * 60);
    expect(day.dip.start).toBeGreaterThanOrEqual(13 * 60);
    expect(day.dip.end).toBeLessThanOrEqual(16 * 60);
    expect(levelAt(day, 10 * 60)).toBeGreaterThan(0.9);
    expect(levelAt(day, 15 * 60)).toBeLessThan(0.6);
    expect(levelAt(day, 19 * 60)).toBeGreaterThan(levelAt(day, 15 * 60) ?? 1);
    expect(levelAt(day, 19 * 60)).toBeLessThan(levelAt(day, 10 * 60) ?? 0);
  });

  test("a short night lowers the whole curve and makes a low energy day", async () => {
    const t = await newBackend();
    await seed(t, TODAY, 14, { [TODAY]: { asleep: 5 * 60 + 10, readiness: 61 } });
    const good = await newBackend();
    await seed(good, TODAY, 14);
    const short = await curveOf(t, TODAY);
    const rested = await curveOf(good, TODAY);
    expect(short.low).toBe(true);
    expect(short.reading).toMatchObject({ asleepMinutes: 310, readiness: 61 });
    expect(short.points.slice(1).every((point) => point.level < (levelAt(rested, point.minute) ?? 0))).toBe(true);
    expect(levelAt(short, 10 * 60)).toBeLessThan(0.75);
  });

  test("coming days follow the usual pattern, without last night's reading", async () => {
    const t = await newBackend();
    await seed(t, TODAY, 14, { [TODAY]: { wake: 6 * 60 } });
    const tomorrow = await curveOf(t, addDays(TODAY, 1));
    expect(tomorrow).toMatchObject({ kind: "usual", wake: 7 * 60, bedtime: 22 * 60 + 30, low: false });
    expect(tomorrow.reading).toEqual({ debtMinutes: 75, nights: 14, syncedAt: SYNCED });
  });

  test("today falls back to the usual pattern when Oura has not synced since last night", async () => {
    const t = await newBackend();
    const lastSync = Date.parse("2026-11-18T18:10:00+11:00");
    await seed(t, addDays(TODAY, -1), 14, {}, lastSync);
    const today = await curveOf(t, TODAY);
    expect(today.kind).toBe("usual");
    expect(today.reading.syncedAt).toBe(lastSync);
    expect(today.reading.asleepMinutes).toBeUndefined();
  });

  test("a day with readiness but no sleep period uses the usual pattern", async () => {
    const t = await newBackend();
    await seed(t, TODAY, 14, { [TODAY]: { sleep: false, readiness: 40 } });
    const today = await curveOf(t, TODAY);
    expect(today.kind).toBe("usual");
    expect(today.reading).toEqual({ debtMinutes: 74, nights: 13, syncedAt: SYNCED });
  });

  test("a past day keeps the estimate it started with", async () => {
    const before = await newBackend();
    await seed(before, addDays(TODAY, -1), 14);
    const after = await newBackend();
    await seed(after, TODAY, 15, { [TODAY]: { asleep: 4 * 60 } });
    const yesterday = addDays(TODAY, -1);
    expect(await curveOf(after, yesterday)).toEqual(await curveOf(before, yesterday, yesterday));
  });

  test("the curve is drawn in the time zone it is viewed from", async () => {
    const t = await newBackend();
    await seed(t, TODAY, 14);
    const sydney = await curveOf(t, TODAY);
    const perth = await curveOf(t, TODAY, TODAY, "Australia/Perth");
    expect(perth.wake).toBe(4 * 60);
    expect(levelAt(perth, 7 * 60)).toBe(levelAt(sydney, 10 * 60));
  });

  test("the day daylight saving starts keeps its shape on the wall clock", async () => {
    const t = await newBackend();
    const start = "2026-10-04" as IsoDate;
    await seed(t, addDays(start, 1), 20, {}, Date.parse("2026-10-05T08:00:00+11:00"));
    const before = await curveOf(t, addDays(start, -1), start);
    const changed = await curveOf(t, start, start);
    expect(changed.wake).toBe(7 * 60);
    expect(changed.points.map((point) => point.minute)).toEqual(before.points.map((point) => point.minute));
    expect(changed.points.map((point) => point.level)).toEqual(before.points.map((point) => point.level));
  });

  test("a backwards or too long range is refused", async () => {
    const t = await newBackend();
    expect(await t.query(api.health.energy.days, { from: TODAY, to: "2026-11-18", today: TODAY, timeZone: SYDNEY })).toEqual({
      ok: false,
      error: { kind: "invalid_range" },
    });
    expect(await t.query(api.health.energy.days, { from: TODAY, to: "2027-02-01", today: TODAY, timeZone: SYDNEY })).toMatchObject({ ok: false });
  });
});
