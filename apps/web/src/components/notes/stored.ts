"use client";

import { useSyncExternalStore } from "react";

const listeners = new Map<string, Set<() => void>>();

export const readStored = (key: string) => {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

export const writeStored = (key: string, value: string) => {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    return;
  } finally {
    for (const listener of listeners.get(key) ?? []) listener();
  }
};

export const useStored = (key: string) =>
  useSyncExternalStore(
    (listener) => {
      const set = listeners.get(key) ?? new Set();
      set.add(listener);
      listeners.set(key, set);
      return () => set.delete(listener);
    },
    () => readStored(key),
    () => null,
  );
