"use client";

import { useSyncExternalStore } from "react";
import type { Id } from "@lifeos/backend/dataModel";

type Opened = { jobId: Id<"jobs">; at: number } | null;

let opened: Opened = null;
const listeners = new Set<() => void>();

export const openRun = (jobId: Id<"jobs"> | null) => {
  opened = jobId ? { jobId, at: Date.now() } : null;
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useOpenRun = () =>
  useSyncExternalStore(
    subscribe,
    () => opened,
    () => null,
  );
