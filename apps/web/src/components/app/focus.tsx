"use client";

import { DotsThree, Plus, Timer } from "@phosphor-icons/react";
import type { FunctionReturnType } from "convex/server";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { createContext, use, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { api } from "@lifeos/backend/api";
import type { Id } from "@lifeos/backend/dataModel";
import {
  DEFAULT_POMODORO,
  MINUTE_MS,
  endInstant,
  focusedMs,
  isTimeUp,
  overtimeMs,
  plannedMs,
  remainingMs,
} from "@lifeos/backend/focus";
import type { PlannerTask } from "@lifeos/backend/types";
import { areaVar } from "@/components/lifeos/area";
import {
  ActualMeter,
  DotRing,
  FocusHistory,
  FocusPlanPanel,
  FocusTimerPill,
  PillButton,
  type FocusPillView,
  type FocusPlanChoice,
} from "@/components/lifeos/focus-timer";
import { formatCountdown, formatMinutes } from "@/components/lifeos/format";
import { MenuRow, ToolButton } from "@/components/lifeos/tool-button";
import { Popover, PopoverClose } from "@/components/ui/popover-panel";
import { RollingNumber } from "@/components/ui/rolling-number";
import { haptic } from "@/lib/haptics";
import { instant, springLayout, springLift } from "@/lib/motion-tokens";
import { cn } from "@/lib/utils";
import { both, nothing, patchTask, useChange, type Updater } from "./changes";
import { clockTime, localDate } from "./dates";
import { useQuietView } from "./hooks";
import { useSelectionSize } from "./selection";
import { useShell } from "./shell-context";
import { isOptimistic } from "./task-actions";

export type ActiveFocus = NonNullable<FunctionReturnType<typeof api.planner.focus.current>>;
type Via = "pointer" | "keyboard";
type Logged = PlannerTask["focus"]["sessions"][number];

const PLAN_KEY = "lifeos.focus-plan";
const DEFAULT_PLAN: FocusPlanChoice = { mode: "open", ...DEFAULT_POMODORO };
const HOUR_MS = 60 * MINUTE_MS;
const SELECTION_BAR_LIFT = 64;

const isLength = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 24 * 60;

const parsePlan = (raw: string | null) => {
  try {
    const stored: unknown = raw === null ? null : JSON.parse(raw);
    if (!stored || typeof stored !== "object") return DEFAULT_PLAN;
    const { mode, focusMinutes, breakMinutes } = stored as Record<string, unknown>;
    if ((mode !== "open" && mode !== "pomodoro") || !isLength(focusMinutes) || !isLength(breakMinutes)) return DEFAULT_PLAN;
    return { mode, focusMinutes: focusMinutes as number, breakMinutes: breakMinutes as number } satisfies FocusPlanChoice;
  } catch {
    return DEFAULT_PLAN;
  }
};

const storedPlan = () => {
  try {
    return window.localStorage.getItem(PLAN_KEY);
  } catch {
    return null;
  }
};

let planCache: { raw: string | null; plan: FocusPlanChoice } = { raw: null, plan: DEFAULT_PLAN };
const planListeners = new Set<() => void>();

const readPlan = () => {
  const raw = storedPlan() ?? planCache.raw;
  if (raw !== planCache.raw) planCache = { raw, plan: parsePlan(raw) };
  return planCache.plan;
};

const readDefaultPlan = () => DEFAULT_PLAN;

const subscribePlan = (onChange: () => void) => {
  planListeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    planListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
};

const savePlan = (plan: FocusPlanChoice) => {
  const raw = JSON.stringify(plan);
  planCache = { raw, plan };
  try {
    window.localStorage.setItem(PLAN_KEY, raw);
  } finally {
    planListeners.forEach((listener) => listener());
  }
};

export const useFocusPlan = () => useSyncExternalStore(subscribePlan, readPlan, readDefaultPlan);

const serverPlan = (plan: FocusPlanChoice) =>
  plan.mode === "open"
    ? ({ kind: "open" } as const)
    : ({ kind: "pomodoro", focusMinutes: plan.focusMinutes, breakMinutes: plan.breakMinutes } as const);

const TICK_MS = 250;

const subscribeSecond = (onChange: () => void) => {
  const timer = setInterval(onChange, TICK_MS);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onChange);
  };
};

