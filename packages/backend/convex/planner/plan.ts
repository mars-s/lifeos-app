import { v } from "convex/values";
import { Effect, Result } from "effect";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { changeMutation, ownerQuery, reading, recording } from "../platform/effect";
import { capacityDays } from "../calendar/capacity";
import { parseTimeZone, zonedMoment } from "../calendar/model";
import { addDays, type IsoDate, parseIsoDate } from "../../shared/date";
import { asWire } from "../../shared/result";
import { byDayPlan, dayLoad, dayShareCap, goalMinutesOf, MAX_GOAL_MINUTES, placeInDay } from "../../shared/plan";
import { uncreatedDates } from "../../shared/recurrence";
import { InvalidPlan, NotFound } from "./errors";
import { isPaused } from "./recurrence";
import { enrich, isLive } from "./rows";
import { homeSummary } from "./shape";
import { guessesFor } from "./smartEstimates";
import { byTodayOrder } from "./today";

const MAX_PLAN_DAYS = 31;
const PLAN_TASK_LIMIT = 1000;
const PLAN_BLOCK_LIMIT = 1000;
const MAX_DAY_TASKS = 500;
const PLAN_RULE_LIMIT = 500;

type PlanFault = (typeof InvalidPlan.fields.reason)["Type"];

const invalid = (reason: PlanFault) => new InvalidPlan({ reason });

const parseDays = (days: number) => {
  const parsed: Result.Result<number, InvalidPlan> =
    Number.isInteger(days) && days >= 1 && days <= MAX_PLAN_DAYS ? Result.succeed(days) : Result.fail(invalid("range"));
  return parsed;
};

const parsePlanDate = (date: string) => parseIsoDate(date).pipe(Result.mapError(() => invalid("range")));

const parseZone = (timeZone: string) => {
  const zone: Result.Result<string, unknown> = parseTimeZone(timeZone);
  return Result.mapError(zone, () => invalid("time_zone"));
};

const isOpen = (task: Doc<"tasks">) => isLive(task) && task.status.kind === "open";

const openBlocksBetween = async (ctx: QueryCtx, from: number, to: number, known: ReadonlyMap<Id<"tasks">, Doc<"tasks">>) => {
  const blocks = await ctx.db
    .query("workBlocks")
    .withIndex("by_removed_start", (q) => q.eq("removedAt", undefined).gte("start", from).lt("start", to))
    .take(PLAN_BLOCK_LIMIT);
  const strangers = [...new Set(blocks.map((block) => block.taskId))].filter((id) => !known.has(id));
  const loaded = await Promise.all(strangers.map((id) => ctx.db.get("tasks", id)));
  const open = new Set<Id<"tasks">>([...known.keys(), ...loaded.flatMap((task) => (task && isOpen(task) ? [task._id] : []))]);
  return blocks.filter((block) => open.has(block.taskId));
};

const ghostsBetween = async (ctx: QueryCtx, from: IsoDate, last: IsoDate) => {
  const rules = await ctx.db
    .query("recurrenceRules")
    .withIndex("by_next", (q) => q.eq("next.kind", "due").lte("next.date", last))
    .take(PLAN_RULE_LIMIT);
  const candidates = rules.flatMap((rule) => {
    const dates = uncreatedDates(rule, from, last);
    return dates.length > 0 ? [{ rule, dates }] : [];
  });
  const paused = await Promise.all(candidates.map(({ rule }) => isPaused(ctx, rule)));
  const showing = candidates.filter((_candidate, index) => !paused[index]);
  const homes = await Promise.all(showing.map(({ rule }) => homeSummary(ctx, rule.task.parent)));
  return showing.flatMap(({ rule, dates }, index) =>
    dates.map((date) => ({
      key: `${rule._id}:${date}`,
      ruleId: rule._id,
      date,
      title: rule.task.title,
      estimateMinutes: rule.task.estimateMinutes,
      schedule: rule.schedule,
      end: rule.end,
      ...homes[index],
    })),
  );
};

