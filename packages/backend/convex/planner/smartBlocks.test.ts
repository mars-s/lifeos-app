import { expect, test } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { newBackend, newSignedOutBackend, strangerSession, unwrap, type Backend } from "../backend.test-utils";
import { zonedIso, zonedMoment } from "../calendar/model";
import { addDays, type IsoDate } from "../../shared/date";
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

const smartRows = (t: Backend) => t.run((ctx) => ctx.db.query("smartBlocks").collect());

const liveRows = async (t: Backend) => (await t.run((ctx) => ctx.db.query("workBlocks").collect())).filter((block) => block.removedAt === undefined);

const weekdays = async (t: Backend) =>
  unwrap(
    await t.mutation(api.planner.smartBlocks.create, {
      title: "Focus",
      date: "2026-11-16",
      startMinute: FOUR,
      endMinute: SIX,
      timeZone: ZONE,
      repeat: { schedule: { kind: "weekdays" }, until: "2026-11-27" },
    }),
  ).blockId;

const refusedAs = (reason: string) => ({ ok: false, error: { kind: "invalid_smart_block", reason } });

test("a create refused for its date or its fill leaves no Smart Block behind", async () => {
  const { t, task } = await setup();
  const taskId = await task("Draft", { estimateMinutes: 30 });
  const saturdays = await t.mutation(api.planner.smartBlocks.create, {
    title: "Focus",
    date: DATE,
    startMinute: FOUR,
    endMinute: SIX,
    timeZone: ZONE,
    repeat: { schedule: { kind: "weeks", every: 1, days: [6] } },
  });
  expect(saturdays).toEqual(refusedAs("occurrence"));
  const outside = await t.mutation(api.planner.smartBlocks.create, {
    title: "Focus",
    date: DATE,
    startMinute: FOUR,
    endMinute: SIX,
    timeZone: ZONE,
    fill: [{ taskId, start: at(DATE, SIX - 15), minutes: 30 }],
  });
  expect(outside).toEqual(refusedAs("outside"));
  expect(await smartRows(t)).toEqual([]);
  expect((await occurrences(t, DATE, 7)).occurrences).toEqual([]);
});

test("a fill refused after its edit leaves the series as it was", async () => {
  const { t, task } = await setup();
  const taskId = await task("Draft", { estimateMinutes: 30 });
  const other = await task("Call", { estimateMinutes: 30 });
  const blockId = await weekdays(t);
  unwrap(await t.mutation(api.planner.workBlocks.create, { taskId: other, start: at(DATE, 15 * 60), minutes: 30, timeZone: ZONE }));
  const clash = await t.mutation(api.planner.smartBlocks.fill, {
    blockId,
    date: DATE,
    blocks: [{ taskId, start: at(DATE, 15 * 60), minutes: 30 }],
    release: [],
    edit: { scope: "one", startMinute: 15 * 60 },
  });
  expect(clash).toEqual(refusedAs("overlap"));
  const gone = await t.mutation(api.planner.smartBlocks.fill, {
    blockId,
    date: DATE,
    blocks: [],
    release: [],
    edit: { scope: "all", title: "Renamed", repeat: { schedule: { kind: "weeks", every: 1, days: [1] } } },
  });
  expect(gone).toEqual(refusedAs("occurrence"));
  const rows = await smartRows(t);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ title: "Focus", startMinute: FOUR, repeat: { schedule: { kind: "weekdays" }, skipped: [] } });
});

test("undoing an edit of one occurrence puts it and its Work Blocks back in the series", async () => {
  const { t, task } = await setup();
  await task("Write", { estimateMinutes: 30 });
  const blockId = await weekdays(t);
  const { blocks } = proposal(await snapshotFor(t), blockId);
  unwrap(await t.mutation(api.planner.smartBlocks.fill, { blockId, date: DATE, blocks, release: [] }));
  const before = await smartRows(t);
  const linkedBefore = await linked(t, blockId);
  const moved = unwrap(await t.mutation(api.planner.smartBlocks.edit, { blockId, date: DATE, title: "Late focus", startMinute: 15 * 60 }));
  expect(moved.blockId).not.toBe(blockId);
  expect(await linked(t, blockId)).toEqual([]);
  unwrap(await t.mutation(api.platform.undo.undo, { activityId: moved.activityId! }));
  expect((await smartRows(t)).filter((row) => row.removedAt === undefined)).toEqual(before);
  expect(await linked(t, blockId)).toEqual(linkedBefore);
  const [shown] = (await occurrences(t, DATE, 1)).occurrences;
  expect(shown).toMatchObject({ blockId, title: "Focus", startMinute: FOUR, detached: false, filled: 1 });
});

