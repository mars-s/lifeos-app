"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { Mac, Permission, Permissions, SyncReport } from "@/lib/mac";

export type MacState = { permissions: Permissions; report: SyncReport; asking: Permission | null };

const REFRESH_MS = 20_000;

let state: MacState | null = null;
const listeners = new Set<() => void>();

const publish = (next: MacState) => {
  if (state && JSON.stringify(state) === JSON.stringify(next)) return;
  state = next;
  listeners.forEach((listener) => listener());
};

export const refreshMac = (mac: Mac) =>
  Promise.all([mac.permissions(), mac.syncReport()]).then(
    ([permissions, report]) => publish({ permissions, report, asking: state?.asking ?? null }),
    () => undefined,
  );

export const askFor = async (mac: Mac, permission: Permission) => {
  if (state) publish({ ...state, asking: permission });
  const status = await mac.request(permission).catch(() => null);
  if (state) publish({ ...state, asking: null, permissions: status ? { ...state.permissions, [permission]: status } : state.permissions });
  void refreshMac(mac);
  return status;
};

const watch = (mac: Mac) => {
  const refresh = () => void refreshMac(mac);
  return (listener: () => void) => {
    listeners.add(listener);
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    window.addEventListener("focus", refresh);
    return () => {
      listeners.delete(listener);
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  };
};

const idle = () => () => undefined;
const read = () => state;
const readNothing = () => null;

export const useMacState = (mac: Mac | null) => {
  const subscribe = useMemo(() => (mac ? watch(mac) : idle), [mac]);
  return useSyncExternalStore(subscribe, mac ? read : readNothing, readNothing);
};
