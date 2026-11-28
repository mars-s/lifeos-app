import { v } from "convex/values";
import { Clock, Effect, Result } from "effect";
import { internal } from "../_generated/api";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { sameValue, startRecording, type Recorder } from "../platform/activity";
import { changeMutation, internalMutation, ownerQuery, Reads, reading, recording, writing } from "../platform/effect";
import type { Actor } from "../platform/tables";
import { addDays, laterOf, type IsoDate } from "../../shared/date";
import { effectFromNeverthrow } from "../../shared/effect/bridge";
import { parseIsoDate } from "../../shared/effect/date";
import { InvalidSchedule } from "../../shared/effect/errors";
import { parseEnd, parseSchedule, parseTimeZone } from "../../shared/effect/recurrence";
import { asWire } from "../../shared/effect/wire";
import {
  afterCompletionDate,
  firstAfter,
  firstOnOrAfter,
  following,
  localDateIn,
  withinEnd,
  type AfterCompletion,
  type RepeatEnd,
  type RepeatNext,
  type Schedule,
} from "../../shared/recurrence";
import { StaleOccurrence } from "./errors";
import { liveHome, load } from "./model";
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

export const isPaused = async (ctx: QueryCtx, rule: Rule) => (await instanceOn(ctx, rule._id, rule.lastDate))?.trashedAt !== undefined;

export const stopWithLatest = async (ctx: MutationCtx, record: Recorder, task: Doc<"tasks">) => {
  if (!task.repeat) return;
  const rule = await ctx.db.get("recurrenceRules", task.repeat.ruleId);
  if (rule && rule.lastDate === task.repeat.date && rule.next.kind !== "ended") {
    await record.patch("recurrenceRules", rule._id, { next: ENDED });
  }
};

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
  if (rule.next.date > today || (await isPaused(ctx, rule))) return false;
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
  args: { cursor: v.optional(v.string()) },
  returns: v.null(),
  handler: Effect.fn("recurrence.generate")(function* ({ cursor }) {
    const now = yield* Clock.currentTimeMillis;
    const horizon = addDays(localDateIn("UTC", now), 1);
    const { page, isDone, continueCursor } = yield* reading((ctx) =>
      ctx.db
        .query("recurrenceRules")
        .withIndex("by_next", (q) => q.eq("next.kind", "due").lte("next.date", horizon))
        .paginate({ cursor: cursor ?? null, numItems: RULE_BATCH }),
    );
    for (const rule of page) {
      yield* writing(async (ctx) => {
        const record = startRecording(ctx, RECURRENCE, "recurrence.generate");
        await settle(ctx, record, rule._id, now);
        await record.finish();
      });
    }
    if (!isDone)
      yield* writing(async (ctx) => {
        await ctx.scheduler.runAfter(0, internal.planner.recurrence.generate, { cursor: continueCursor });
      });
    return null;
  }),
});

const settling = (ruleId: Id<"recurrenceRules">, now: number) =>
  Reads.use((ctx) => recording((record) => settle(ctx as MutationCtx, record, ruleId, now)));

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

const startRule = Effect.fn("recurrence.startRule")(function* (terms: Terms) {
  const { schedule, end, timeZone, task, shape } = terms;
  const evening = task.when.kind === "scheduled" && task.when.evening;
  const plan = schedule.kind === "afterCompletion" ? afterCompletionStart(schedule, terms) : calendarStart(schedule, terms, evening);
  if (!plan || !withinEnd(end, plan.date, 0)) return yield* new InvalidSchedule({ reason: "end" });
  const { anchor, date, when, next } = plan;
  const ruleId = yield* recording((record) =>
    record.insert("recurrenceRules", { schedule, end, task: shape, evening, timeZone, anchor, next, lastDate: date, count: 1 }),
  );
  yield* recording((record) => record.patch("tasks", task._id, { when, repeat: { ruleId, date } }));
  return ruleId;
});

