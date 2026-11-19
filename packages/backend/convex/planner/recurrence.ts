import { v } from "convex/values";
import { Result, err, ok } from "neverthrow";
import { internal } from "../_generated/api";
import { internalMutation, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { ownerQuery } from "../platform/access";
import { sameValue, startRecording, type Recorder } from "../platform/activity";
import { changeMutation } from "../platform/change";
import type { Actor } from "../platform/tables";
import { addDays, laterOf, parseIsoDate, type IsoDate } from "../../shared/date";
import {
  afterCompletionDate,
  firstAfter,
  firstOnOrAfter,
  following,
  localDateIn,
  parseEnd,
  parseSchedule,
  parseTimeZone,
  withinEnd,
  type AfterCompletion,
  type RepeatEnd,
  type RepeatNext,
  type Schedule,
} from "../../shared/recurrence";
import { serialise } from "../../shared/result";
import { liveHome, load, type PlannerError } from "./model";
import { createFromShape, homeSummary, scheduledDate, snapshotTask } from "./shape";
import { vRepeatEnd, vSchedule, type TaskShape, type When } from "./tables";

const RULE_BATCH = 100;
const UPCOMING_LIMIT = 500;
const MAX_UPCOMING_DAYS = 366;

const RECURRENCE = { kind: "recurrence" } as const satisfies Actor;
const ENDED = { kind: "ended" } as const satisfies RepeatNext;
const WAITING = { kind: "waiting" } as const satisfies RepeatNext;

type Rule = Doc<"recurrenceRules">;
type RuleClock = Pick<Rule, "end" | "count" | "lastDate" | "timeZone">;
type Terms = {
  readonly schedule: Schedule;
  readonly end: RepeatEnd;
  readonly timeZone: string;
  readonly today: IsoDate;
  readonly task: Doc<"tasks">;
  readonly shape: TaskShape;
};

const dueWithin = (end: RepeatEnd, date: IsoDate | null, count: number) =>
  date && withinEnd(end, date, count) ? ({ kind: "due", date } satisfies RepeatNext) : ENDED;

const nextAfterInstance = (schedule: AfterCompletion, rule: RuleClock, instance: Doc<"tasks"> | null, today: IsoDate) => {
  const status = instance?.status;
  if (status?.kind === "open") return WAITING;
  const closedOn = status ? localDateIn(rule.timeZone, status.at) : today;
  const date = laterOf(afterCompletionDate(schedule, closedOn), addDays(rule.lastDate as IsoDate, 1));
  return dueWithin(rule.end, date, rule.count);
};

const instanceOn = (ctx: QueryCtx, ruleId: Id<"recurrenceRules">, date: string) =>
  ctx.db
    .query("tasks")
    .withIndex("by_repeat", (q) => q.eq("repeat.ruleId", ruleId).eq("repeat.date", date))
    .first();

const latestDue = (rule: Rule, first: IsoDate, today: IsoDate) => {
  let latest: IsoDate | null = null;
  let date: IsoDate | null = first;
  while (date && date <= today && withinEnd(rule.end, date, rule.count)) {
    latest = date;
    date = firstAfter(rule.schedule, rule.anchor as IsoDate, date);
  }
  return latest;
};

const settle = async (ctx: MutationCtx, record: Recorder, ruleId: Id<"recurrenceRules">, now: number) => {
  const rule = await ctx.db.get("recurrenceRules", ruleId);
  if (rule?.next.kind !== "due") return false;
  const today = localDateIn(rule.timeZone, now);
  if (rule.next.date > today) return false;
  const date = latestDue(rule, rule.next.date as IsoDate, today);
  if (!date) return record.patch("recurrenceRules", ruleId, { next: ENDED });
  const existing = await instanceOn(ctx, ruleId, date);
  const created = existing
    ? null
    : await createFromShape(ctx, record, rule.task, {
        when: { kind: "scheduled", date, evening: rule.evening },
        date,
        parent: await liveHome(ctx, rule.task.parent),
        repeat: { ruleId, date },
      });
  const instance = existing ?? (created ? await ctx.db.get("tasks", created) : null);
  const count = existing ? rule.count : rule.count + 1;
  const next =
    rule.schedule.kind === "afterCompletion"
      ? nextAfterInstance(rule.schedule, { ...rule, count, lastDate: date }, instance, today)
      : dueWithin(rule.end, firstAfter(rule.schedule, rule.anchor as IsoDate, date), count);
  return record.patch("recurrenceRules", ruleId, { lastDate: date, count, next });
};

export const generate = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const horizon = addDays(localDateIn("UTC", now), 1);
    const rules = await ctx.db
      .query("recurrenceRules")
      .withIndex("by_next", (q) => q.eq("next.kind", "due").lte("next.date", horizon))
      .take(RULE_BATCH);
    const settled = [];
    for (const rule of rules) settled.push(await settle(ctx, startRecording(ctx, RECURRENCE, "recurrence.generate"), rule._id, now));
    if (rules.length === RULE_BATCH && settled.some(Boolean)) {
      await ctx.scheduler.runAfter(0, internal.planner.recurrence.generate, {});
    }
    return null;
  },
});