test("undoing an edit of every occurrence restores the title, window, filter and repeat", async () => {
  const { t, uni } = await setup();
  const blockId = await weekdays(t);
  const [before] = await smartRows(t);
  const edited = unwrap(
    await t.mutation(api.planner.smartBlocks.edit, {
      blockId,
      title: "Uni",
      colour: "violet",
      startMinute: 9 * 60,
      endMinute: 24 * 60,
      filter: { areaIds: [uni, uni], projectIds: [], labelIds: [] },
      repeat: null,
    }),
  );
  const [after] = await smartRows(t);
  expect(after).toMatchObject({ title: "Uni", colour: "violet", startMinute: 9 * 60, endMinute: 24 * 60, until: "2026-11-16", filter: { areaIds: [uni] } });
  expect(after?.repeat).toBeUndefined();
  unwrap(await t.mutation(api.platform.undo.undo, { activityId: edited.activityId! }));
  expect(await smartRows(t)).toEqual([before]);
});

test("removing a Smart Block hides every occurrence, and undo brings them back", async () => {
  const { t } = await setup();
  const blockId = await weekdays(t);
  const removed = unwrap(await t.mutation(api.planner.smartBlocks.remove, { blockId }));
  expect((await occurrences(t, "2026-11-16", 14)).occurrences).toEqual([]);
  expect(await t.mutation(api.planner.smartBlocks.remove, { blockId })).toEqual({ ok: false, error: { kind: "not_found", table: "smartBlocks", id: blockId } });
  expect(await t.mutation(api.planner.smartBlocks.edit, { blockId, title: "Back" })).toMatchObject({ ok: false, error: { kind: "not_found" } });
  expect(await t.mutation(api.planner.smartBlocks.skip, { blockId, date: DATE })).toMatchObject({ ok: false, error: { kind: "not_found" } });
  unwrap(await t.mutation(api.platform.undo.undo, { activityId: removed.activityId! }));
  expect((await occurrences(t, "2026-11-16", 14)).occurrences).toHaveLength(10);
});

test("skipping a one-off Smart Block removes it, and undo brings it back", async () => {
  const { t } = await setup();
  const { blockId } = unwrap(await t.mutation(api.planner.smartBlocks.create, { title: "Focus", date: DATE, startMinute: FOUR, endMinute: SIX, timeZone: ZONE }));
  const skipped = unwrap(await t.mutation(api.planner.smartBlocks.skip, { blockId, date: DATE }));
  expect((await occurrences(t, DATE, 1)).occurrences).toEqual([]);
  expect((await smartRows(t))[0]?.removedAt).toBeTypeOf("number");
  unwrap(await t.mutation(api.platform.undo.undo, { activityId: skipped.activityId! }));
  expect((await occurrences(t, DATE, 1)).occurrences.map((each) => each.blockId)).toEqual([blockId]);
});

test("a refill that frees Work Blocks is undone in one step", async () => {
  const { t, task } = await setup();
  const done = await task("Slides", { estimateMinutes: 30 });
  const blockId = await weekdays(t);
  const first = proposal(await snapshotFor(t), blockId);
  unwrap(await t.mutation(api.planner.smartBlocks.fill, { blockId, date: DATE, blocks: first.blocks, release: [] }));
  const before = await liveRows(t);
  unwrap(await t.mutation(api.planner.selection.complete, { taskIds: [done] }));
  await task("Essay", { estimateMinutes: 45 });
  const refill = proposal(await snapshotFor(t), blockId);
  expect(refill.release).toHaveLength(1);
  const filled = unwrap(await t.mutation(api.planner.smartBlocks.fill, { blockId, date: DATE, blocks: refill.blocks, release: refill.release }));
  expect((await liveRows(t)).map((row) => row.minutes)).toEqual([45]);
  unwrap(await t.mutation(api.platform.undo.undo, { activityId: filled.activityId! }));
  expect(await liveRows(t)).toEqual(before);
});

