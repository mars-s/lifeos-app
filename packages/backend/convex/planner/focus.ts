import { v } from "convex/values";
import { err, ok, type Result } from "neverthrow";
import type { WithoutSystemFields } from "convex/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { ownerQuery } from "../platform/access";
import type { Recorder } from "../platform/activity";
import { changeMutation } from "../platform/change";
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
import { load, type PlannerError } from "./model";
import { vFocusPlan, vFocusPlanChoice } from "./tables";

type Session = Doc<"focusSessions">;
type SessionFields = Partial<WithoutSystemFields<Session>>;
type FocusRefusal = Extract<PlannerError, { kind: "invalid_focus" }>["reason"];
type Changed = { changed: boolean };
type Started = { sessionId: Id<"focusSessions">; replaced: Id<"focusSessions"> | null };

const refuse = <T>(reason: FocusRefusal) => err<T, PlannerError>({ kind: "invalid_focus", reason });

const isMinutes = (minutes: number, max: number) => Number.isInteger(minutes) && minutes > 0 && minutes <= max;

const isLength = (minutes: number | undefined) => minutes === undefined || isMinutes(minutes, MAX_FOCUS_MINUTES);

const parsePlan = (plan: FocusPlan) =>
  plan.kind === "open" || (isMinutes(plan.focusMinutes, MAX_FOCUS_MINUTES) && isLength(plan.breakMinutes) && isLength(plan.longBreakMinutes))
    ? ok<FocusPlan, PlannerError>(plan)
    : refuse<FocusPlan>("minutes");

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

const loadOpenTask = async (ctx: QueryCtx, taskId: Id<"tasks">) =>
  (await load(ctx, "tasks", taskId)).andThen((task) =>
    task.status.kind === "open" && task.trashedAt === undefined
      ? ok<Doc<"tasks">, PlannerError>(task)
      : refuse<Doc<"tasks">>("task_closed"),
  );

const loadSession = async (ctx: QueryCtx, sessionId: Id<"focusSessions">) =>
  (await load(ctx, "focusSessions", sessionId)).andThen((session) =>
    session.removedAt === undefined
      ? ok<Session, PlannerError>(session)
      : err<Session, PlannerError>({ kind: "not_found", table: "focusSessions", id: sessionId }),
  );

const loadActive = async (ctx: QueryCtx, sessionId: Id<"focusSessions">) =>
  (await loadSession(ctx, sessionId)).andThen((session) =>
    session.state.kind === "ended" ? refuse<Session>("not_active") : ok<Session, PlannerError>(session),
  );

const loadEnded = async (ctx: QueryCtx, sessionId: Id<"focusSessions">) =>
  (await loadSession(ctx, sessionId)).andThen((session) =>
    session.state.kind === "ended" ? ok<Session, PlannerError>(session) : refuse<Session>("not_ended"),
  );

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
  handler: async (ctx, { taskId, plan }, record) => {
    const task = await loadOpenTask(ctx, taskId);
    if (task.isErr()) return err<Started, PlannerError>(task.error);
    const valid = parsePlan(plan);
    if (valid.isErr()) return err<Started, PlannerError>(valid.error);
    const now = Date.now();
    const current = await activeSession(ctx);
    if (current?.taskId === taskId && current.kind === "focus" && !isTimeUp(current, now))
      return ok<Started, PlannerError>({ sessionId: current._id, replaced: null });
    if (current) await end(record, current, now);
    const pomodoro = valid.value.kind === "pomodoro" ? { ...lengthsOf(valid.value), round: 1 } : undefined;
    const sessionId = await record.insert("focusSessions", sessionFor(taskId, pomodoro, "focus", now));
    return ok<Started, PlannerError>({ sessionId, replaced: current?._id ?? null });
  },
});

const patchActive = async (
  ctx: MutationCtx,
  record: Recorder,
  sessionId: Id<"focusSessions">,
  fieldsFor: (session: Session, now: number) => Result<SessionFields, PlannerError>,
) => {
  const session = await loadActive(ctx, sessionId);
  if (session.isErr()) return err<Changed, PlannerError>(session.error);
  const fields = fieldsFor(session.value, Date.now());
  if (fields.isErr()) return err<Changed, PlannerError>(fields.error);
  return ok<Changed, PlannerError>({ changed: await record.patch("focusSessions", sessionId, fields.value) });
};

export const pause = changeMutation({
  action: "focus.pause",
  args: { sessionId: v.id("focusSessions") },
  handler: (ctx, { sessionId }, record) =>
    patchActive(ctx, record, sessionId, (session, now) =>
      ok<SessionFields, PlannerError>(
        session.state.kind === "running" ? { state: { kind: "paused", at: endInstant(session, now) } } : {},
      ),
    ),
});

export const resume = changeMutation({
  action: "focus.resume",
  args: { sessionId: v.id("focusSessions") },
  handler: (ctx, { sessionId }, record) =>
    patchActive(ctx, record, sessionId, (session, now) =>
      ok<SessionFields, PlannerError>(
        session.state.kind === "paused"
          ? { state: { kind: "running" }, pausedMs: session.pausedMs + Math.max(0, now - session.state.at) }
          : {},
      ),
    ),
});