const afterCompletionStart = (schedule: AfterCompletion, { end, timeZone, today, task }: Terms) => ({
  anchor: today,
  date: today,
  when: task.when,
  next: nextAfterInstance(schedule, { end, timeZone, count: 1, lastDate: today }, task, today),
});

const calendarStart = (schedule: Schedule, { end, today, task }: Terms, evening: boolean) => {
  const base = laterOf(today, scheduledDate(task.when) ?? today);
  const date = firstOnOrAfter(schedule, base, base);
  return date
    ? {
        anchor: base,
        date,
        when: { kind: "scheduled", date, evening } satisfies When,
        next: dueWithin(end, firstAfter(schedule, base, date), 1),
      }
    : null;
};

const startRule = async (ctx: MutationCtx, record: Recorder, terms: Terms) => {
  const { schedule, end, timeZone, task, shape } = terms;
  const evening = task.when.kind === "scheduled" && task.when.evening;
  const plan = schedule.kind === "afterCompletion" ? afterCompletionStart(schedule, terms) : calendarStart(schedule, terms, evening);
  if (!plan || !withinEnd(end, plan.date, 0)) {
    return err<Id<"recurrenceRules">, PlannerError>({ kind: "invalid_schedule", reason: "end" });
  }
  const { anchor, date, when, next } = plan;
  const ruleId = await record.insert("recurrenceRules", { schedule, end, task: shape, evening, timeZone, anchor, next, lastDate: date, count: 1 });
  await record.patch("tasks", task._id, { when, repeat: { ruleId, date } });
  return ok<Id<"recurrenceRules">, PlannerError>(ruleId);
};

const reviseRule = async (ctx: MutationCtx, record: Recorder, rule: Rule, terms: Terms) => {
  const { schedule, end, timeZone, today, task, shape } = terms;
  const from = laterOf(today, addDays(rule.lastDate as IsoDate, 1));
  const anchor = sameValue(schedule, rule.schedule) ? (rule.anchor as IsoDate) : from;
  const next =
    schedule.kind === "afterCompletion"
      ? nextAfterInstance(schedule, { ...rule, end, timeZone }, await instanceOn(ctx, rule._id, rule.lastDate), today)
      : dueWithin(end, firstOnOrAfter(schedule, anchor, from), rule.count);
  await record.patch("recurrenceRules", rule._id, {
    schedule,
    end,
    task: shape,
    evening: task.when.kind === "scheduled" && task.when.evening,
    timeZone,
    anchor,
    next,
  });
  return ok<Id<"recurrenceRules">, PlannerError>(rule._id);
};

export const setRepeat = changeMutation({
  action: "recurrence.set",
  args: { taskId: v.id("tasks"), schedule: vSchedule, end: vRepeatEnd, timeZone: v.string() },
  handler: async (ctx, args, record) => {
    const task = await load(ctx, "tasks", args.taskId);
    const terms = Result.combine([parseSchedule(args.schedule), parseEnd(args.end), parseTimeZone(args.timeZone)]);
    if (task.isErr()) return err<{ ruleId: Id<"recurrenceRules"> }, PlannerError>(task.error);
    if (terms.isErr()) return err<{ ruleId: Id<"recurrenceRules"> }, PlannerError>(terms.error);
    const [schedule, end, timeZone] = terms.value;
    const now = Date.now();
    const today = localDateIn(timeZone, now);
    const shape = await snapshotTask(ctx, task.value, today);
    const full = { schedule, end, timeZone, today, task: task.value, shape };
    const current = task.value.repeat ? await ctx.db.get("recurrenceRules", task.value.repeat.ruleId) : null;
    const ruleId =
      current && current.next.kind !== "ended"
        ? await reviseRule(ctx, record, current, full)
        : await startRule(ctx, record, full);
    if (ruleId.isErr()) return err<{ ruleId: Id<"recurrenceRules"> }, PlannerError>(ruleId.error);
    await settle(ctx, record, ruleId.value, now);
    return ok<{ ruleId: Id<"recurrenceRules"> }, PlannerError>({ ruleId: ruleId.value });
  },
});

