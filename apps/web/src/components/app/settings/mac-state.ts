"use client";

import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { registry } from "../../../lib/atoms";
import type { Mac, Permission, Permissions, SyncReport } from "@/lib/mac";

export type MacState = { permissions: Permissions; report: SyncReport; asking: Permission | null };

const REFRESH_MS = 20_000;

const stateAtom = Atom.make<MacState | null>(null).pipe(Atom.keepAlive);

const publish = (next: MacState) => {
  const state = registry.get(stateAtom);
  if (state && JSON.stringify(state) === JSON.stringify(next)) return;
  registry.set(stateAtom, next);
};

export const refreshMac = (mac: Mac) =>
  Promise.all([mac.permissions(), mac.syncReport()]).then(
    ([permissions, report]) => publish({ permissions, report, asking: registry.get(stateAtom)?.asking ?? null }),
    () => undefined,
  );

export const askFor = async (mac: Mac, permission: Permission) => {
  const before = registry.get(stateAtom);
  if (before) publish({ ...before, asking: permission });
  const status = await mac.request(permission).catch(() => null);
  const state = registry.get(stateAtom);
  if (state) publish({ ...state, asking: null, permissions: status ? { ...state.permissions, [permission]: status } : state.permissions });
  void refreshMac(mac);
  return status;
};

const watchedAtom = Atom.family((mac: Mac) => {
  const refresh = () => void refreshMac(mac);
  return Atom.make((get) => {
    const timer = setInterval(refresh, REFRESH_MS);
    window.addEventListener("focus", refresh);
    get.addFinalizer(() => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    });
    get.subscribe(stateAtom, (next) => get.setSelf(next));
    refresh();
    return get.once(stateAtom);
  });
});

const unwatchedAtom = Atom.make<MacState | null>(null);

export const useMacState = (mac: Mac | null) => useAtomValue(mac ? watchedAtom(mac) : unwatchedAtom);
