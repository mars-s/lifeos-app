import { v } from "convex/values";
import { Clock, Effect, Result } from "effect";
import type { WithoutSystemFields } from "convex/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { Recorder } from "../platform/activity";
import { changeMutation, ownerQuery, reading, recording } from "../platform/effect";
import {
  DEFAULT_FOCUS_PLAN,
  MAX_EXTEND_MINUTES,
  MAX_FOCUS_MINUTES,
  MINUTE_MS,
  endInstant,
  focusedMs,
  isTimeUp,
  nextStep,
  overtimeMs,
  stepMinutes,
  type FocusPlan,
  type FocusPlanChoice,
  type Pomodoro,
} from "../../shared/focus";
import { InvalidFocus, NotFound } from "./errors";
import { load } from "./model";
import { vFocusPlan, vFocusPlanChoice } from "./tables";

type Session = Doc<"focusSessions">;
type SessionFields = Partial<WithoutSystemFields<Session>>;
type FocusRefusal = (typeof InvalidFocus.fields.reason)["Type"];

const refuse = (reason: FocusRefusal) => Result.fail(new InvalidFocus({ reason }));

const isMinutes = (minutes: number, max: number) => Number.isInteger(minutes) && minutes > 0 && minutes <= max;

const isLength = (minutes: number | undefined) => minutes === undefined || isMinutes(minutes, MAX_FOCUS_MINUTES);

const parsePlan = (plan: FocusPlan) => {
  const parsed: Result.Result<FocusPlan, InvalidFocus> =
    plan.kind === "open" || (isMinutes(plan.focusMinutes, MAX_FOCUS_MINUTES) && isLength(plan.breakMinutes) && isLength(plan.longBreakMinutes))
      ? Result.succeed(plan)
      : refuse("minutes");
  return parsed;
};

const lengthsOf = ({ focusMinutes, breakMinutes, longBreakMinutes }: Pomodoro) =>
  ({ focusMinutes, breakMinutes, ...(longBreakMinutes === undefined ? {} : { longBreakMinutes }) }) satisfies Pomodoro;

export const activeSession = async (ctx: QueryCtx) =>
  (await ctx.db
    .query("focusSessions")
    .withIndex("by_state", (q) => q.eq("state.kind", "running"))
    .first()) ??
  (await ctx.db
    .query("focusSessions")
    .withIndex("by_state", (q) => q.eq("state.kind", "paused"))
    .first());

const end = (record: Recorder, session: Session, now: number) =>
  record.patch("focusSessions", session._id, { state: { kind: "ended", at: endInstant(session, now) } });

export const endFocusOnClosedTask = async (ctx: MutationCtx, record: Recorder, now: number) => {
  const session = await activeSession(ctx);
  if (!session) return;
  const task = await ctx.db.get("tasks", session.taskId);
  if (!task || task.status.kind !== "open" || task.trashedAt !== undefined) await end(record, session, now);
};

const ending = (session: Session, now: number) => recording((record) => end(record, session, now));

const loadOpenTask = Effect.fn("focus.loadOpenTask")(function* (taskId: Id<"tasks">) {
  const task = yield* load("tasks", taskId);
  if (task.status.kind !== "open" || task.trashedAt !== undefined) return yield* new InvalidFocus({ reason: "task_closed" });
  return task;
});

const loadSession = Effect.fn("focus.loadSession")(function* (sessionId: Id<"focusSessions">) {
  const session = yield* load("focusSessions", sessionId);
  if (session.removedAt !== undefined) return yield* new NotFound({ table: "focusSessions", id: sessionId });
  return session;
});

const loadActive = Effect.fn("focus.loadActive")(function* (sessionId: Id<"focusSessions">) {
  const session = yield* loadSession(sessionId);
  if (session.state.kind === "ended") return yield* new InvalidFocus({ reason: "not_active" });
  return session;
});

const loadEnded = Effect.fn("focus.loadEnded")(function* (sessionId: Id<"focusSessions">) {
  const session = yield* loadSession(sessionId);
  if (session.state.kind !== "ended") return yield* new InvalidFocus({ reason: "not_ended" });
  return session;
});

