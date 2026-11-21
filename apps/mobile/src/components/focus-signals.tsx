import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { timeUpAlert, type ActiveFocus } from "@lifeos/backend/client/focus";
import { isTimeUp } from "@lifeos/backend/focus";
import { quietInForeground, scheduleTimeUp } from "@/lib/focus-alerts";
import { haptic } from "@/lib/haptics";
import { useActiveFocus, useFocusNow } from "@/lib/focus";

const FRESH_MS = 3000;

const useTimeUpAlert = (active: ActiveFocus | null) => {
  const alert = active ? timeUpAlert(active) : null;
  const endsAt = alert?.endsAt;
  const title = alert?.title ?? "";
  const body = alert?.body ?? "";
  useEffect(() => {
    void scheduleTimeUp(endsAt === undefined ? null : { endsAt, title, body });
  }, [endsAt, title, body]);
};

const TimeUpHaptic = ({ active }: { active: ActiveFocus }) => {
  const now = useFocusNow(active.state.kind === "running");
  const up = isTimeUp(active, now);
  const watched = useRef<{ id: string; up: boolean } | null>(null);
  const endsAt = timeUpAlert(active)?.endsAt;
  useEffect(() => {
    const before = watched.current;
    watched.current = { id: active._id, up };
    if (!up || before?.id !== active._id || before.up) return;
    const fresh = endsAt === undefined || Date.now() - endsAt < FRESH_MS;
    if (fresh && AppState.currentState === "active") haptic("complete");
  }, [active._id, up, endsAt]);
  return null;
};

export const FocusSignals = () => {
  const active = useActiveFocus();
  useEffect(quietInForeground, []);
  useTimeUpAlert(active);
  return active ? <TimeUpHaptic active={active} /> : null;
};
