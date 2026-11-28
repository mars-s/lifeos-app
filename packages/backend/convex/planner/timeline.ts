import { v } from "convex/values";
import { err, ok, Result } from "neverthrow";
import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { ownerQuery } from "../platform/access";
import { featureReady } from "../platform/features";
import { capacityDays } from "../calendar/capacity";
import { commitmentsBetween } from "../calendar/commitments";
import { blocksTime, MINUTE_MS, parseTimeZone, zonedDate, zonedMoment } from "../calendar/model";
import { chosenTrip } from "../places/trips";
import { addDays, parseIsoDate, type IsoDate } from "../../shared/date";
import { standInEnergy } from "../../shared/energyStandIn";
import { dayShareCap } from "../../shared/plan";
import { serialise } from "../../shared/result";
import { inkLoad, PREDICT_DAYS, predictDay } from "../../shared/timeline";
import type { PlannerError } from "./model";
import { enrich, isLive } from "./rows";
import { loadWeek } from "./plan";

const MAX_TIMELINE_DAYS = 14;
const BLOCK_LIMIT = 1000;
const DAY_MINUTES = 24 * 60;

const invalid = (reason: "range" | "time_zone") => ({ kind: "invalid_plan", reason }) satisfies PlannerError;

const parseDays = (days: number) =>
  Number.isInteger(days) && days >= 1 && days <= MAX_TIMELINE_DAYS ? ok<number, PlannerError>(days) : err<number, PlannerError>(invalid("range"));

const parseNow = (now: number) => (Number.isSafeInteger(now) && now > 0 ? ok<number, PlannerError>(now) : err<number, PlannerError>(invalid("range")));

const blocksBetween = async (ctx: QueryCtx, from: number, to: number) => {
  const blocks = await ctx.db
    .query("workBlocks")
    .withIndex("by_removed_start", (q) => q.eq("removedAt", undefined).gte("start", from).lt("start", to))
    .take(BLOCK_LIMIT);
  const ids = [...new Set(blocks.map((block) => block.taskId))];
  const tasks = (await Promise.all(ids.map((id) => ctx.db.get("tasks", id)))).flatMap((task) => (task && isLive(task) ? [task] : []));
  const rows = new Map((await enrich(ctx, tasks)).map((row) => [row._id, row]));
  return blocks.flatMap((block) => {
    const task = rows.get(block.taskId);
    return task ? [{ ...block, task }] : [];
  });
};

const tripsFor = async (ctx: QueryCtx, taskIds: readonly Id<"tasks">[]) => {
  if (!(await featureReady(ctx, "places"))) return new Map<Id<"tasks">, { place: string; minutes: number }>();
  const trips = await Promise.all(taskIds.map((taskId) => chosenTrip(ctx, taskId)));
  return new Map(
    taskIds.flatMap((taskId, index) => {
      const trip = trips[index];
      return trip ? [[taskId, { place: trip.name, minutes: Math.max(1, Math.ceil(trip.seconds / 60)) }] as const] : [];
    }),
  );
};