export const loadWeek = async (ctx: QueryCtx, from: IsoDate, days: number, timeZone: string) => {
  const dates = Array.from({ length: days }, (_, index) => addDays(from, index));
  const last = dates.at(-1) ?? from;
  const starts = [...dates, addDays(last, 1)].map((date) => zonedMoment(date, 0, timeZone));
  const scheduled = await ctx.db
    .query("tasks")
    .withIndex("by_trashed_status_when", (q) =>
      q.eq("trashedAt", undefined).eq("status.kind", "open").eq("when.kind", "scheduled").lte("when.date", last),
    )
    .take(PLAN_TASK_LIMIT);
  const dayOf = (task: Doc<"tasks">) => (task.when.kind === "scheduled" && task.when.date > from ? task.when.date : from);
  const perDay = dates.map((date) => scheduled.filter((task) => dayOf(task) === date).toSorted(byDayPlan(date, byTodayOrder)));
  const [rows, blocks, capacity, plans, guesses, ghosts] = await Promise.all([
    enrich(ctx, perDay.flat()),
    openBlocksBetween(ctx, starts[0] ?? 0, starts.at(-1) ?? 0, new Map(scheduled.map((task) => [task._id, task]))),
    capacityDays(ctx, from, days, timeZone),
    ctx.db
      .query("dayPlans")
      .withIndex("by_date", (q) => q.gte("date", from).lte("date", last))
      .take(MAX_PLAN_DAYS),
    guessesFor(ctx, perDay.flat()),
    ghostsBetween(ctx, from, last),
  ]);
  const goals = new Map(plans.map((plan) => [plan.date, plan.goalMinutes]));
  const guessed = new Map<string, number>(guesses.map((guess) => [guess.taskId, guess.minutes]));
  let taken = 0;
  return {
    from,
    workingHours: capacity.workingHours,
    guesses,
    days: dates.map((date, index) => {
      const tasks = rows.slice(taken, taken + (perDay[index]?.length ?? 0));
      taken += tasks.length;
      const dayBlocks = blocks.filter((block) => block.start >= (starts[index] ?? 0) && block.start < (starts[index + 1] ?? 0));
      const free = capacity.days[index];
      const freeMinutes = free?.freeMinutes ?? 0;
      const goal = goals.get(date);
      const goalMinutes = goalMinutesOf(freeMinutes, goal);
      const dayGhosts = ghosts.filter((ghost) => ghost.date === date);
      const { slices, plannedMinutes, guessedMinutes, unestimated } = dayLoad(
        [...tasks, ...dayGhosts.map((ghost) => ({ _id: ghost.key, estimateMinutes: ghost.estimateMinutes }))],
        dayBlocks,
        (taskId) => guessed.get(taskId),
        dayShareCap(goalMinutes),
      );
      return {
        date,
        tasks,
        ghosts: dayGhosts,
        slices,
        plannedMinutes,
        guessedMinutes,
        unestimated,
        goalMinutes,
        goalSet: goal !== undefined,
        workingMinutes: free?.workingMinutes ?? 0,
        busyMinutes: free?.busyMinutes ?? 0,
        freeMinutes,
      };
    }),
  };
};

export const week = ownerQuery({
  args: { from: v.string(), days: v.number(), timeZone: v.string() },
  handler: (args) =>
    asWire(
      Effect.gen(function* () {
        const [from, days, timeZone] = yield* Effect.fromResult(Result.all([parsePlanDate(args.from), parseDays(args.days), parseZone(args.timeZone)]));
        return yield* reading((ctx) => loadWeek(ctx, from, days, timeZone));
      }),
    ),
});

const parseSpot = <P extends { order: Id<"tasks">[]; at: number }>(place: P) => {
  const { order, at } = place;
  const parsed: Result.Result<P, InvalidPlan> =
    Number.isInteger(at) && at >= 0 && at <= order.length && order.length < MAX_DAY_TASKS && new Set(order).size === order.length
      ? Result.succeed(place)
      : Result.fail(invalid("order"));
  return parsed;
};

export const parseNewPlace = (place: { date: string; order: Id<"tasks">[]; at: number }) =>
  Result.flatMap(parsePlanDate(place.date), (date) => parseSpot({ ...place, date }));

export const placeOnDay = Effect.fn("plan.placeOnDay")(function* (
  task: Doc<"tasks">,
  date: IsoDate,
  order: Id<"tasks">[],
  evening: boolean,
) {
  if (!order.includes(task._id) || order.length > MAX_DAY_TASKS || new Set(order).size !== order.length) return yield* invalid("order");
  const loaded = yield* reading((ctx) => Promise.all(order.map((id) => (id === task._id ? task : ctx.db.get("tasks", id)))));
  const present = loaded.flatMap((other) => (other ? [other] : []));
  const others = present.filter((other) => other._id !== task._id);
  const marks = placeInDay(others, task._id, present.findIndex((other) => other._id === task._id), date);
  let moved = 0;
  for (const mark of marks) {
    const fields = mark.taskId === task._id ? { plan: mark.plan, when: { kind: "scheduled" as const, date, evening } } : { plan: mark.plan };
    if (yield* recording((record) => record.patch("tasks", mark.taskId, fields))) moved += 1;
  }
  return { moved };
});

export const place = changeMutation({
  action: "plan.place",
  args: { taskId: v.id("tasks"), date: v.string(), order: v.array(v.id("tasks")), evening: v.optional(v.boolean()) },
  handler: Effect.fn("plan.place")(function* ({ taskId, date, order, evening }) {
    const day = yield* Effect.fromResult(parsePlanDate(date));
    const task = yield* reading((ctx) => ctx.db.get("tasks", taskId));
    if (!task) return yield* new NotFound({ table: "tasks", id: taskId });
    return yield* placeOnDay(task, day, order, evening ?? (task.when.kind === "scheduled" && task.when.evening));
  }),
});

const parseGoal = (minutes: number | null) => {
  const parsed: Result.Result<number | undefined, InvalidPlan> =
    minutes === null || (Number.isInteger(minutes) && minutes >= 0 && minutes <= MAX_GOAL_MINUTES)
      ? Result.succeed(minutes ?? undefined)
      : Result.fail(invalid("goal"));
  return parsed;
};

export const setGoal = changeMutation({
  action: "plan.goal",
  args: { date: v.string(), minutes: v.union(v.number(), v.null()) },
  handler: Effect.fn("plan.setGoal")(function* (args) {
    const [date, goalMinutes] = yield* Effect.fromResult(Result.all([parsePlanDate(args.date), parseGoal(args.minutes)]));
    const row = yield* reading((ctx) =>
      ctx.db
        .query("dayPlans")
        .withIndex("by_date", (q) => q.eq("date", date))
        .unique(),
    );
    if (row) return { changed: yield* recording((record) => record.patch("dayPlans", row._id, { goalMinutes })) };
    if (goalMinutes === undefined) return { changed: false };
    yield* recording((record) => record.insert("dayPlans", { date, goalMinutes }));
    return { changed: true };
  }),
});
