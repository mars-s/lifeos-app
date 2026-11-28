"use client";

import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import type { Id } from "@lifeos/backend/dataModel";
import { registry } from "../../../lib/atoms";

type Opened = { jobId: Id<"jobs">; at: number } | null;

const openedAtom = Atom.make<Opened>(null).pipe(Atom.keepAlive);

export const openRun = (jobId: Id<"jobs"> | null) => registry.set(openedAtom, jobId ? { jobId, at: Date.now() } : null);

export const useOpenRun = () => useAtomValue(openedAtom);
