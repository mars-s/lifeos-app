import { expect, test } from "vitest";
import { api } from "../_generated/api";
import { newBackend, unwrap } from "../backend.test-utils";
import { zonedMoment } from "../calendar/model";
import { addDays, type IsoDate } from "../../shared/date";
import type { Backend } from "../backend.test-utils";

const SYDNEY = "Australia/Sydney";
const today = "2026-11-26" as IsoDate;
const at = (date: string, hour: number, minute = 0) => zonedMoment(date as IsoDate, hour * 60 + minute, SYDNEY);
const clock = (instant: number) => new Date(instant).toLocaleTimeString("en-AU", { timeZone: SYDNEY, hour: "numeric", minute: "2-digit", hour12: false });

const setup = async () => {
  const t = await newBackend();
  const make = async (title: string, date: string, estimateMinutes: number) =>
    unwrap(await t.mutation(api.planner.tasks.create, { title, when: { kind: "scheduled", date, evening: false }, estimateMinutes })).taskId;
  const outline = await make("Draft the thesis outline", today, 90);
  const reply = await make("Reply to Harry", today, 30);
  const methods = await make("Methods, second pass", "2026-11-27", 60);
  await make("Plan the Japan trip", "2026-11-28", 60);
  const kept = await make("Group meeting prep", today, 45);
  unwrap(await t.mutation(api.planner.workBlocks.create, { taskId: kept, start: at(today, 13), minutes: 45, timeZone: SYDNEY }));
  const timeline = async (now: number) => unwrap(await t.query(api.planner.timeline.days, { from: today, days: 3, timeZone: SYDNEY, now }));
  return { t, outline, reply, methods, timeline };
};

const shape = (day: { predictions: readonly { title: string; start: number; minutes: number }[] }) =>
  day.predictions.map((prediction) => `${prediction.title} ${clock(prediction.start)}+${prediction.minutes}`);

test("the timeline predicts today after now and tomorrow, in Day Plan order around kept Work Blocks, and saves nothing", async () => {
  const { t, timeline } = await setup();
  const view = await timeline(at(today, 12, 40));
  const [first, second, third] = view.days;
  expect(view.today).toBe(today);
  expect(first?.blocks.map((block) => block.title)).toEqual(["Group meeting prep"]);
  expect(first && shape(first)).toEqual(["Draft the thesis outline 13:55+90", "Reply to Harry 15:35+30"]);
  expect(second && shape(second)).toEqual(["Methods, second pass 09:00+60"]);
  expect(third?.predicts).toBe(false);
  expect(third?.predictions).toEqual([]);
  expect(first?.load).toEqual({ done: 0, kept: 45, predicted: 120 });
  expect(await t.run((ctx) => ctx.db.query("workBlocks").collect())).toHaveLength(1);
});

test("keeping a prediction makes it a Work Block, and Keep all is one undoable change", async () => {
  const { t, outline, reply, timeline } = await setup();
  const now = at(today, 12, 40);
  const before = (await timeline(now)).days[0];
  const picks = before?.predictions ?? [];
  const kept = unwrap(
    await t.mutation(api.planner.workBlocks.spread, {
      timeZone: SYDNEY,
      blocks: picks.map(({ taskId, start, minutes }) => ({ taskId, start, minutes })),
    }),
  );
  const after = (await timeline(now)).days[0];
  expect(after?.predictions).toEqual([]);
  expect(after?.blocks.map((block) => block.title)).toEqual(["Group meeting prep", "Draft the thesis outline", "Reply to Harry"]);
  expect(after?.load).toEqual({ done: 0, kept: 165, predicted: 0 });

  unwrap(await t.mutation(api.platform.undo.undo, { activityId: kept.activityId! }));
  expect((await timeline(now)).days[0]?.predictions.map((prediction) => prediction.taskId)).toEqual([outline, reply]);
});

test("a prediction is never in the past: as now moves it steps to the next free gap, and open Tasks roll on to the new today", async () => {
  const { timeline } = await setup();
  const late = (await timeline(at(today, 16, 50))).days[0];
  expect(late && shape(late)).toEqual(["Reply to Harry 16:50+30"]);
  expect(late?.unfit).toHaveLength(1);
  const tomorrow = (await timeline(at("2026-11-27", 9, 5))).days;
  expect(tomorrow[0]?.predictions).toEqual([]);
  expect(tomorrow[1] && shape(tomorrow[1])).toEqual([
    "Draft the thesis outline 09:05+90",
    "Reply to Harry 10:45+30",
    "Group meeting prep 11:25+45",
    "Methods, second pass 12:20+60",
  ]);
});

test("the timeline refuses a bad range or time zone", async () => {
  const t = await newBackend();
  expect(await t.query(api.planner.timeline.days, { from: today, days: 30, timeZone: SYDNEY, now: Date.now() })).toEqual({
    ok: false,
    error: { kind: "invalid_plan", reason: "range" },
  });
  expect(await t.query(api.planner.timeline.days, { from: today, days: 1, timeZone: "Mars/Olympus", now: Date.now() })).toEqual({
    ok: false,
    error: { kind: "invalid_plan", reason: "time_zone" },
  });
});

const seedNights = (t: Backend, last: IsoDate, count: number) =>
  t.run(async (ctx) => {
    const synced = at(last, 8);
    for (let index = 0; index < count; index += 1) {
      const day = addDays(last, -index);
      const end = zonedMoment(day, 7 * 60, SYDNEY);
      await ctx.db.insert("healthDays", {
        source: "oura",
        day,
        sleep: { start: end - 500 * 60_000, end, offsetMinutes: 660, asleepMinutes: 470 },
        sleepScore: 80,
        readinessScore: 82,
        syncedAt: synced,
      });
    }
    await ctx.db.insert("ouraConnection", {
      accessToken: "seed",
      refreshToken: "seed",
      expiresAt: synced + 86_400_000,
      scope: "daily",
      connectedAt: synced,
      sync: { kind: "ok", at: synced },
    });
  });

test("with an Energy Curve, focus work is predicted at the peak and says so, and each day carries its curve", async () => {
  const { t, timeline } = await setup();
  await seedNights(t, today, 7);
  const [first, second, third] = (await timeline(at(today, 8, 0))).days;
  expect(first?.energy?.kind).toBe("solid");
  expect(second?.energy?.kind).toBe("usual");
  expect(third?.energy?.kind).toBe("usual");
  const peak = first?.energy && "peak" in first.energy ? first.energy.peak : null;
  const outline = first?.predictions.find((prediction) => prediction.title === "Draft the thesis outline");
  expect(outline?.fit).toBe("peak");
  const minute = outline ? Math.round((outline.start - at(today, 0)) / 60_000) : -1;
  expect(peak && minute >= peak.start && minute < peak.end).toBe(true);
});
