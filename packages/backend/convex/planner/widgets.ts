import { v } from "convex/values";
import { Effect, Result } from "effect";
import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { ownerQuery, reading } from "../platform/effect";
import { featureReady } from "../platform/features";
import { commitmentsBetween } from "../calendar/commitments";
import { blocksTime, parseTimeZone, zonedMoment } from "../calendar/model";
import { chosenTrip } from "../places/trips";
import { addDays, type IsoDate } from "../../shared/date";
import { fromNeverthrow } from "../../shared/effect/bridge";
import { parseIsoDate } from "../../shared/effect/date";
import { asWire } from "../../shared/effect/wire";
import { InvalidPlan } from "./errors";
import { currentFocus } from "./focus";
import { loadWeek } from "./plan";
import { compare, enrich, isLive } from "./rows";
import { openTodayTasks } from "./today";

const WEEK_DAYS = 7;
const DEADLINE_DAYS = 28;
const TASKS_SHOWN = 8;
const DEADLINES_SHOWN = 3;
const BLOCK_LIMIT = 100;
const DEADLINE_LIMIT = 200;
const INBOX_LIMIT = 1000;
const TRIP_LIMIT = 12;

type AreaSummary = { readonly title: string; readonly colour: Doc<"areas">["colour"] } | undefined;

const areaOf = (area: AreaSummary) => (area ? { name: area.title, colour: area.colour } : undefined);

const blocksOn = async (ctx: QueryCtx, from: number, to: number) => {
  const blocks = await ctx.db
    .query("workBlocks")
    .withIndex("by_removed_start", (q) => q.eq("removedAt", undefined).gte("start", from).lt("start", to))
    .take(BLOCK_LIMIT);
  const ids = [...new Set(blocks.map((block) => block.taskId))];
  const tasks = (await Promise.all(ids.map((id) => ctx.db.get("tasks", id)))).flatMap((task) => (task && isLive(task) ? [task] : []));
  const rows = new Map((await enrich(ctx, tasks)).map((row) => [row._id, row]));
  const tripsOn = await featureReady(ctx, "places");
  const trips = new Map(
    await Promise.all(
      (tripsOn ? ids.slice(0, TRIP_LIMIT) : []).map(async (id) => [id, await chosenTrip(ctx, id)] as const),
    ),
  );
  return blocks.flatMap(({ _id, taskId, start, minutes, done }) => {
    const task = rows.get(taskId);
    if (!task) return [];
    const trip = trips.get(taskId);
    return [
      {
        id: _id,
        taskId,
        title: task.title,
        start,
        minutes,
        done: done || task.status.kind === "completed",
        area: areaOf(task.area),
        ...(trip ? { trip: { place: trip.name, minutes: Math.round(trip.seconds / 60) } } : {}),
      },
    ];
  });
};

const deadlinesFrom = async (ctx: QueryCtx, date: IsoDate) => {
  const due = await ctx.db
    .query("tasks")
    .withIndex("by_trashed_status_deadline", (q) =>
      q.eq("trashedAt", undefined).eq("status.kind", "open").gte("deadline", date).lte("deadline", addDays(date, DEADLINE_DAYS)),
    )
    .take(DEADLINE_LIMIT);
  return due.flatMap((task) => (task.deadline ? [{ task, date: task.deadline }] : []));
};

const inboxCount = async (ctx: QueryCtx) =>
  (
    await ctx.db
      .query("tasks")
      .withIndex("by_trashed_status_when", (q) => q.eq("trashedAt", undefined).eq("status.kind", "open").eq("when.kind", "inbox"))
      .take(INBOX_LIMIT)
  ).length;

const loadSnapshot = async (ctx: QueryCtx, date: IsoDate, timeZone: string) => {
  const dayStart = zonedMoment(date, 0, timeZone);
  const dayEnd = zonedMoment(addDays(date, 1), 0, timeZone);
  const [week, today, blocks, commitments, focus, deadlines, brainDump] = await Promise.all([
    loadWeek(ctx, date, WEEK_DAYS, timeZone),
    openTodayTasks(ctx, date),
    blocksOn(ctx, dayStart, dayEnd),
    commitmentsBetween(ctx, dayStart, dayEnd),
    currentFocus(ctx),
    deadlinesFrom(ctx, date),
    inboxCount(ctx),
  ]);
  const first = week.days[0];
  const shown = await enrich(ctx, today.slice(0, TASKS_SHOWN));
  const nearest = deadlines.toSorted((a, b) => compare(a.date, b.date) || compare(a.task.order, b.task.order)).slice(0, DEADLINES_SHOWN);
  const nearestRows = new Map((await enrich(ctx, nearest.map(({ task }) => task))).map((row) => [row._id, row]));
  const dueOn = (day: string) => deadlines.filter((deadline) => deadline.date === day).length;
  return {
    date,
    timeZone,
    workingHours: week.workingHours,
    capacityMinutes: first?.goalMinutes ?? 0,
    plannedMinutes: first?.plannedMinutes ?? 0,
    tasksLeft: today.length,
    tasks: shown.map((task) => ({
      id: task._id,
      title: task.title,
      area: areaOf(task.area),
      ...(task.estimateMinutes === undefined ? {} : { estimateMinutes: task.estimateMinutes }),
    })),
    blocks: blocks.toSorted((a, b) => a.start - b.start),
    commitments: commitments
      .filter((commitment) => blocksTime(commitment) && !commitment.allDay)
      .map(({ _id, title, start, end }) => ({ id: _id, title, start, end }))
      .toSorted((a, b) => a.start - b.start),
    focus: focus && {
      taskId: focus.taskId,
      title: focus.title,
      kind: focus.kind,
      start: focus.start,
      pausedMs: focus.pausedMs,
      pausedAt: focus.state.kind === "paused" ? focus.state.at : undefined,
      plannedMinutes: focus.plannedMinutes,
      round: focus.pomodoro?.round,
      colour: focus.colour,
    },
    week: week.days.map((day) => ({
      date: day.date,
      capacityMinutes: day.goalMinutes,
      plannedMinutes: day.plannedMinutes,
      slices: day.slices.map((slice) => ({ id: slice.id, colour: slice.area?.colour, minutes: slice.minutes })),
      deadlines: dueOn(day.date),
    })),
    deadlines: nearest.map(({ task, date: due }) => ({
      id: task._id,
      title: task.title,
      date: due,
      area: areaOf(nearestRows.get(task._id)?.area),
    })),
    brainDump,
  };
};

export type WidgetSnapshot = Awaited<ReturnType<typeof loadSnapshot>>;

const parseZone = (timeZone: string) => {
  const zone: Result.Result<string, unknown> = fromNeverthrow(parseTimeZone(timeZone));
  return Result.mapError(zone, () => new InvalidPlan({ reason: "time_zone" }));
};

export const snapshot = ownerQuery({
  args: { date: v.string(), timeZone: v.string() },
  handler: (args) =>
    asWire(
      Effect.gen(function* () {
        const [date, timeZone] = yield* Effect.fromResult(
          Result.all([Result.mapError(parseIsoDate(args.date), () => new InvalidPlan({ reason: "range" })), parseZone(args.timeZone)]),
        );
        return yield* reading((ctx) => loadSnapshot(ctx, date, timeZone));
      }),
    ),
});