test("editing an occurrence that is skipped, detached or outside the series is refused", async () => {
  const { t } = await setup();
  const blockId = await weekdays(t);
  unwrap(await t.mutation(api.planner.smartBlocks.skip, { blockId, date: "2026-11-19" }));
  unwrap(await t.mutation(api.planner.smartBlocks.edit, { blockId, date: "2026-11-18", title: "Detached" }));
  for (const date of ["2026-11-19", "2026-11-18", "2026-11-13", "2026-11-21", "2026-11-30"]) {
    expect(await t.mutation(api.planner.smartBlocks.edit, { blockId, date, title: "Moved" })).toEqual(refusedAs("occurrence"));
    expect(await t.mutation(api.planner.smartBlocks.skip, { blockId, date })).toEqual(refusedAs("occurrence"));
  }
  expect(await t.mutation(api.planner.smartBlocks.edit, { blockId, date: "2026-11-31", title: "Moved" })).toEqual({
    ok: false,
    error: { kind: "invalid_date", input: "2026-11-31" },
  });
});

test("editing one occurrence without changing anything keeps it in the series", async () => {
  const { t } = await setup();
  const blockId = await weekdays(t);
  const same = unwrap(await t.mutation(api.planner.smartBlocks.edit, { blockId, date: DATE, title: "Focus", startMinute: FOUR, filter: ALL }));
  expect(same.blockId).toBe(blockId);
  expect(await smartRows(t)).toHaveLength(1);
});

test("a repeat that ends before it starts, a bad schedule, a bad window or a bad time zone is refused", async () => {
  const { t } = await setup();
  const base = { title: "Focus", date: DATE, startMinute: FOUR, endMinute: SIX, timeZone: ZONE };
  expect(await t.mutation(api.planner.smartBlocks.create, { ...base, repeat: { schedule: { kind: "weekdays" }, until: "2026-11-19" } })).toEqual({
    ok: false,
    error: { kind: "invalid_schedule", reason: "end" },
  });
  expect(await t.mutation(api.planner.smartBlocks.create, { ...base, repeat: { schedule: { kind: "days", every: 0 } } })).toMatchObject({
    ok: false,
    error: { kind: "invalid_schedule" },
  });
  expect(await t.mutation(api.planner.smartBlocks.create, { ...base, timeZone: "Mars/Olympus" })).toEqual(refusedAs("time_zone"));
  expect(await t.mutation(api.planner.smartBlocks.create, { ...base, startMinute: FOUR + 0.5 })).toEqual(refusedAs("window"));
  expect(await t.mutation(api.planner.smartBlocks.create, { ...base, startMinute: -15 })).toEqual(refusedAs("window"));
  const blockId = await weekdays(t);
  expect(await t.mutation(api.planner.smartBlocks.edit, { blockId, repeat: { schedule: { kind: "weekdays" }, until: "2026-11-15" } })).toEqual({
    ok: false,
    error: { kind: "invalid_schedule", reason: "end" },
  });
  expect(await t.mutation(api.planner.smartBlocks.edit, { blockId, startMinute: SIX })).toEqual(refusedAs("window"));
  expect(await t.mutation(api.planner.smartBlocks.edit, { blockId, date: DATE, endMinute: FOUR + 5 })).toEqual(refusedAs("window"));
  expect((await smartRows(t)).map((row) => [row.startMinute, row.endMinute, row.until])).toEqual([[FOUR, SIX, "2026-11-27"]]);
});

test("a fill of too many blocks, outside the window, of a closed Task, or overlapping itself is refused", async () => {
  const { t, task } = await setup();
  const taskId = await task("Draft", { estimateMinutes: 30 });
  const other = await task("Call", { estimateMinutes: 30 });
  const blockId = await weekdays(t);
  const fill = (blocks: { taskId: Id<"tasks">; start: number; minutes: number }[], release: Id<"workBlocks">[] = []) =>
    t.mutation(api.planner.smartBlocks.fill, { blockId, date: DATE, blocks, release });
  const many = Array.from({ length: 51 }, (_, index) => ({ taskId, start: at(DATE, FOUR + index), minutes: 1 }));
  expect(await fill(many)).toEqual(refusedAs("too_many"));
  expect(await fill([{ taskId, start: at(DATE, FOUR - 5), minutes: 30 }])).toEqual(refusedAs("outside"));
  expect(await fill([{ taskId, start: at(DATE, FOUR), minutes: 0 }])).toEqual(refusedAs("outside"));
  expect(await fill([{ taskId, start: at(DATE, FOUR), minutes: 2.5 }])).toEqual(refusedAs("outside"));
  expect(await fill([{ taskId, start: at(DATE, FOUR) + 0.5, minutes: 30 }])).toEqual(refusedAs("outside"));
  expect(await fill([{ taskId, start: at(DATE, FOUR), minutes: 30 }, { taskId: other, start: at(DATE, FOUR + 20), minutes: 30 }])).toEqual(refusedAs("overlap"));
  const nextDay = proposal(await snapshotFor(t, "2026-11-23" as IsoDate), blockId, "2026-11-23" as IsoDate);
  const { blockIds } = unwrap(await t.mutation(api.planner.smartBlocks.fill, { blockId, date: "2026-11-23", blocks: nextDay.blocks, release: [] }));
  expect(await fill([], blockIds)).toEqual(refusedAs("release"));
  unwrap(await t.mutation(api.planner.selection.complete, { taskIds: [other] }));
  expect(await fill([{ taskId: other, start: at(DATE, FOUR), minutes: 30 }])).toEqual({ ok: false, error: { kind: "not_found", table: "tasks", id: other } });
  expect(await liveRows(t)).toHaveLength(blockIds.length);
});