export const extend = changeMutation({
  action: "focus.extend",
  args: { sessionId: v.id("focusSessions"), minutes: v.number() },
  handler: (ctx, { sessionId, minutes }, record) =>
    patchActive(ctx, record, sessionId, (session, now) => {
      if (session.plannedMinutes === undefined) return refuse<SessionFields>("not_timed");
      const planned = session.plannedMinutes + minutes;
      if (!isMinutes(minutes, MAX_EXTEND_MINUTES) || planned > MAX_FOCUS_MINUTES) return refuse<SessionFields>("minutes");
      return ok<SessionFields, PlannerError>({ plannedMinutes: planned, pausedMs: session.pausedMs + overtimeMs(session, now) });
    }),
});

export const setPlan = changeMutation({
  action: "focus.setPlan",
  args: { sessionId: v.id("focusSessions"), plan: vFocusPlan },
  handler: (ctx, { sessionId, plan }, record) =>
    patchActive(ctx, record, sessionId, (session, now) => {
      if (session.kind === "break") return refuse<SessionFields>("on_break");
      const valid = parsePlan(plan);
      if (valid.isErr()) return refuse<SessionFields>("minutes");
      if (valid.value.kind === "open") return ok<SessionFields, PlannerError>({ plannedMinutes: undefined, pomodoro: undefined });
      const worked = Math.ceil(focusedMs({ ...session, plannedMinutes: undefined }, now) / MINUTE_MS);
      return ok<SessionFields, PlannerError>({
        plannedMinutes: Math.max(valid.value.focusMinutes, worked),
        pomodoro: { ...lengthsOf(valid.value), round: session.pomodoro?.round ?? 1 },
      });
    }),
});

export const stop = changeMutation({
  action: "focus.stop",
  args: { sessionId: v.id("focusSessions") },
  handler: async (ctx, { sessionId }, record) => {
    const session = await loadSession(ctx, sessionId);
    if (session.isErr()) return err<Changed, PlannerError>(session.error);
    if (session.value.state.kind === "ended") return ok<Changed, PlannerError>({ changed: false });
    return ok<Changed, PlannerError>({ changed: await end(record, session.value, Date.now()) });
  },
});

export const advance = changeMutation({
  action: "focus.advance",
  args: { sessionId: v.id("focusSessions") },
  handler: async (ctx, { sessionId }, record) => {
    const session = await loadActive(ctx, sessionId);
    if (session.isErr()) return err<Started, PlannerError>(session.error);
    const { taskId, kind, pomodoro } = session.value;
    if (!pomodoro) return refuse<Started>("not_pomodoro");
    const next = nextStep(pomodoro, kind);
    const task = next.kind === "focus" ? await loadOpenTask(ctx, taskId) : await load(ctx, "tasks", taskId);
    if (task.isErr()) return err<Started, PlannerError>(task.error);
    const now = Date.now();
    await end(record, session.value, now);
    const nextId = await record.insert("focusSessions", sessionFor(taskId, next.pomodoro, next.kind, now));
    return ok<Started, PlannerError>({ sessionId: nextId, replaced: sessionId });
  },
});

export const setMinutes = changeMutation({
  action: "focus.setMinutes",
  args: { sessionId: v.id("focusSessions"), minutes: v.number() },
  handler: async (ctx, { sessionId, minutes }, record) => {
    const session = await loadEnded(ctx, sessionId);
    if (session.isErr()) return err<Changed, PlannerError>(session.error);
    if (!isMinutes(minutes, MAX_FOCUS_MINUTES)) return refuse<Changed>("minutes");
    const { state } = session.value;
    const at = state.kind === "ended" ? state.at : Date.now();
    return ok<Changed, PlannerError>({
      changed: await record.patch("focusSessions", sessionId, {
        start: at - minutes * MINUTE_MS,
        pausedMs: 0,
        plannedMinutes: undefined,
      }),
    });
  },
});

export const remove = changeMutation({
  action: "focus.remove",
  args: { sessionId: v.id("focusSessions") },
  handler: async (ctx, { sessionId }, record) => {
    const session = await loadEnded(ctx, sessionId);
    if (session.isErr()) return err<Changed, PlannerError>(session.error);
    return ok<Changed, PlannerError>({ changed: await record.patch("focusSessions", sessionId, { removedAt: Date.now() }) });
  },
});

export const planChoiceOf = async (ctx: QueryCtx) => {
  const row = await ctx.db.query("focusPlan").first();
  if (!row) return DEFAULT_FOCUS_PLAN;
  const { mode, focusMinutes, breakMinutes, longBreakMinutes } = row;
  return { mode, focusMinutes, breakMinutes, longBreakMinutes } satisfies FocusPlanChoice;
};

export const plan = ownerQuery({
  args: {},
  handler: planChoiceOf,
});

export const choosePlan = changeMutation({
  action: "focus.choosePlan",
  args: vFocusPlanChoice.fields,
  handler: async (ctx, choice, record) => {
    const lengths = [choice.focusMinutes, choice.breakMinutes, choice.longBreakMinutes];
    if (!lengths.every((minutes) => isMinutes(minutes, MAX_FOCUS_MINUTES))) return refuse<Changed>("minutes");
    const row = await ctx.db.query("focusPlan").first();
    if (row) return ok<Changed, PlannerError>({ changed: await record.patch("focusPlan", row._id, choice) });
    await record.insert("focusPlan", choice);
    return ok<Changed, PlannerError>({ changed: true });
  },
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
  handler: currentFocus,
});
