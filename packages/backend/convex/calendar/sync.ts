import { v, type Infer } from "convex/values";
import { Clock, Effect, Result } from "effect";
import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { asWire } from "../../shared/effect/wire";
import { sameValue } from "../platform/activity";
import { CurrentWorker, workerMutation, writing } from "../platform/effect";
import { requireCapability } from "../platform/workers";
import { InvalidWindow } from "./errors";
import { DAY_MS, hexColour, includedByDefault } from "./model";
import { calendarFields, commitmentFields } from "./tables";

const MAX_WINDOW_MS = 120 * DAY_MS;
const CALENDAR_LIMIT = 200;
const WINDOW_ROW_LIMIT = 8000;

const vColour = v.object({ red: v.number(), green: v.number(), blue: v.number() });

const vCalendarIn = v.object({ ...calendarFields, colour: vColour });
const vCommitmentIn = v.object(commitmentFields);

type CalendarIn = Infer<typeof vCalendarIn>;
type CommitmentIn = Infer<typeof vCommitmentIn>;
type Window = { start: number; end: number };

export type SyncReport = {
  calendars: { inserted: number; updated: number; removed: number };
  commitments: { inserted: number; updated: number; unchanged: number; removed: number; skipped: number };
};

const parseWindow = (window: Window) => {
  const parsed: Result.Result<Window, InvalidWindow> =
    Number.isFinite(window.start) && Number.isFinite(window.end) && window.end > window.start && window.end - window.start <= MAX_WINDOW_MS
      ? Result.succeed(window)
      : Result.fail(new InvalidWindow());
  return parsed;
};

const changedFields = <T extends object>(current: T, next: Partial<T>) =>
  Object.fromEntries(
    Object.entries(next).filter(([key, value]) => !sameValue((current as Record<string, unknown>)[key], value)),
  ) as Partial<T>;

const syncCalendars = async (ctx: MutationCtx, incoming: readonly CalendarIn[]) => {
  const report = { inserted: 0, updated: 0, removed: 0 };
  const existing = new Map((await ctx.db.query("calendars").take(CALENDAR_LIMIT)).map((row) => [row.calendarId, row]));
  for (const calendar of incoming) {
    const fields = { ...calendar, colour: hexColour(calendar.colour) };
    const row = existing.get(calendar.calendarId);
    existing.delete(calendar.calendarId);
    if (!row) {
      await ctx.db.insert("calendars", { ...fields, included: includedByDefault(calendar.kind) });
      report.inserted += 1;
      continue;
    }
    const changes = changedFields(row, fields);
    if (Object.keys(changes).length > 0) {
      await ctx.db.patch("calendars", row._id, changes);
      report.updated += 1;
    }
  }
  for (const gone of existing.values()) {
    await ctx.db.delete("calendars", gone._id);
    report.removed += 1;
  }
  return report;
};

const normalised = (commitment: CommitmentIn) => {
  const start = Math.round(commitment.start);
  const end = Math.max(start, Math.round(commitment.end));
  const location = commitment.location?.trim() || undefined;
  return { ...commitment, start, end, location };
};

const syncCommitments = async (
  ctx: MutationCtx,
  window: Window,
  incoming: readonly CommitmentIn[],
  calendarIds: ReadonlySet<string>,
) => {
  const report = { inserted: 0, updated: 0, unchanged: 0, removed: 0, skipped: 0 };
  const inWindow = await ctx.db
    .query("externalCommitments")
    .withIndex("by_start", (q) => q.gte("start", window.start).lt("start", window.end))
    .take(WINDOW_ROW_LIMIT);
  const byKey = new Map(inWindow.map((row) => [row.eventKey, row]));
  const seen = new Set<string>();
  const latest = new Map(incoming.map((commitment) => [commitment.eventKey, commitment]));

  for (const commitment of latest.values()) {
    if (!calendarIds.has(commitment.calendarId) || !Number.isFinite(commitment.start) || !Number.isFinite(commitment.end)) {
      report.skipped += 1;
      continue;
    }
    seen.add(commitment.eventKey);
    const fields = normalised(commitment);
    const row: Doc<"externalCommitments"> | null =
      byKey.get(commitment.eventKey) ??
      (await ctx.db
        .query("externalCommitments")
        .withIndex("by_event_key", (q) => q.eq("eventKey", commitment.eventKey))
        .unique());
    if (!row) {
      await ctx.db.insert("externalCommitments", fields);
      report.inserted += 1;
      continue;
    }
    const { _id, _creationTime, ...current } = row;
    if (sameValue(current, fields)) {
      report.unchanged += 1;
      continue;
    }
    await ctx.db.replace("externalCommitments", _id, fields);
    report.updated += 1;
  }

  for (const row of inWindow) {
    if (seen.has(row.eventKey)) continue;
    await ctx.db.delete("externalCommitments", row._id);
    report.removed += 1;
  }
  return report;
};

const recordSync = async (ctx: MutationCtx, window: Window, syncedAt: number) => {
  const fields = { syncedAt, windowStart: window.start, windowEnd: window.end };
  const state = await ctx.db.query("calendarSync").first();
  if (state) await ctx.db.replace("calendarSync", state._id, fields);
  else await ctx.db.insert("calendarSync", fields);
};

export const applyWindow = workerMutation({
  args: {
    window: v.object({ start: v.number(), end: v.number() }),
    calendars: v.array(vCalendarIn),
    commitments: v.array(vCommitmentIn),
  },
  handler: Effect.fn("sync.applyWindow")(function* ({ window, calendars, commitments }) {
    const worker = yield* CurrentWorker;
    requireCapability(worker, "calendar");
    const valid = yield* Effect.fromResult(parseWindow(window));
    const calendarReport = yield* writing((ctx) => syncCalendars(ctx, calendars));
    const calendarIds = new Set(calendars.map((calendar) => calendar.calendarId));
    const commitmentReport = yield* writing((ctx) => syncCommitments(ctx, valid, commitments, calendarIds));
    const syncedAt = yield* Clock.currentTimeMillis;
    yield* writing((ctx) => recordSync(ctx, valid, syncedAt));
    return { calendars: calendarReport, commitments: commitmentReport } satisfies SyncReport;
  }, asWire),
});
