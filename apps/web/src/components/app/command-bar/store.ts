"use client";

import { useSyncExternalStore } from "react";
import type { PlannerTask } from "@lifeos/backend/types";

export type BarState =
  | { kind: "closed" }
  | { kind: "commands"; targets: readonly PlannerTask[] }
  | { kind: "capture"; text: string; failed: boolean; opened: number }
  | { kind: "shortcuts" };

const CLOSED: BarState = { kind: "closed" };

let current: BarState = CLOSED;
let opened = 0;
const listeners = new Set<() => void>();

const publish = (next: BarState) => {
  current = next;
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const bar = {
  state: () => current,
  commands: (targets: readonly PlannerTask[]) => publish({ kind: "commands", targets }),
  capture: (text = "", failed = false) => {
    opened += 1;
    publish({ kind: "capture", text, failed, opened });
  },
  shortcuts: () => publish({ kind: "shortcuts" }),
  close: () => {
    if (current.kind !== "closed") publish(CLOSED);
  },
};

export const useBar = () =>
  useSyncExternalStore(
    subscribe,
    () => current,
    () => CLOSED,
  );