test("a fill may reuse the time of the Work Blocks it frees", async () => {
  const { t, task } = await setup();
  const first = await task("Draft", { estimateMinutes: 30 });
  const second = await task("Call", { estimateMinutes: 30 });
  const blockId = await weekdays(t);
  const { blockIds } = unwrap(
    await t.mutation(api.planner.smartBlocks.fill, { blockId, date: DATE, blocks: [{ taskId: first, start: at(DATE, FOUR), minutes: 30 }], release: [] }),
  );
  unwrap(await t.mutation(api.planner.smartBlocks.fill, { blockId, date: DATE, blocks: [{ taskId: second, start: at(DATE, FOUR), minutes: 30 }], release: blockIds }));
  expect((await liveRows(t)).map((row) => row.taskId)).toEqual([second]);
  expect(await t.mutation(api.planner.smartBlocks.fill, { blockId, date: DATE, blocks: [], release: blockIds })).toEqual(refusedAs("release"));
});

test("with the Feature off every Smart Block change is refused and nothing changes", async () => {
  const { t, task } = await setup();
  const taskId = await task("Draft", { estimateMinutes: 30 });
  const blockId = await weekdays(t);
  unwrap(await t.mutation(api.platform.features.setEnabled, { feature: "smartBlocks", enabled: false }));
  const off = { ok: false, error: { kind: "feature_off", feature: "smartBlocks" } };
  expect(await t.mutation(api.planner.smartBlocks.edit, { blockId, title: "Off" })).toEqual(off);
  expect(await t.mutation(api.planner.smartBlocks.edit, { blockId, date: DATE, title: "Off" })).toEqual(off);
  expect(await t.mutation(api.planner.smartBlocks.skip, { blockId, date: DATE })).toEqual(off);
  expect(await t.mutation(api.planner.smartBlocks.remove, { blockId })).toEqual(off);
  expect(await t.mutation(api.planner.smartBlocks.fill, { blockId, date: DATE, blocks: [{ taskId, start: at(DATE, FOUR), minutes: 30 }], release: [] })).toEqual(off);
  expect(await occurrences(t, "2026-11-16", 14)).toEqual({ on: false, occurrences: [] });
  expect((await smartRows(t)).map((row) => [row.title, row.removedAt])).toEqual([["Focus", undefined]]);
  expect(await liveRows(t)).toEqual([]);
});

test("a range with a bad date, day count or time zone is refused", async () => {
  const { t } = await setup();
  const range = (from: string, days: number, timeZone = ZONE) => t.query(api.planner.smartBlocks.range, { from, days, timeZone });
  expect(await range("2026-02-30", 1)).toEqual({ ok: false, error: { kind: "invalid_date", input: "2026-02-30" } });
  for (const days of [0, 63, 1.5]) expect(await range(DATE, days)).toEqual(refusedAs("window"));
  expect(await range(DATE, 62)).toMatchObject({ ok: true });
  expect(await range(DATE, 1, "Nowhere/Land")).toEqual(refusedAs("time_zone"));
  expect(await t.query(api.planner.smartBlocks.fillInputs, { date: DATE, timeZone: "Nowhere/Land" })).toEqual(refusedAs("time_zone"));
});