export const loadTimeline = async (ctx: QueryCtx, from: IsoDate, days: number, timeZone: string, now: number) => {
  const dates = Array.from({ length: days }, (_, index) => addDays(from, index));
  const today = zonedDate(now, timeZone) as IsoDate;
  const starts = [...dates, addDays(dates.at(-1) ?? from, 1)].map((date) => zonedMoment(date, 0, timeZone));
  const rangeStart = starts[0] ?? 0;
  const rangeEnd = starts.at(-1) ?? rangeStart;
  const [blocks, commitments, plan, capacity] = await Promise.all([
    blocksBetween(ctx, rangeStart, rangeEnd),
    commitmentsBetween(ctx, rangeStart, rangeEnd),
    loadWeek(ctx, today, PREDICT_DAYS, timeZone),
    capacityDays(ctx, from, days, timeZone),
  ]);
  const predicting = new Map(plan.days.map((day) => [day.date as string, day]));
  const guesses = new Map<string, number>(plan.guesses.map((guess) => [guess.taskId, guess.minutes]));
  const taskIds = [...new Set([...blocks.map((block) => block.taskId), ...plan.days.flatMap((day) => day.tasks.map((task) => task._id))])];
  const trips = await tripsFor(ctx, taskIds);
  const energy = new Map(standInEnergy(from, days, today).map((day) => [day.date as string, day]));
  const { startMinute, endMinute } = plan.workingHours;

  return {
    today,
    workingHours: plan.workingHours,
    days: dates.map((date, index) => {
      const dayStart = starts[index] ?? 0;
      const dayEnd = starts[index + 1] ?? dayStart;
      const minuteOf = (instant: number) => Math.max(0, Math.min(DAY_MINUTES, Math.round((instant - dayStart) / MINUTE_MS)));
      const dayBlocks = blocks
        .filter((block) => block.start >= dayStart && block.start < dayEnd)
        .map((block) => ({
          _id: block._id,
          taskId: block.taskId,
          start: block.start,
          minutes: block.minutes,
          done: block.done || block.task.status.kind !== "open",
          title: block.task.title,
          area: block.task.area,
          trip: trips.get(block.taskId) ?? null,
        }));
      const dayCommitments = commitments
        .filter((row) => row.start < dayEnd && row.end > dayStart)
        .map((row) => ({
          _id: row._id,
          title: row.title,
          start: row.start,
          end: row.end,
          allDay: row.allDay,
          quiet: !blocksTime(row),
          calendar: row.calendar,
        }));
      const day = predicting.get(date);
      const window = { start: date === today ? Math.max(startMinute, minuteOf(now)) : startMinute, end: endMinute };
      const busy = [
        ...dayCommitments.flatMap((row) => (row.allDay || row.quiet ? [] : [{ start: minuteOf(row.start), end: minuteOf(row.end) }])),
        ...dayBlocks.map((block) => ({ start: minuteOf(block.start), end: minuteOf(block.start) + block.minutes })),
      ];
      const tasks = day?.tasks.filter((task) => task.status.kind === "open") ?? [];
      const dayEnergy = energy.get(date);
      const { placed, unfit } = day
        ? predictDay({
            tasks,
            boxed: new Set(dayBlocks.map((block) => block.taskId as string)),
            guessOf: (taskId) => guesses.get(taskId),
            travelOf: (taskId) => trips.get(taskId as Id<"tasks">)?.minutes ?? 0,
            busy,
            window,
            cap: dayShareCap(day.goalMinutes),
            energy: dayEnergy && dayEnergy.kind !== "none" && dayEnergy.kind !== "learning" ? dayEnergy : null,
          })
        : { placed: [], unfit: [] };
      const byId = new Map(tasks.map((task) => [task._id as string, task]));
      const predictions = placed.flatMap((pick) => {
        const task = byId.get(pick.taskId);
        return task
          ? [
              {
                taskId: task._id,
                title: task.title,
                area: task.area,
                start: zonedMoment(date, pick.start, timeZone),
                minutes: pick.minutes,
                guess: pick.guess,
                fit: pick.fit ?? null,
                trip: trips.get(task._id) ?? null,
              },
            ]
          : [];
      });
      return {
        date,
        predicts: day !== undefined,
        blocks: dayBlocks,
        commitments: dayCommitments,
        predictions,
        unfit: unfit.map((task) => task._id),
        capacity: capacity.days[index] ?? null,
        load: inkLoad(dayBlocks, predictions),
        energy: dayEnergy ?? null,
      };
    }),
  };
};

export const days = ownerQuery({
  args: { from: v.string(), days: v.number(), timeZone: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const parsed = Result.combine([
      parseIsoDate(args.from).mapErr<PlannerError>(() => invalid("range")),
      parseDays(args.days),
      parseTimeZone(args.timeZone).mapErr<PlannerError>(() => invalid("time_zone")),
      parseNow(args.now),
    ]);
    return serialise(await parsed.asyncMap(([from, count, timeZone, now]) => loadTimeline(ctx, from, count, timeZone, now)));
  },
});
