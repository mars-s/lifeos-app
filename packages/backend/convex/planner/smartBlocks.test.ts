import { expect, test } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { newBackend, newSignedOutBackend, strangerSession, unwrap, type Backend } from "../backend.test-utils";
import { zonedIso, zonedMoment } from "../calendar/model";
import type { IsoDate } from "../../shared/date";
import { fillSmartBlock, type FillSnapshot } from "../../shared/smartBlocks";

const ZONE = "Australia/Sydney";
const DATE = "2026-11-20" as IsoDate;
const FOUR = 16 * 60;
const SIX = 18 * 60;
const MINUTE_MS = 60_000;
const ALL = { areaIds: [], projectIds: [], labelIds: [] };

const at = (date: IsoDate, minute: number) => zonedMoment(date, minute, ZONE);

const setup = async () => {
  const t = await newBackend();
  const { areaId: uni } = unwrap(await t.mutation(api.planner.areas.create, { title: "University" }));
  const { areaId: personal } = unwrap(await t.mutation(api.planner.areas.create, { title: "Personal" }));
  const task = async (title: string, fields: { estimateMinutes?: number; deadline?: string; areaId?: Id<"areas"> } = {}) =>
    unwrap(
      await t.mutation(api.planner.tasks.create, {
        title,
        when: { kind: "anytime" },
        ...(fields.estimateMinutes ? { estimateMinutes: fields.estimateMinutes } : {}),
        ...(fields.deadline ? { deadline: fields.deadline } : {}),
        ...(fields.areaId ? { parent: { kind: "area" as const, areaId: fields.areaId } } : {}),
      }),
    ).taskId;
  return { t, uni, personal, task };
};

const snapshotFor = async (t: Backend, date: IsoDate = DATE) => {
  const snapshot = unwrap(await t.query(api.planner.smartBlocks.fillInputs, { date, timeZone: ZONE }));
  if (!snapshot) throw new Error("Smart Blocks is on, so there is a snapshot.");
  return snapshot as FillSnapshot;
};

const proposal = (snapshot: FillSnapshot, blockId: string | null, date: IsoDate = DATE, window = { start: FOUR, end: SIX }, now = 0) => {
  const result = fillSmartBlock({
    snapshot,
    blockId,
    window: { start: at(date, window.start) / MINUTE_MS, end: at(date, window.end) / MINUTE_MS },
    filter: ALL,
    now,
  });
  return {
    result,
    blocks: result.picks.map((pick) => ({ taskId: pick.task._id as Id<"tasks">, start: pick.start * MINUTE_MS, minutes: pick.minutes })),
    release: result.released.map((block) => block.blockId as Id<"workBlocks">),
  };
};

const occurrences = async (t: Backend, from: string, days: number) => unwrap(await t.query(api.planner.smartBlocks.range, { from, days, timeZone: ZONE }));

const linked = (t: Backend, blockId: Id<"smartBlocks">) =>
  t.run(async (ctx) => (await ctx.db.query("workBlocks").collect()).filter((block) => block.removedAt === undefined && block.smartBlock?.blockId === blockId));

test("drawing a Smart Block and accepting its fill is one change, and one undo removes both", async () => {
  const { t, uni, task } = await setup();
  await task("Read chapter", { estimateMinutes: 50, areaId: uni });
  await task("Email tutor", { estimateMinutes: 15 });
  const { blocks } = proposal(await snapshotFor(t), null);
  expect(blocks).toHaveLength(2);
  const created = unwrap(
    await t.mutation(api.planner.smartBlocks.create, { title: "Focus", date: DATE, startMinute: FOUR, endMinute: SIX, timeZone: ZONE, fill: blocks }),
  );
  const [range] = (await occurrences(t, DATE, 1)).occurrences;
  expect(range).toMatchObject({ title: "Focus", start: at(DATE, FOUR), end: at(DATE, SIX), filled: 2, filledMinutes: 50 + 15 });
  const changes = await t.run((ctx) => ctx.db.query("activityChanges").collect());
  expect(new Set(changes.filter((change) => change.activityId === created.activityId).map((change) => change.entity.table))).toEqual(
    new Set(["smartBlocks", "workBlocks"]),
  );
  unwrap(await t.mutation(api.platform.undo.undo, { activityId: created.activityId! }));
  expect((await occurrences(t, DATE, 1)).occurrences).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query("workBlocks").collect())).toEqual([]);
});