const sessionFor = (taskId: Id<"tasks">, pomodoro: Pomodoro | undefined, kind: Session["kind"], now: number) =>
  ({
    taskId,
    kind,
    start: now,
    pausedMs: 0,
    state: { kind: "running" },
    ...(pomodoro ? { plannedMinutes: stepMinutes(pomodoro, kind), pomodoro } : {}),
  }) satisfies WithoutSystemFields<Session>;

export const start = changeMutation({
  action: "focus.start",
  args: { taskId: v.id("tasks"), plan: vFocusPlan },
  handler: Effect.fn("focus.start")(function* ({ taskId, plan }) {
    yield* loadOpenTask(taskId);
    const valid = yield* Effect.fromResult(parsePlan(plan));
    const now = yield* Clock.currentTimeMillis;
    const current = yield* reading(activeSession);
    if (current?.taskId === taskId && current.kind === "focus" && !isTimeUp(current, now)) return { sessionId: current._id, replaced: null };
    if (current) yield* ending(current, now);
    const pomodoro = valid.kind === "pomodoro" ? { ...lengthsOf(valid), round: 1 } : undefined;
    const sessionId = yield* recording((record) => record.insert("focusSessions", sessionFor(taskId, pomodoro, "focus", now)));
    return { sessionId, replaced: current?._id ?? null };
  }),
});

const patchActive = Effect.fn("focus.patchActive")(function* (
  sessionId: Id<"focusSessions">,
  fieldsFor: (session: Session, now: number) => Result.Result<SessionFields, InvalidFocus>,
) {
  const session = yield* loadActive(sessionId);
  const fields = yield* Effect.fromResult(fieldsFor(session, yield* Clock.currentTimeMillis));
  return { changed: yield* recording((record) => record.patch("focusSessions", sessionId, fields)) };
});

const unchanged = (fields: SessionFields) => Result.succeed(fields);

export const pause = changeMutation({
  action: "focus.pause",
  args: { sessionId: v.id("focusSessions") },
  handler: ({ sessionId }) =>
    patchActive(sessionId, (session, now) =>
      unchanged(session.state.kind === "running" ? { state: { kind: "paused", at: endInstant(session, now) } } : {}),
    ),
});

export const resume = changeMutation({
  action: "focus.resume",
  args: { sessionId: v.id("focusSessions") },
  handler: ({ sessionId }) =>
    patchActive(sessionId, (session, now) =>
      unchanged(
        session.state.kind === "paused"
          ? { state: { kind: "running" }, pausedMs: session.pausedMs + Math.max(0, now - session.state.at) }
          : {},
      ),
    ),
});

export const extend = changeMutation({
  action: "focus.extend",
  args: { sessionId: v.id("focusSessions"), minutes: v.number() },
  handler: ({ sessionId, minutes }) =>
    patchActive(sessionId, (session, now) => {
      if (session.plannedMinutes === undefined) return refuse("not_timed");
      const planned = session.plannedMinutes + minutes;
      if (!isMinutes(minutes, MAX_EXTEND_MINUTES) || planned > MAX_FOCUS_MINUTES) return refuse("minutes");
      return unchanged({ plannedMinutes: planned, pausedMs: session.pausedMs + overtimeMs(session, now) });
    }),
});

export const setPlan = changeMutation({
  action: "focus.setPlan",
  args: { sessionId: v.id("focusSessions"), plan: vFocusPlan },
  handler: ({ sessionId, plan }) =>
    patchActive(sessionId, (session, now) => {
      if (session.kind === "break") return refuse("on_break");
      const valid = parsePlan(plan);
      if (Result.isFailure(valid)) return refuse("minutes");
      if (valid.success.kind === "open") return unchanged({ plannedMinutes: undefined, pomodoro: undefined });
      const worked = Math.ceil(focusedMs({ ...session, plannedMinutes: undefined }, now) / MINUTE_MS);
      return unchanged({
        plannedMinutes: Math.max(valid.success.focusMinutes, worked),
        pomodoro: { ...lengthsOf(valid.success), round: session.pomodoro?.round ?? 1 },
      });
    }),
});

export const stop = changeMutation({
  action: "focus.stop",
  args: { sessionId: v.id("focusSessions") },
  handler: Effect.fn("focus.stop")(function* ({ sessionId }) {
    const session = yield* loadSession(sessionId);
    if (session.state.kind === "ended") return { changed: false };
    return { changed: yield* ending(session, yield* Clock.currentTimeMillis) };
  }),
});

