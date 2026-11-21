"use client";

import { Bell, DotsThree, Plus, Timer } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { createContext, use, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { api } from "@lifeos/backend/api";
import { focusActions, isFocusingOn, viewOf, wholeMinutes, type ActiveFocus } from "@lifeos/backend/client/focus";
import { DEFAULT_FOCUS_PLAN, focusedMs, type FocusPlanChoice } from "@lifeos/backend/focus";
import type { PlannerTask } from "@lifeos/backend/types";
import { areaVar } from "@/components/lifeos/area";
import {
  ActualMeter,
  DotRing,
  FocusHistory,
  FocusPlanPanel,
  FocusTimerPill,
  PillButton,
} from "@/components/lifeos/focus-timer";
import { formatCountdown, formatMinutes } from "@/components/lifeos/format";
import { MenuRow, ToolButton } from "@/components/lifeos/tool-button";
import { Popover, PopoverClose } from "@/components/ui/popover-panel";
import { RollingNumber } from "@/components/ui/rolling-number";
import { askForWebAlerts, useWebAlertStatus } from "@/lib/alerts";
import { haptic } from "@/lib/haptics";
import { useMac } from "@/lib/mac";
import { instant, springLayout, springLift } from "@/lib/motion-tokens";
import { cn } from "@/lib/utils";
import { useChange } from "./changes";
import { clockTime, localDate } from "./dates";
import { useQuietView } from "./hooks";
import { useSelectionSize } from "./selection";
import { useShell } from "./shell-context";
import { askFor, useMacState } from "./settings/mac-state";

export type { ActiveFocus };
type Via = "pointer" | "keyboard";

const SELECTION_BAR_LIFT = 64;

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
const FocusPlanContext = createContext<FocusPlanChoice>(DEFAULT_FOCUS_PLAN);

export const FocusProvider = ({ children }: { children: ReactNode }) => (
  <FocusPlanContext value={useQuietView(api.planner.focus.plan, {}) ?? DEFAULT_FOCUS_PLAN}>
    <FocusContext value={useQuietView(api.planner.focus.current, {}) ?? null}>{children}</FocusContext>
  </FocusPlanContext>
);

export const useActiveFocus = () => use(FocusContext);

export const useFocusPlan = () => use(FocusPlanContext);

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

let startedVia: Via = "pointer";

export const useFocusActions = () => {
  const change = useChange();
  const active = useActiveFocus();
  const chosen = useFocusPlan();
  const mac = useMac();
  return useMemo(() => {
    const actions = focusActions(change, active, chosen);
    return {
      ...actions,
      start: (task: PlannerTask, via: Via) => {
        if (!isFocusingOn(active, task._id, Date.now())) {
          startedVia = via;
          if (chosen.mode === "pomodoro" && !mac) askForWebAlerts();
        }
        actions.start(task);
      },
    };
  }, [change, active, chosen, mac]);
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

const useAlertPermission = () => {
  const mac = useMac();
  const macState = useMacState(mac);
  const web = useWebAlertStatus();
  if (!mac) return { status: web, ask: askForWebAlerts, where: "browser" } as const;
  return { status: macState?.permissions.notifications ?? "missing", ask: () => void askFor(mac, "notifications"), where: "mac" } as const;
};

const AlertRow = () => {
  const { status, ask, where } = useAlertPermission();
  if (status === "granted" || status === "missing") return null;
  const blocked = status === "denied";
  return (
    <div className="flex min-h-9 items-center gap-2 border-t border-border pt-2 text-small">
      <Bell weight="fill" className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 text-pretty text-muted-foreground">
        {!blocked ? "Get a notification when time is up" : where === "mac" ? "Notifications are off for LifeOS." : "This browser blocks notifications from LifeOS."}
      </span>
      {(!blocked || where === "mac") && (
        <button
          type="button"
          onClick={ask}
          className="h-7 shrink-0 rounded-md bg-foreground/[0.06] px-2.5 font-medium text-foreground transition-[background-color,scale] duration-(--dur-press) ease-out hover:bg-foreground/[0.1] active:scale-[0.96]"
        >
          {blocked ? "Open Settings" : "Allow"}
        </button>
      )}
    </div>
  );
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
      className="w-[21rem]"
      trigger={
        <PillButton label="Focus options">
          <DotsThree weight="bold" className="size-[18px]" aria-hidden="true" />
        </PillButton>
      }
    >
      <div className="space-y-2 px-1 pb-1">
        <FocusPlanPanel plan={plan} onChange={actions.setPlan} />
        {plan.mode === "pomodoro" && <AlertRow />}
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