test("a fill outside the window, over another Work Block, or freeing a stranger's block is refused", async () => {
  const { t, task } = await setup();
  const taskId = await task("Draft", { estimateMinutes: 30 });
  const other = await task("Call", { estimateMinutes: 30 });
  const { blockId } = unwrap(await t.mutation(api.planner.smartBlocks.create, { title: "Focus", date: DATE, startMinute: FOUR, endMinute: SIX, timeZone: ZONE }));
  const outside = await t.mutation(api.planner.smartBlocks.fill, { blockId, date: DATE, blocks: [{ taskId, start: at(DATE, 17 * 60 + 45), minutes: 30 }], release: [] });
  expect(outside).toEqual({ ok: false, error: { kind: "invalid_smart_block", reason: "outside" } });
  const { blockId: manual } = unwrap(await t.mutation(api.planner.workBlocks.create, { taskId: other, start: at(DATE, FOUR), minutes: 30, timeZone: ZONE }));
  const clash = await t.mutation(api.planner.smartBlocks.fill, { blockId, date: DATE, blocks: [{ taskId, start: at(DATE, FOUR + 15), minutes: 30 }], release: [] });
  expect(clash).toEqual({ ok: false, error: { kind: "invalid_smart_block", reason: "overlap" } });
  const stranger = await t.mutation(api.planner.smartBlocks.fill, { blockId, date: DATE, blocks: [], release: [manual] });
  expect(stranger).toEqual({ ok: false, error: { kind: "invalid_smart_block", reason: "release" } });
  const wrongDay = await t.mutation(api.planner.smartBlocks.fill, { blockId, date: "2026-11-21", blocks: [], release: [] });
  expect(wrongDay).toEqual({ ok: false, error: { kind: "invalid_smart_block", reason: "occurrence" } });
});

test("a refill keeps accepted Work Blocks still and only frees those of Tasks that are done", async () => {
  const { t, uni, task } = await setup();
  const done = await task("Finish slides", { estimateMinutes: 30, areaId: uni });
  const stays = await task("Read paper", { estimateMinutes: 40, areaId: uni });
  const { blocks } = proposal(await snapshotFor(t), null);
  const { blockId } = unwrap(await t.mutation(api.planner.smartBlocks.create, { title: "Focus", date: DATE, startMinute: FOUR, endMinute: SIX, timeZone: ZONE, fill: blocks }));
  const before = await linked(t, blockId);
  const kept = before.find((block) => block.taskId === stays);
  unwrap(await t.mutation(api.planner.selection.complete, { taskIds: [done] }));
  const fresh = await task("Plan essay", { estimateMinutes: 25, deadline: "2026-11-21" });
  const refill = proposal(await snapshotFor(t), blockId);
  expect(refill.release).toEqual([before.find((block) => block.taskId === done)?._id]);
  expect(refill.blocks.map((block) => block.taskId)).toEqual([fresh]);
  expect(refill.result.picks[0]?.reason).toBe("Deadline tomorrow");
  unwrap(await t.mutation(api.planner.smartBlocks.fill, { blockId, date: DATE, blocks: refill.blocks, release: refill.release }));
  const after = await linked(t, blockId);
  expect(after.find((block) => block.taskId === stays)).toMatchObject({ _id: kept?._id, start: kept?.start, minutes: kept?.minutes });
  expect(after.map((block) => block.taskId).toSorted()).toEqual([fresh, stays].toSorted());
});

test("a repeating Smart Block shows on the right days as an empty zone, at the same wall-clock time across daylight saving", async () => {
  const { t } = await setup();
  unwrap(
    await t.mutation(api.planner.smartBlocks.create, {
      title: "Focus",
      date: "2026-09-26",
      startMinute: FOUR,
      endMinute: SIX,
      timeZone: ZONE,
      repeat: { schedule: { kind: "weeks", every: 1, days: [6] } },
    }),
  );
  const { occurrences: shown } = await occurrences(t, "2026-09-26", 21);
  expect(shown.map((each) => each.date)).toEqual(["2026-09-26", "2026-10-03", "2026-10-10"]);
  expect(shown.map((each) => zonedIso(each.start, ZONE))).toEqual([
    "2026-09-26T16:00+10:00",
    "2026-10-03T16:00+10:00",
    "2026-10-10T16:00+11:00",
  ]);
  expect(shown.every((each) => each.filled === 0 && each.end - each.start === 2 * 60 * MINUTE_MS)).toBe(true);
});

test("editing one occurrence detaches it with its fill, editing all changes the series, and skipping hides one day", async () => {
  const { t, task } = await setup();
  await task("Write", { estimateMinutes: 30 });
  const { blockId } = unwrap(
    await t.mutation(api.planner.smartBlocks.create, {
      title: "Focus",
      date: "2026-11-16",
      startMinute: FOUR,
      endMinute: SIX,
      timeZone: ZONE,
      repeat: { schedule: { kind: "weekdays" }, until: "2026-11-27" },
    }),
  );
  const { blocks } = proposal(await snapshotFor(t), blockId);
  unwrap(await t.mutation(api.planner.smartBlocks.fill, { blockId, date: DATE, blocks, release: [] }));
  const moved = unwrap(await t.mutation(api.planner.smartBlocks.fill, { blockId, date: DATE, blocks: [], release: [], edit: { scope: "one", startMinute: 15 * 60 } }));
  expect(moved.blockId).not.toBe(blockId);
  expect(await linked(t, moved.blockId)).toHaveLength(1);
  unwrap(await t.mutation(api.planner.smartBlocks.edit, { blockId, title: "Deep work" }));
  const skipped = unwrap(await t.mutation(api.planner.smartBlocks.skip, { blockId, date: "2026-11-19" }));
  const week = (await occurrences(t, "2026-11-16", 14)).occurrences;
  expect(week.map((each) => [each.date, each.title, each.startMinute, each.detached])).toEqual([
    ["2026-11-16", "Deep work", FOUR, false],
    ["2026-11-17", "Deep work", FOUR, false],
    ["2026-11-18", "Deep work", FOUR, false],
    ["2026-11-20", "Focus", 15 * 60, true],
    ["2026-11-23", "Deep work", FOUR, false],
    ["2026-11-24", "Deep work", FOUR, false],
    ["2026-11-25", "Deep work", FOUR, false],
    ["2026-11-26", "Deep work", FOUR, false],
    ["2026-11-27", "Deep work", FOUR, false],
  ]);
  unwrap(await t.mutation(api.platform.undo.undo, { activityId: skipped.activityId! }));
  expect((await occurrences(t, "2026-11-19", 1)).occurrences).toHaveLength(1);
});