const subscribeNever = () => () => undefined;
const readSecond = () => Math.floor(Date.now() / 1000);
const readZero = () => 0;

export const useFocusNow = (ticking: boolean) =>
  useSyncExternalStore(ticking ? subscribeSecond : subscribeNever, ticking ? readSecond : readZero, readZero) * 1000;

const FocusContext = createContext<ActiveFocus | null>(null);

export const FocusProvider = ({ children }: { children: ReactNode }) => (
  <FocusContext value={useQuietView(api.planner.focus.current, {}) ?? null}>{children}</FocusContext>
);

export const useActiveFocus = () => use(FocusContext);

export const useFocusOn = (taskId: string) => {
  const active = useActiveFocus();
  return active?.taskId === taskId ? active : null;
};

export const useActualMs = (task: PlannerTask) => {
  const active = useFocusOn(task._id);
  const counting = active?.kind === "focus" ? active : null;
  const now = useFocusNow(counting?.state.kind === "running");
  return task.focus.ms + (counting ? focusedMs(counting, now) : 0);
};

export const useLiveFocus = () => {
  const active = useActiveFocus();
  const counting = active?.kind === "focus" ? active : null;
  const now = useFocusNow(counting?.state.kind === "running");
  return { taskId: counting?.taskId, ms: counting ? focusedMs(counting, now) : 0 };
};

const wholeMinutes = (ms: number) => Math.floor(ms / MINUTE_MS);

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

const withFocus = (taskId: Id<"tasks">, patch: (sessions: Logged[]) => Logged[]) =>
  patchTask(taskId, (task) => {
    const sessions = patch(task.focus.sessions);
    return { ...task, focus: { ms: sessions.reduce((sum, session) => sum + session.ms, task.focus.ms - task.focus.sessions.reduce((sum, session) => sum + session.ms, 0)), sessions } };
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
    ...(pomodoro ? { plannedMinutes: kind === "focus" ? pomodoro.focusMinutes : pomodoro.breakMinutes, pomodoro } : {}),
  }) satisfies ActiveFocus;

let startedVia: Via = "pointer";

