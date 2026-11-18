import { v } from "convex/values";
import { Result, err, ok } from "neverthrow";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { ownerQuery } from "../platform/access";
import { changeMutation } from "../platform/change";
import { capacityDays } from "../calendar/capacity";
import { parseTimeZone, zonedMoment } from "../calendar/model";
import { addDays, parseIsoDate, type IsoDate } from "../../shared/date";
import { byDayPlan, placeInDay, plannedMinutes } from "../../shared/plan";
import { serialise } from "../../shared/result";
import type { PlannerError } from "./model";
import { enrich, isLive } from "./rows";
import { byTodayOrder } from "./today";

const MAX_PLAN_DAYS = 31;
const PLAN_TASK_LIMIT = 1000;
const PLAN_BLOCK_LIMIT = 1000;
const MAX_DAY_TASKS = 500;

const invalid = (reason: "range" | "time_zone" | "order") => ({ kind: "invalid_plan", reason }) satisfies PlannerError;

const parseDays = (days: number) =>
  Number.isInteger(days) && days >= 1 && days <= MAX_PLAN_DAYS ? ok<number, PlannerError>(days) : err<number, PlannerError>(invalid("range"));

const parsePlanDate = (date: string) => parseIsoDate(date).mapErr<PlannerError>(() => invalid("range"));

const parseZone = (timeZone: string) => parseTimeZone(timeZone).mapErr<PlannerError>(() => invalid("time_zone"));

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

const loadWeek = async (ctx: QueryCtx, from: IsoDate, days: number, timeZone: string) => {
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
  const [rows, blocks, capacity] = await Promise.all([
    enrich(ctx, perDay.flat()),
    openBlocksBetween(ctx, starts[0] ?? 0, starts.at(-1) ?? 0, new Map(scheduled.map((task) => [task._id, task]))),
    capacityDays(ctx, from, days, timeZone),
  ]);
  let taken = 0;
  return {
    from,
    workingHours: capacity.workingHours,
    days: dates.map((date, index) => {
      const tasks = rows.slice(taken, taken + (perDay[index]?.length ?? 0));
      taken += tasks.length;
      const dayBlocks = blocks.filter((block) => block.start >= (starts[index] ?? 0) && block.start < (starts[index + 1] ?? 0));
      const free = capacity.days[index];
      return {
        date,
        tasks,
        plannedMinutes: plannedMinutes(tasks, dayBlocks),
        workingMinutes: free?.workingMinutes ?? 0,
        busyMinutes: free?.busyMinutes ?? 0,
        freeMinutes: free?.freeMinutes ?? 0,
      };
    }),
  };
};

export const week = ownerQuery({
  args: { from: v.string(), days: v.number(), timeZone: v.string() },
  handler: async (ctx, args) => {
    const parsed = Result.combine([parsePlanDate(args.from), parseDays(args.days), parseZone(args.timeZone)]);
    return serialise(await parsed.asyncMap(([from, days, timeZone]) => loadWeek(ctx, from, days, timeZone)));
  },
});

export const place = changeMutation({
  action: "plan.place",
  args: { taskId: v.id("tasks"), date: v.string(), order: v.array(v.id("tasks")) },
  handler: async (ctx, { taskId, date, order }, record) => {
    const index = order.indexOf(taskId);
    const day = parsePlanDate(date);
    if (day.isErr()) return err<{ moved: number }, PlannerError>(day.error);
    if (index === -1 || order.length > MAX_DAY_TASKS || new Set(order).size !== order.length)
      return err<{ moved: number }, PlannerError>(invalid("order"));
    const task = await ctx.db.get("tasks", taskId);
    if (!task) return err<{ moved: number }, PlannerError>({ kind: "not_found", table: "tasks", id: taskId });
    const loaded = await Promise.all(order.map((id) => (id === taskId ? task : ctx.db.get("tasks", id))));
    const present = loaded.flatMap((other) => (other ? [other] : []));
    const others = present.filter((other) => other._id !== taskId);
    const marks = placeInDay(others, taskId, present.findIndex((other) => other._id === taskId), day.value);
    const evening = task.when.kind === "scheduled" && task.when.evening;
    let moved = 0;
    for (const mark of marks) {
      const fields = mark.taskId === taskId ? { plan: mark.plan, when: { kind: "scheduled" as const, date: day.value, evening } } : { plan: mark.plan };
      if (await record.patch("tasks", mark.taskId, fields)) moved += 1;
    }
    return ok<{ moved: number }, PlannerError>({ moved });
  },
});
