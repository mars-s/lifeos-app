import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { formatMinutes } from "../estimate";
import {
  MINUTE_MS,
  endInstant,
  focusedMs,
  isLongBreak,
  isTimeUp,
  nextStep,
  overtimeMs,
  planOf,
  plannedMs,
  remainingMs,
  stepMinutes,
  type FocusClock,
  type FocusPlanChoice,
  type Pomodoro,
} from "../focus";
import type { PlannerTask } from "../types";
import type { ChangeFn } from "./change";
import type { Updater } from "./local-views";
import { isOptimistic } from "./task-actions";
import { both, nothing, patchTask } from "./updaters";

export type ActiveFocus = NonNullable<FunctionReturnType<typeof api.planner.focus.current>>;
type Logged = PlannerTask["focus"]["sessions"][number];

export type FocusView = {
  title: string;
  phase: "focus" | "break";
  status: "running" | "paused" | "done";
  seconds: number;
  ring: number;
  timed: boolean;
  longBreak?: boolean;
};

const HOUR_MS = 60 * MINUTE_MS;

export const wholeMinutes = (ms: number) => Math.floor(ms / MINUTE_MS);

export const viewOf = (active: ActiveFocus, now: number) => {
  const focused = focusedMs(active, now);
  const remaining = remainingMs(active, now);
  const planned = plannedMs(active);
  return {
    title: active.title,
    phase: active.kind,
    status: remaining === 0 ? "done" : active.state.kind === "paused" ? "paused" : "running",
    seconds: remaining === undefined || remaining === 0 ? Math.floor(focused / 1000) : Math.ceil(remaining / 1000),
    ring: remaining === undefined || planned === undefined ? (focused % HOUR_MS) / HOUR_MS : remaining / planned,
    timed: remaining !== undefined,
    longBreak: active.kind === "break" && active.pomodoro !== undefined && isLongBreak(active.pomodoro),
  } satisfies FocusView;
};

type Watched = FocusClock & { readonly kind: "focus" | "break"; readonly title: string; readonly pomodoro?: Pomodoro };

export const timeUpAlert = (session: Watched) => {
  const planned = plannedMs(session);
  if (session.state.kind !== "running" || planned === undefined) return null;
  const endsAt = session.start + session.pausedMs + planned;
  if (session.kind === "break") return { endsAt, title: "Break over", body: `Back to ${session.title}.` };
  const rest = session.pomodoro && isLongBreak(session.pomodoro) ? "a long break" : "a break";
  return { endsAt, title: "Focus Session complete", body: `Time for ${rest} from ${session.title}.` };
};

const lengthsOf = ({ focusMinutes, breakMinutes, longBreakMinutes }: FocusPlanChoice) => ({ focusMinutes, breakMinutes, longBreakMinutes });

const setCurrent = (next: ActiveFocus | null) => {
  const update: Updater = (store) => store.setQuery(api.planner.focus.current, {}, next);
  return update;
};

const patchCurrent = (patch: (session: ActiveFocus) => ActiveFocus) => {
  const update: Updater = (store) => {
    const session = store.getQuery(api.planner.focus.current, {});
    if (session) store.setQuery(api.planner.focus.current, {}, patch(session));
  };
  return update;
};

const setPlanChoice = (plan: FocusPlanChoice) => {
  const update: Updater = (store) => store.setQuery(api.planner.focus.plan, {}, plan);
  return update;
};

const withFocus = (taskId: Id<"tasks">, patch: (sessions: Logged[]) => Logged[]) =>
  patchTask(taskId, (task) => {
    const sessions = patch(task.focus.sessions);
    const unlisted = task.focus.ms - task.focus.sessions.reduce((sum, session) => sum + session.ms, 0);
    return { ...task, focus: { ms: sessions.reduce((sum, session) => sum + session.ms, unlisted), sessions } };
  });

const logged = (session: ActiveFocus, now: number) =>
  session.kind === "focus" && focusedMs(session, now) >= MINUTE_MS
    ? withFocus(session.taskId, (sessions) => [
        { _id: session._id, start: session.start, end: endInstant(session, now), ms: focusedMs(session, now) },
        ...sessions,
      ])
    : nothing;

const unlogged = (session: ActiveFocus) =>
  session.kind === "focus" ? withFocus(session.taskId, (sessions) => sessions.filter((entry) => entry._id !== session._id)) : nothing;

const optimisticSession = (
  from: Pick<ActiveFocus, "taskId" | "title" | "colour">,
  kind: ActiveFocus["kind"],
  pomodoro: ActiveFocus["pomodoro"],
  now: number,
) =>
  ({
    _id: `optimistic:focus:${now}` as Id<"focusSessions">,
    taskId: from.taskId,
    kind,
    start: now,
    pausedMs: 0,
    state: { kind: "running" },
    title: from.title,
    ...(from.colour ? { colour: from.colour } : {}),
    ...(pomodoro ? { plannedMinutes: stepMinutes(pomodoro, kind), pomodoro } : {}),
  }) satisfies ActiveFocus;

export const isFocusingOn = (active: ActiveFocus | null, taskId: string, now: number) =>
  active?.taskId === taskId && active.kind === "focus" && !isTimeUp(active, now);