const reviseRule = Effect.fn("recurrence.reviseRule")(function* (rule: Rule, terms: Terms) {
  const { schedule, end, timeZone, today, task, shape } = terms;
  const from = laterOf(today, addDays(rule.lastDate as IsoDate, 1));
  const anchor = sameValue(schedule, rule.schedule) ? (rule.anchor as IsoDate) : from;
  const next =
    schedule.kind === "afterCompletion"
      ? nextAfterInstance(schedule, { ...rule, end, timeZone }, yield* reading((ctx) => instanceOn(ctx, rule._id, rule.lastDate)), today)
      : dueWithin(end, firstOnOrAfter(schedule, anchor, from), rule.count);
  yield* recording((record) =>
    record.patch("recurrenceRules", rule._id, {
      schedule,
      end,
      task: shape,
      evening: task.when.kind === "scheduled" && task.when.evening,
      timeZone,
      anchor,
      next,
    }),
  );
  return rule._id;
});

const loaded = <T extends "tasks" | "recurrenceRules">(table: T, id: Id<T>) => Reads.use((ctx) => effectFromNeverthrow(() => load(ctx, table, id)));

export const setRepeat = changeMutation({
  action: "recurrence.set",
  args: { taskId: v.id("tasks"), schedule: vSchedule, end: vRepeatEnd, timeZone: v.string() },
  handler: Effect.fn("recurrence.setRepeat")(function* (args) {
    const task = yield* loaded("tasks", args.taskId);
    const [schedule, end, timeZone] = yield* Effect.fromResult(
      Result.all([parseSchedule(args.schedule), parseEnd(args.end), parseTimeZone(args.timeZone)]),
    );
    const now = yield* Clock.currentTimeMillis;
    const today = localDateIn(timeZone, now);
    const shape = yield* reading((ctx) => snapshotTask(ctx, task, today));
    const full = { schedule, end, timeZone, today, task, shape };
    const repeat = task.repeat;
    const current = repeat ? yield* reading((ctx) => ctx.db.get("recurrenceRules", repeat.ruleId)) : null;
    const ruleId = current && current.next.kind !== "ended" ? yield* reviseRule(current, full) : yield* startRule(full);
    yield* settling(ruleId, now);
    return { ruleId };
  }),
});

export const stopRepeat = changeMutation({
  action: "recurrence.stop",
  args: { taskId: v.id("tasks") },
  handler: Effect.fn("recurrence.stopRepeat")(function* ({ taskId }) {
    const task = yield* loaded("tasks", taskId);
    const ruleId = task.repeat?.ruleId;
    return { changed: ruleId ? yield* recording((record) => record.patch("recurrenceRules", ruleId, { next: ENDED })) : false };
  }),
});

export const stopRule = changeMutation({
  action: "recurrence.stop",
  args: { ruleId: v.id("recurrenceRules") },
  handler: Effect.fn("recurrence.stopRule")(function* ({ ruleId }) {
    yield* loaded("recurrenceRules", ruleId);
    return { changed: yield* recording((record) => record.patch("recurrenceRules", ruleId, { next: ENDED })) };
  }),
});

export const skip = changeMutation({
  action: "recurrence.skip",
  args: { ruleId: v.id("recurrenceRules"), date: v.string() },
  handler: Effect.fn("recurrence.skip")(function* ({ ruleId, date }) {
    const { next, schedule, anchor, end, count } = yield* loaded("recurrenceRules", ruleId);
    if (next.kind !== "due" || next.date !== date) return yield* new StaleOccurrence({ ruleId, date });
    yield* recording((record) =>
      record.patch("recurrenceRules", ruleId, { next: dueWithin(end, following(schedule, anchor as IsoDate, date as IsoDate), count) }),
    );
    yield* settling(ruleId, yield* Clock.currentTimeMillis);
    const after = yield* reading((ctx) => ctx.db.get("recurrenceRules", ruleId));
    return { next: after?.next ?? ENDED };
  }),
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
  const found = await ctx.db
    .query("recurrenceRules")
    .withIndex("by_next", (q) => q.eq("next.kind", "due").gt("next.date", date).lte("next.date", until))
    .take(UPCOMING_LIMIT);
  const paused = await Promise.all(found.map((rule) => isPaused(ctx, rule)));
  const rules = found.filter((_rule, index) => !paused[index]);
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
  handler: ({ date, days }) =>
    asWire(
      Effect.gen(function* () {
        const day = yield* Effect.fromResult(parseIsoDate(date));
        return yield* reading((ctx) => loadUpcoming(ctx, day, days));
      }),
    ),
});
