import { createContext, use, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { AppState } from "react-native";
import { api } from "@lifeos/backend/api";
import { focusActions, isFocusingOn, type ActiveFocus, type FocusActions } from "@lifeos/backend/client/focus";
import { DEFAULT_FOCUS_PLAN, focusedMs, type FocusPlanChoice } from "@lifeos/backend/focus";
import type { PlannerTask } from "@lifeos/backend/types";
import { change } from "@/lib/change";
import { convex } from "@/lib/convex";
import { askForAlerts } from "@/lib/focus-alerts";
import { useView } from "@/lib/views";

const TICK_MS = 250;

const subscribeSecond = (onChange: () => void) => {
  const timer = setInterval(onChange, TICK_MS);
  const foreground = AppState.addEventListener("change", onChange);
  return () => {
    clearInterval(timer);
    foreground.remove();
  };
};

const subscribeNever = () => () => undefined;
const readSecond = () => Math.floor(Date.now() / 1000);
const readZero = () => 0;

export const useFocusNow = (ticking: boolean) =>
  useSyncExternalStore(ticking ? subscribeSecond : subscribeNever, ticking ? readSecond : readZero) * 1000;

type Focus = { active: ActiveFocus | null; plan: FocusPlanChoice; actions: FocusActions };

const withAlerts = (actions: FocusActions, active: ActiveFocus | null, plan: FocusPlanChoice) =>
  ({
    ...actions,
    start: (task: PlannerTask) => {
      if (plan.mode === "pomodoro" && !isFocusingOn(active, task._id, Date.now())) askForAlerts();
      actions.start(task);
    },
  }) satisfies FocusActions;

const idle = { active: null, plan: DEFAULT_FOCUS_PLAN, actions: focusActions(change, null, DEFAULT_FOCUS_PLAN) } satisfies Focus;

const FocusContext = createContext<Focus>(idle);

let latest: Focus = idle;

export const currentFocus = () => latest;

export const FocusProvider = ({ children }: { children: ReactNode }) => {
  const active = useView(api.planner.focus.current, convex ? {} : "skip") ?? null;
  const plan = useView(api.planner.focus.plan, convex ? {} : "skip") ?? DEFAULT_FOCUS_PLAN;
  const focus = useMemo(() => ({ active, plan, actions: withAlerts(focusActions(change, active, plan), active, plan) }), [active, plan]);
  useEffect(() => {
    latest = focus;
  }, [focus]);
  return <FocusContext value={focus}>{children}</FocusContext>;
};

export const useFocus = () => use(FocusContext);

export const useActiveFocus = () => use(FocusContext).active;

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
