"use client";

import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import type { PlannerTask } from "@lifeos/backend/types";
import { registry } from "../../../lib/atoms";

export type BarState =
  | { kind: "closed" }
  | { kind: "commands"; targets: readonly PlannerTask[] }
  | { kind: "capture"; text: string; failed: boolean; opened: number }
  | { kind: "shortcuts" };

const CLOSED: BarState = { kind: "closed" };

const barAtom = Atom.make<BarState>(CLOSED).pipe(Atom.keepAlive);

let opened = 0;

const publish = (next: BarState) => registry.set(barAtom, next);

export const bar = {
  state: () => registry.get(barAtom),
  commands: (targets: readonly PlannerTask[]) => publish({ kind: "commands", targets }),
  capture: (text = "", failed = false) => {
    opened += 1;
    publish({ kind: "capture", text, failed, opened });
  },
  shortcuts: () => publish({ kind: "shortcuts" }),
  close: () => {
    if (registry.get(barAtom).kind !== "closed") publish(CLOSED);
  },
};

export const useBar = () => useAtomValue(barAtom);