export const focusActions = (change: ChangeFn, active: ActiveFocus | null, chosen: FocusPlanChoice) => {
  const live = active && !isOptimistic(active._id) ? active : null;

  const pause = () => {
    if (live?.state.kind !== "running") return;
    void change({
      title: "Focus Session paused",
      mutation: api.planner.focus.pause,
      args: { sessionId: live._id },
      apply: patchCurrent((session) => ({ ...session, state: { kind: "paused", at: endInstant(session, Date.now()) } })),
      revert: setCurrent(live),
      silent: true,
    });
  };

  const resume = () => {
    if (live?.state.kind !== "paused") return;
    const pausedAt = live.state.at;
    void change({
      title: "Focus Session resumed",
      mutation: api.planner.focus.resume,
      args: { sessionId: live._id },
      apply: patchCurrent((session) => ({
        ...session,
        state: { kind: "running" },
        pausedMs: session.pausedMs + Math.max(0, Date.now() - pausedAt),
      })),
      revert: setCurrent(live),
      silent: true,
    });
  };

  return {
    pause,
    resume,
    toggle: () => (live?.state.kind === "paused" ? resume() : pause()),

    start: (task: PlannerTask) => {
      const now = Date.now();
      if (isFocusingOn(active, task._id, now)) return resume();
      const plan = planOf(chosen);
      const next = optimisticSession(
        { taskId: task._id, title: task.title, colour: task.area?.colour },
        "focus",
        plan.kind === "pomodoro" ? { ...lengthsOf(chosen), round: 1 } : undefined,
        now,
      );
      void change({
        title: active ? "Focus switched" : "Focus started",
        mutation: api.planner.focus.start,
        args: { taskId: task._id, plan },
        apply: both(active ? logged(active, now) : nothing, setCurrent(next)),
        revert: both(active ? unlogged(active) : nothing, setCurrent(active)),
      });
    },

    stop: () => {
      if (!live) return;
      const now = Date.now();
      const minutes = wholeMinutes(focusedMs(live, now));
      void change({
        title: live.kind === "break" ? "Break ended" : minutes > 0 ? `Focused for ${formatMinutes(minutes)}` : "Focus Session stopped",
        mutation: api.planner.focus.stop,
        args: { sessionId: live._id },
        apply: both(logged(live, now), setCurrent(null)),
        revert: both(unlogged(live), setCurrent(live)),
      });
    },

    extend: (minutes: number) => {
      if (live?.plannedMinutes === undefined) return;
      void change({
        title: "Focus Session extended",
        mutation: api.planner.focus.extend,
        args: { sessionId: live._id, minutes },
        apply: patchCurrent((session) => ({
          ...session,
          plannedMinutes: (session.plannedMinutes ?? 0) + minutes,
          pausedMs: session.pausedMs + overtimeMs(session, Date.now()),
        })),
        revert: setCurrent(live),
        silent: true,
      });
    },

    advance: () => {
      if (!live?.pomodoro) return;
      const now = Date.now();
      const next = nextStep(live.pomodoro, live.kind);
      void change({
        title: live.kind === "focus" ? "Break started" : "Focus Session started",
        mutation: api.planner.focus.advance,
        args: { sessionId: live._id },
        apply: both(logged(live, now), setCurrent(optimisticSession(live, next.kind, next.pomodoro, now))),
        revert: both(unlogged(live), setCurrent(live)),
        silent: true,
      });
    },

    setPlan: (plan: FocusPlanChoice) => {
      void change({
        title: "Focus plan chosen",
        mutation: api.planner.focus.choosePlan,
        args: plan,
        apply: setPlanChoice(plan),
        revert: setPlanChoice(chosen),
        silent: true,
      });
      if (live?.kind !== "focus") return;
      const pomodoro = { ...lengthsOf(plan), round: live.pomodoro?.round ?? 1 };
      void change({
        title: "Focus mode changed",
        mutation: api.planner.focus.setPlan,
        args: { sessionId: live._id, plan: planOf(plan) },
        apply: patchCurrent(({ plannedMinutes: _planned, pomodoro: _pomodoro, ...session }) =>
          plan.mode === "open"
            ? session
            : {
                ...session,
                pomodoro,
                plannedMinutes: Math.max(plan.focusMinutes, Math.ceil(focusedMs(session, Date.now()) / MINUTE_MS)),
              },
        ),
        revert: setCurrent(live),
        silent: true,
      });
    },

    editSession: (task: PlannerTask, sessionId: string, minutes: number) => {
      const before = task.focus.sessions.find((session) => session._id === sessionId);
      if (!before || isOptimistic(sessionId)) return;
      void change({
        title: `Focus Session set to ${formatMinutes(minutes)}`,
        mutation: api.planner.focus.setMinutes,
        args: { sessionId: before._id, minutes },
        apply: withFocus(task._id, (sessions) =>
          sessions.map((session) => (session._id === sessionId ? { ...session, start: session.end - minutes * MINUTE_MS, ms: minutes * MINUTE_MS } : session)),
        ),
        revert: withFocus(task._id, (sessions) => sessions.map((session) => (session._id === sessionId ? before : session))),
        slot: `card:${task._id}`,
      });
    },

    removeSession: (task: PlannerTask, sessionId: string) => {
      const before = task.focus.sessions.find((session) => session._id === sessionId);
      if (!before || isOptimistic(sessionId)) return;
      void change({
        title: `Removed ${formatMinutes(wholeMinutes(before.ms))} of focus`,
        mutation: api.planner.focus.remove,
        args: { sessionId: before._id },
        apply: withFocus(task._id, (sessions) => sessions.filter((session) => session._id !== sessionId)),
        revert: withFocus(task._id, (sessions) => [...sessions, before].toSorted((a, b) => b.start - a.start)),
        slot: `card:${task._id}`,
      });
    },
  };
};

export type FocusActions = ReturnType<typeof focusActions>;
