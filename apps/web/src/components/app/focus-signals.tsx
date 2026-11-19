"use client";

import { useEffect } from "react";
import { useRouter } from "waku";
import { showWebAlert } from "@/lib/alerts";
import { useMac } from "@/lib/mac";
import { useActiveFocus, useFocusNow, viewOf, type ActiveFocus } from "./focus";
import { tabTitle, timeUpAlert } from "./focus-alert";

const FocusTitle = ({ active }: { active: ActiveFocus }) => {
  const { path } = useRouter();
  const now = useFocusNow(active.state.kind === "running");
  return <title key={path}>{tabTitle(viewOf(active, now))}</title>;
};

const ignore = () => undefined;

const useTimeUpAlert = (active: ActiveFocus | null) => {
  const mac = useMac();
  const alert = active ? timeUpAlert(active) : null;
  const endsAt = alert?.endsAt;
  const title = alert?.title ?? "";
  const body = alert?.body ?? "";
  useEffect(() => {
    const inMs = endsAt === undefined ? undefined : endsAt - Date.now();
    if (mac && inMs === undefined) void mac.cancelAlert().catch(ignore);
    if (inMs === undefined || inMs <= 0) return undefined;
    if (mac) {
      void mac.scheduleAlert({ inSeconds: inMs / 1000, title, body }).catch(ignore);
      return undefined;
    }
    const timer = setTimeout(() => showWebAlert({ title, body }), inMs);
    return () => clearTimeout(timer);
  }, [mac, endsAt, title, body]);
};

export const FocusSignals = () => {
  const active = useActiveFocus();
  useTimeUpAlert(active);
  return active ? <FocusTitle active={active} /> : null;
};