test("the day meter counts filled Work Blocks like any other", async () => {
  const { t, task } = await setup();
  await task("Write", { estimateMinutes: 45 });
  const { blocks } = proposal(await snapshotFor(t), null);
  unwrap(await t.mutation(api.planner.smartBlocks.create, { title: "Focus", date: DATE, startMinute: FOUR, endMinute: SIX, timeZone: ZONE, fill: blocks }));
  const week = unwrap(await t.query(api.planner.plan.week, { from: DATE, days: 1, timeZone: ZONE }));
  expect(week.days[0]?.plannedMinutes).toBe(45);
});

test("Area priority comes from the Smart Blocks settings, then the sidebar order", async () => {
  const { t, uni, personal, task } = await setup();
  expect((await t.query(api.planner.smartBlocks.priority, {})).map((area) => area.title)).toEqual(["University", "Personal"]);
  unwrap(await t.mutation(api.platform.features.configure, { choice: { feature: "smartBlocks", settings: { areaOrder: [personal] } } }));
  expect((await t.query(api.planner.smartBlocks.priority, {})).map((area) => area._id)).toEqual([personal, uni]);
  await task("Uni work", { areaId: uni });
  const home = await task("Home work", { areaId: personal });
  expect(proposal(await snapshotFor(t), null).blocks[0]?.taskId).toBe(home);
});

test("switching the Feature off hides Smart Blocks and refuses changes, and switching it on brings them back", async () => {
  const { t } = await setup();
  unwrap(await t.mutation(api.planner.smartBlocks.create, { title: "Focus", date: DATE, startMinute: FOUR, endMinute: SIX, timeZone: ZONE }));
  unwrap(await t.mutation(api.platform.features.setEnabled, { feature: "smartBlocks", enabled: false }));
  expect(await occurrences(t, DATE, 1)).toEqual({ on: false, occurrences: [] });
  expect(unwrap(await t.query(api.planner.smartBlocks.fillInputs, { date: DATE, timeZone: ZONE }))).toBeNull();
  expect(await t.mutation(api.planner.smartBlocks.create, { title: "Admin", date: DATE, startMinute: 9 * 60, endMinute: 10 * 60, timeZone: ZONE })).toEqual({
    ok: false,
    error: { kind: "feature_off", feature: "smartBlocks" },
  });
  unwrap(await t.mutation(api.platform.features.setEnabled, { feature: "smartBlocks", enabled: true }));
  expect((await occurrences(t, DATE, 1)).occurrences).toHaveLength(1);
});

test("a window shorter than 15 minutes or past midnight is refused", async () => {
  const { t } = await setup();
  const base = { title: "Focus", date: DATE, timeZone: ZONE };
  expect(await t.mutation(api.planner.smartBlocks.create, { ...base, startMinute: FOUR, endMinute: FOUR + 10 })).toEqual({
    ok: false,
    error: { kind: "invalid_smart_block", reason: "window" },
  });
  expect(await t.mutation(api.planner.smartBlocks.create, { ...base, startMinute: 23 * 60, endMinute: 25 * 60 })).toEqual({
    ok: false,
    error: { kind: "invalid_smart_block", reason: "window" },
  });
});

const refusal = (call: Promise<unknown>) =>
  call.then(
    () => "allowed",
    (error: unknown) => (error && typeof error === "object" && "data" in error ? (error.data as { kind: string }).kind : "thrown"),
  );

test("only the owner can read or change Smart Blocks", async () => {
  const anonymous = newSignedOutBackend();
  const stranger = await strangerSession(anonymous);
  expect(await refusal(anonymous.query(api.planner.smartBlocks.range, { from: DATE, days: 1, timeZone: ZONE }))).toBe("signed_out");
  expect(await refusal(stranger.query(api.planner.smartBlocks.fillInputs, { date: DATE, timeZone: ZONE }))).toBe("not_owner");
  expect(
    await refusal(stranger.mutation(api.planner.smartBlocks.create, { title: "Focus", date: DATE, startMinute: FOUR, endMinute: SIX, timeZone: ZONE })),
  ).toBe("not_owner");
});