export const useFocusActions = () => {
  const change = useChange();
  const active = useActiveFocus();
  return useMemo(() => {
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

      start: (task: PlannerTask, via: Via) => {
        const now = Date.now();
        if (active?.taskId === task._id && active.kind === "focus" && !isTimeUp(active, now)) return resume();
        const plan = readPlan();
        startedVia = via;
        const next = optimisticSession(
          { taskId: task._id, title: task.title, colour: task.area?.colour },
          "focus",
          plan.mode === "pomodoro" ? { focusMinutes: plan.focusMinutes, breakMinutes: plan.breakMinutes } : undefined,
          now,
        );
        void change({
          title: active ? "Focus switched" : "Focus started",
          mutation: api.planner.focus.start,
          args: { taskId: task._id, plan: serverPlan(plan) },
          apply: both(active ? logged(active, now) : nothing, setCurrent(next)),
          revert: both(active ? unlogged(active) : nothing, setCurrent(active)),
        });
      },

      stop: () => {
        if (!live) return;
        const now = Date.now();
        const minutes = wholeMinutes(focusedMs(live, now));
        void change({
          title:
            live.kind === "break"
              ? "Break ended"
              : minutes > 0
                ? `Focused for ${formatMinutes(minutes)}`
                : "Focus Session stopped",
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
        void change({
          title: live.kind === "focus" ? "Break started" : "Focus Session started",
          mutation: api.planner.focus.advance,
          args: { sessionId: live._id },
          apply: both(logged(live, now), setCurrent(optimisticSession(live, live.kind === "focus" ? "break" : "focus", live.pomodoro, now))),
          revert: both(unlogged(live), setCurrent(live)),
          silent: true,
        });
      },

      setPlan: (plan: FocusPlanChoice) => {
        savePlan(plan);
        if (live?.kind !== "focus") return;
        const pomodoro = { focusMinutes: plan.focusMinutes, breakMinutes: plan.breakMinutes };
        void change({
          title: "Focus mode changed",
          mutation: api.planner.focus.setPlan,
          args: { sessionId: live._id, plan: serverPlan(plan) },
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
            sessions.map((session) =>
              session._id === sessionId ? { ...session, start: session.end - minutes * MINUTE_MS, ms: minutes * MINUTE_MS } : session,
            ),
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
  }, [change, active]);
};

const viewOf: (active: ActiveFocus, now: number) => FocusPillView = (active, now) => {
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
  };
};

const useCrossing = (active: ActiveFocus, over: boolean) => {
  const [crossed, setCrossed] = useState<string | null>(null);
  const watched = useRef<{ id: string; over: boolean } | null>(null);
  useEffect(() => {
    const before = watched.current;
    watched.current = { id: active._id, over };
    if (!over || before?.id !== active._id || before.over) return;
    setCrossed(active._id);
    haptic("complete");
  }, [active._id, over]);
  return over && crossed === active._id;
};

const PlanMenu = ({ active }: { active: ActiveFocus }) => {
  const plan = useFocusPlan();
  const actions = useFocusActions();
  const timed = active.plannedMinutes !== undefined;
  return (
    <Popover
      side="top"
      align="end"
      title="Focus"
      className="w-[17.5rem]"
      trigger={
        <PillButton label="Focus options">
          <DotsThree weight="bold" className="size-[18px]" aria-hidden="true" />
        </PillButton>
      }
    >
      <div className="space-y-2 px-1 pb-1">
        <FocusPlanPanel plan={plan} onChange={actions.setPlan} />
        {timed && (
          <PopoverClose asChild>
            <MenuRow onClick={() => actions.extend(5)} className="-mx-2 w-[calc(100%+1rem)]">
              <Plus weight="bold" className="size-4 text-muted-foreground" aria-hidden="true" />
              Add 5{"\u00A0"}Minutes
            </MenuRow>
          </PopoverClose>
        )}
      </div>
    </Popover>
  );
};

const LivePill = ({ active }: { active: ActiveFocus }) => {
  const actions = useFocusActions();
  const now = useFocusNow(active.state.kind === "running");
  const view = viewOf(active, now);
  const celebrate = useCrossing(active, view.status === "done");
  return (
    <FocusTimerPill
      view={view}
      celebrate={celebrate}
      onPause={actions.pause}
      onResume={actions.resume}
      onAdvance={active.pomodoro ? actions.advance : undefined}
      onStop={actions.stop}
      onExtend={() => actions.extend(5)}
      more={<PlanMenu active={active} />}
    />
  );
};

export const FocusPill = () => {
  const active = useActiveFocus();
  const reduce = useReducedMotion();
  const { openCard } = useShell();
  const lifted = useSelectionSize() > 1 && !openCard;
  const still = reduce || startedVia === "keyboard";
  const rest = `translateY(${lifted ? -SELECTION_BAR_LIFT : 0}px) scale(1)`;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:left-60 lg:left-64">
      <AnimatePresence>
        {active && (
          <motion.div
            key="focus-pill"
            initial={still ? false : { opacity: 0, transform: "translateY(16px) scale(0.96)" }}
            animate={{ opacity: 1, transform: rest, transition: reduce ? instant : springLift }}
            exit={{ opacity: 0, transform: reduce ? rest : "translateY(10px) scale(1)", transition: reduce ? instant : { duration: 0.14 } }}
            className="pointer-events-auto flex max-w-full min-w-0"
          >
            <LivePill active={active} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export const FocusBadge = ({ active }: { active: ActiveFocus }) => {
  const running = active.state.kind === "running";
  const now = useFocusNow(running);
  const view = viewOf(active, now);
  return (
    <span
      title={view.phase === "break" ? "On a break" : running ? "In focus now" : "Focus Session paused"}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 font-mono text-small transition-colors duration-(--dur-fast) ease-out",
        view.status === "paused" ? "text-muted-foreground" : view.phase === "break" || view.status === "done" ? "text-positive" : "text-brand",
      )}
    >
      <DotRing
        remaining={view.status === "done" ? 1 : view.ring}
        fills={!view.timed}
        size={16}
        dot={1}
        litClassName="fill-current"
        className={cn(view.status === "paused" && "opacity-60")}
      />
      <span className="sr-only">{view.phase === "break" ? "Break, " : "Focus Session, "}</span>
      {formatCountdown(Math.max(0, view.seconds))}
    </span>
  );
};

export const FocusTool = ({ task }: { task: PlannerTask }) => {
  const active = useFocusOn(task._id);
  const actions = useFocusActions();
  const ours = active?.kind === "focus" ? active : null;
  const label = !ours ? "Focus" : ours.state.kind === "paused" ? "Resume" : "Pause";
  return (
    <ToolButton
      icon={Timer}
      label={ours ? `${label} the Focus Session` : "Start a Focus Session"}
      active={ours !== null}
      onClick={(event) => {
        if (event.detail > 0) haptic("toggle");
        if (ours) actions.toggle();
        else actions.start(task, event.detail === 0 ? "keyboard" : "pointer");
      }}
    >
      <span className="pl-1.5 whitespace-nowrap">{label}</span>
    </ToolButton>
  );
};

export const FocusSection = ({ task, today }: { task: PlannerTask; today: string }) => {
  const reduce = useReducedMotion();
  const actions = useFocusActions();
  const active = useFocusOn(task._id);
  const minutes = wholeMinutes(useActualMs(task));
  const estimate = task.estimateMinutes;
  const over = estimate === undefined ? 0 : minutes - estimate;
  const todays = task.focus.sessions.filter((session) => localDate(session.end) === today);
  const shown = minutes > 0 || task.focus.sessions.length > 0 || active?.kind === "focus";
  return (
    <AnimatePresence initial={false}>
      {shown && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={reduce ? instant : springLayout}
          className="overflow-hidden"
        >
          <div className="space-y-2 pb-px">
            <div role="group" aria-label="Actual Time" className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1 @md:gap-x-1.5">
              <span className="hidden w-[3.75rem] text-small text-muted-foreground @md:inline">Actual</span>
              <ActualMeter actual={minutes} estimate={estimate} colour={task.area ? areaVar(task.area.colour) : undefined} className="mr-1" />
              <RollingNumber value={formatMinutes(minutes)} className={cn("font-mono text-small", over > 0 && "text-negative")} />
              {estimate !== undefined && (
                <span className="text-small text-muted-foreground">
                  of <span className="font-mono">{formatMinutes(estimate)}</span>
                </span>
              )}
              {over > 0 && (
                <span className="ml-1 text-small text-negative">
                  <span className="font-mono">{formatMinutes(over)}</span> over
                </span>
              )}
            </div>
            <FocusHistory
              entries={todays.map((session) => ({
                id: session._id,
                at: clockTime(session.start),
                range: `${clockTime(session.start)} to ${clockTime(session.end)}`,
                minutes: Math.max(1, wholeMinutes(session.ms)),
              }))}
              earlier={task.focus.sessions.length - todays.length}
              empty={active?.kind === "focus" ? "In focus now" : "No focus yet today"}
              onEdit={(id, length) => actions.editSession(task, id, length)}
              onRemove={(id) => actions.removeSession(task, id)}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
