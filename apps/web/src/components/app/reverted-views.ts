"use client";

import { useMemo, useSyncExternalStore } from "react";
import { rewriteView, type Updater } from "./local-views";

const NONE: readonly Updater[] = [];

let reverts = NONE;
const listeners = new Set<() => void>();

const publish = (next: readonly Updater[]) => {
  reverts = next;
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

const read = () => reverts;
const readServer = () => NONE;

export const showReverted = (revert: Updater) => {
  publish([...reverts, revert]);
  return () => publish(reverts.filter((each) => each !== revert));
};

export const useReverted = (name: string, argsKey: string | null, live: unknown) => {
  const pending = useSyncExternalStore(subscribe, read, readServer);
  return useMemo(() => {
    if (pending.length === 0 || argsKey === null || live === undefined || live instanceof Error) return live;
    const args = JSON.parse(argsKey) as Record<string, unknown>;
    return pending.reduce<unknown>((shown, revert) => rewriteView(revert, name, args, shown), live);
  }, [pending, name, argsKey, live]);
};