export const stopRepeat = changeMutation({
  action: "recurrence.stop",
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }, record) => {
    const task = await load(ctx, "tasks", taskId);
    if (task.isErr()) return err<{ changed: boolean }, PlannerError>(task.error);
    const ruleId = task.value.repeat?.ruleId;
    return ok<{ changed: boolean }, PlannerError>({
      changed: ruleId ? await record.patch("recurrenceRules", ruleId, { next: ENDED }) : false,
    });
  },
});

export const skip = changeMutation({
  action: "recurrence.skip",
  args: { ruleId: v.id("recurrenceRules"), date: v.string() },
  handler: async (ctx, { ruleId, date }, record) => {
    const rule = await load(ctx, "recurrenceRules", ruleId);
    if (rule.isErr()) return err<{ next: RepeatNext }, PlannerError>(rule.error);
    const { next, schedule, anchor, end, count } = rule.value;
    if (next.kind !== "due" || next.date !== date) {
      return err<{ next: RepeatNext }, PlannerError>({ kind: "stale_occurrence", ruleId, date });
    }
    await record.patch("recurrenceRules", ruleId, { next: dueWithin(end, following(schedule, anchor as IsoDate, date as IsoDate), count) });
    await settle(ctx, record, ruleId, Date.now());
    const after = await ctx.db.get("recurrenceRules", ruleId);
    return ok<{ next: RepeatNext }, PlannerError>({ next: after?.next ?? ENDED });
  },
});

export const followCompletion = async (ctx: MutationCtx, record: Recorder, taskIds: readonly Id<"tasks">[], now: number) => {
  for (const taskId of taskIds) {
    const task = await ctx.db.get("tasks", taskId);
    if (!task?.repeat) continue;
    const rule = await ctx.db.get("recurrenceRules", task.repeat.ruleId);
    if (rule?.schedule.kind !== "afterCompletion" || rule.lastDate !== task.repeat.date) continue;
    const leaving = task.status.kind === "open" ? "due" : "waiting";
    if (rule.next.kind !== leaving) continue;
    await record.patch("recurrenceRules", rule._id, {
      next: nextAfterInstance(rule.schedule, rule, task, localDateIn(rule.timeZone, now)),
    });
  }
};

const loadUpcoming = async (ctx: QueryCtx, date: IsoDate, days: number) => {
  const until = addDays(date, Math.min(Math.max(Math.floor(days), 1), MAX_UPCOMING_DAYS));
  const rules = await ctx.db
    .query("recurrenceRules")
    .withIndex("by_next", (q) => q.eq("next.kind", "due").gt("next.date", date).lte("next.date", until))
    .take(UPCOMING_LIMIT);
  const homes = await Promise.all(rules.map((rule) => homeSummary(ctx, rule.task.parent)));
  const instances = await Promise.all(rules.map((rule) => instanceOn(ctx, rule._id, rule.lastDate)));
  return rules.flatMap((rule, index) =>
    rule.next.kind === "due"
      ? [
          {
            ruleId: rule._id,
            taskId: instances[index]?._id,
            date: rule.next.date,
            title: rule.task.title,
            estimateMinutes: rule.task.estimateMinutes,
            evening: rule.evening,
            schedule: rule.schedule,
            end: rule.end,
            ...homes[index],
          },
        ]
      : [],
  );
};

export const upcoming = ownerQuery({
  args: { date: v.string(), days: v.number() },
  handler: async (ctx, { date, days }) =>
    serialise(await parseIsoDate(date).asyncMap((day) => loadUpcoming(ctx, day, days))),
});