test("a daily 9:00 to 11:00 block keeps its wall-clock times on both daylight saving days, and a window can end at midnight", async () => {
  const { t } = await setup();
  for (const date of ["2026-10-03", "2026-04-04"]) {
    unwrap(
      await t.mutation(api.planner.smartBlocks.create, {
        title: "Morning",
        date,
        startMinute: 9 * 60,
        endMinute: 11 * 60,
        timeZone: ZONE,
        repeat: { schedule: { kind: "days", every: 1 }, until: addDays(date as IsoDate, 2) },
      }),
    );
    const { occurrences: shown } = await occurrences(t, date, 3);
    expect(shown.map((each) => [zonedIso(each.start, ZONE).slice(11), zonedIso(each.end, ZONE).slice(11)])).toEqual(
      date === "2026-10-03"
        ? [
            ["09:00+10:00", "11:00+10:00"],
            ["09:00+11:00", "11:00+11:00"],
            ["09:00+11:00", "11:00+11:00"],
          ]
        : [
            ["09:00+11:00", "11:00+11:00"],
            ["09:00+10:00", "11:00+10:00"],
            ["09:00+10:00", "11:00+10:00"],
          ],
    );
  }
  const { blockId } = unwrap(await t.mutation(api.planner.smartBlocks.create, { title: "Whole day", date: "2026-04-05", startMinute: 0, endMinute: 24 * 60, timeZone: ZONE }));
  const [whole] = (await occurrences(t, "2026-04-05", 1)).occurrences.filter((each) => each.blockId === blockId);
  expect(whole && [zonedIso(whole.start, ZONE), zonedIso(whole.end, ZONE), (whole.end - whole.start) / (60 * MINUTE_MS)]).toEqual([
    "2026-04-05T00:00+11:00",
    "2026-04-06T00:00+10:00",
    25,
  ]);
});

test("a Work Block running past midnight from the day before is busy time for a fill", async () => {
  const { t, task } = await setup();
  const late = await task("Late shift", { estimateMinutes: 60 });
  await task("Draft", { estimateMinutes: 30 });
  unwrap(await t.mutation(api.planner.workBlocks.create, { taskId: late, start: at("2026-11-19" as IsoDate, 23 * 60 + 30), minutes: 60, timeZone: ZONE }));
  const { blockId } = unwrap(await t.mutation(api.planner.smartBlocks.create, { title: "Night", date: DATE, startMinute: 0, endMinute: 2 * 60, timeZone: ZONE }));
  const night = proposal(await snapshotFor(t), blockId, DATE, { start: 0, end: 2 * 60 });
  expect(night.blocks.map((block) => zonedIso(block.start, ZONE))).toEqual(["2026-11-20T00:35+11:00"]);
  unwrap(await t.mutation(api.planner.smartBlocks.fill, { blockId, date: DATE, blocks: night.blocks, release: [] }));
});

test("the fill inputs give a Project's Task the Area of its Project, with that Area's colour", async () => {
  const { t, uni } = await setup();
  unwrap(await t.mutation(api.planner.areas.setColour, { areaId: uni, colour: "violet" }));
  const { projectId } = unwrap(await t.mutation(api.planner.projects.create, { title: "Thesis", areaId: uni }));
  const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Chapter", when: { kind: "anytime" }, parent: { kind: "project", projectId } }));
  const snapshot = await snapshotFor(t);
  expect(snapshot.tasks.find((each) => each._id === taskId)).toMatchObject({ areaId: uni, projectId, colour: "violet" });
  const result = fillSmartBlock({ snapshot, blockId: null, window: { start: 0, end: 1 }, filter: { areaIds: [uni], projectIds: [], labelIds: [] }, now: 0 });
  expect(result.skipped.map((skip) => skip.task._id)).toEqual([taskId]);
});

test("editing the one occurrence of a one-off block changes it in place, and undo restores it", async () => {
  const { t } = await setup();
  const { blockId } = unwrap(await t.mutation(api.planner.smartBlocks.create, { title: "Focus", date: DATE, startMinute: FOUR, endMinute: SIX, timeZone: ZONE }));
  const before = await smartRows(t);
  const edited = unwrap(await t.mutation(api.planner.smartBlocks.edit, { blockId, date: DATE, title: "Admin", endMinute: SIX + 30 }));
  expect(edited.blockId).toBe(blockId);
  expect((await smartRows(t)).map((row) => [row.title, row.endMinute, row.detachedFrom])).toEqual([["Admin", SIX + 30, undefined]]);
  unwrap(await t.mutation(api.platform.undo.undo, { activityId: edited.activityId! }));
  expect(await smartRows(t)).toEqual(before);
});