export const advance = changeMutation({
  action: "focus.advance",
  args: { sessionId: v.id("focusSessions") },
  handler: Effect.fn("focus.advance")(function* ({ sessionId }) {
    const session = yield* loadActive(sessionId);
    const { taskId, kind, pomodoro } = session;
    if (!pomodoro) return yield* new InvalidFocus({ reason: "not_pomodoro" });
    const next = nextStep(pomodoro, kind);
    yield* next.kind === "focus" ? loadOpenTask(taskId) : load("tasks", taskId);
    const now = yield* Clock.currentTimeMillis;
    yield* ending(session, now);
    const nextId = yield* recording((record) => record.insert("focusSessions", sessionFor(taskId, next.pomodoro, next.kind, now)));
    return { sessionId: nextId, replaced: sessionId };
  }),
});

export const setMinutes = changeMutation({
  action: "focus.setMinutes",
  args: { sessionId: v.id("focusSessions"), minutes: v.number() },
  handler: Effect.fn("focus.setMinutes")(function* ({ sessionId, minutes }) {
    const { state } = yield* loadEnded(sessionId);
    if (!isMinutes(minutes, MAX_FOCUS_MINUTES)) return yield* new InvalidFocus({ reason: "minutes" });
    const at = state.kind === "ended" ? state.at : yield* Clock.currentTimeMillis;
    return {
      changed: yield* recording((record) =>
        record.patch("focusSessions", sessionId, { start: at - minutes * MINUTE_MS, pausedMs: 0, plannedMinutes: undefined }),
      ),
    };
  }),
});

export const remove = changeMutation({
  action: "focus.remove",
  args: { sessionId: v.id("focusSessions") },
  handler: Effect.fn("focus.remove")(function* ({ sessionId }) {
    yield* loadEnded(sessionId);
    const removedAt = yield* Clock.currentTimeMillis;
    return { changed: yield* recording((record) => record.patch("focusSessions", sessionId, { removedAt })) };
  }),
});

export const planChoiceOf = async (ctx: QueryCtx) => {
  const row = await ctx.db.query("focusPlan").first();
  if (!row) return DEFAULT_FOCUS_PLAN;
  const { mode, focusMinutes, breakMinutes, longBreakMinutes } = row;
  return { mode, focusMinutes, breakMinutes, longBreakMinutes } satisfies FocusPlanChoice;
};

export const plan = ownerQuery({
  args: {},
  handler: () => reading(planChoiceOf),
});

export const choosePlan = changeMutation({
  action: "focus.choosePlan",
  args: vFocusPlanChoice.fields,
  handler: Effect.fn("focus.choosePlan")(function* (choice) {
    const lengths = [choice.focusMinutes, choice.breakMinutes, choice.longBreakMinutes];
    if (!lengths.every((minutes) => isMinutes(minutes, MAX_FOCUS_MINUTES))) return yield* new InvalidFocus({ reason: "minutes" });
    const row = yield* reading((ctx) => ctx.db.query("focusPlan").first());
    if (row) return { changed: yield* recording((record) => record.patch("focusPlan", row._id, choice)) };
    yield* recording((record) => record.insert("focusPlan", choice));
    return { changed: true };
  }),
});

export const currentFocus = async (ctx: QueryCtx) => {
  const session = await activeSession(ctx);
  const task = session && (await ctx.db.get("tasks", session.taskId));
  if (!session || !task) return null;
  const project = task.parent.kind === "project" ? await ctx.db.get("projects", task.parent.projectId) : null;
  const areaId = task.parent.kind === "area" ? task.parent.areaId : project?.areaId;
  const area = areaId ? await ctx.db.get("areas", areaId) : null;
  const { _id, taskId, kind, start: startedAt, pausedMs, plannedMinutes, state, pomodoro } = session;
  return {
    _id,
    taskId,
    kind,
    start: startedAt,
    pausedMs,
    state,
    title: task.title,
    ...(plannedMinutes === undefined ? {} : { plannedMinutes }),
    ...(pomodoro ? { pomodoro } : {}),
    ...(area ? { colour: area.colour } : {}),
  };
};

export const current = ownerQuery({
  args: {},
  handler: () => reading(currentFocus),
});
