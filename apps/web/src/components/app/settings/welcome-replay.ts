"use client";

import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { registry } from "../../../lib/atoms";

const askedInUrl = () => import.meta.env.DEV && typeof window !== "undefined" && new URLSearchParams(window.location.search).has("welcome");

const replayingAtom = Atom.writable(askedInUrl, (ctx, next: boolean) => ctx.setSelf(next)).pipe(
  Atom.withServerValue(() => false),
  Atom.keepAlive,
);

export const replayWelcome = () => registry.set(replayingAtom, true);
export const endWelcomeReplay = () => registry.set(replayingAtom, false);
export const useWelcomeReplay = () => useAtomValue(replayingAtom);
