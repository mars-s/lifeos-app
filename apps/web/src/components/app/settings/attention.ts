"use client";

import { api } from "@lifeos/backend/api";
import type { IsoDate } from "@lifeos/backend/date";
import { PERMISSIONS, useMac } from "@/lib/mac";
import { useQuietView } from "../hooks";
import { ouraStoppedSharing } from "../oura";
import { useMacState, type MacState } from "./mac-state";

export const macNeedsAttention = (state: MacState | null, thingsRetired: boolean) => {
  if (!state) return false;
  const blocked = PERMISSIONS.some((permission) => {
    const status = state.permissions[permission];
    if (permission === "thingsData") return !thingsRetired && (status === "denied" || status === "notAsked");
    return status === "denied" || status === "notAsked" || (permission === "keychain" && status === "missing");
  });
  const failed = (!thingsRetired && state.report.things?.error != null) || state.report.calendar?.error != null;
  return blocked || failed;
};

export const useNeedsAttention = (today: IsoDate) => {
  const macState = useMacState(useMac());
  const things = useQuietView(api.planner.things.status, {});
  const sleep = useQuietView(api.health.sleep.status, { today });
  return macNeedsAttention(macState, things?.retiredAt !== undefined) || ouraStoppedSharing(sleep);
};
