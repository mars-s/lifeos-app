"use client";

import { useSyncExternalStore } from "react";

let replaying: boolean | undefined;
const listeners = new Set<() => void>();

const askedInUrl = () => import.meta.env.DEV && new URLSearchParams(window.location.search).has("welcome");

const read = () => (replaying ??= askedInUrl());
const readNothing = () => false;

const set = (next: boolean) => {
  replaying = next;
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const replayWelcome = () => set(true);
export const endWelcomeReplay = () => set(false);
export const useWelcomeReplay = () => useSyncExternalStore(subscribe, read, readNothing);
