"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { PlannerTask } from "@lifeos/backend/types";

type Selection = { keys: ReadonlySet<string>; anchor: string | null; cursor: string | null };

const EMPTY: Selection = { keys: new Set(), anchor: null, cursor: null };

let current = EMPTY;
let lingering: ReadonlySet<string> = new Set();
let registered = 0;
const listeners = new Set<() => void>();
const tasks = new Map<string, PlannerTask>();

const leaving = new Set<string>();

let announcing = false;

const announce = () => {
  if (announcing) return;
  announcing = true;
  queueMicrotask(() => {
    announcing = false;
    registered += 1;
    listeners.forEach((listener) => listener());
  });
};

const publish = (next: Selection) => {
  current = next;
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

const between = (ordered: readonly string[], from: string, to: string) => {
  const start = ordered.indexOf(from);
  const end = ordered.indexOf(to);
  if (start === -1 || end === -1) return [to];
  return ordered.slice(Math.min(start, end), Math.max(start, end) + 1);
};

export const rowKeys = () =>
  [...document.querySelectorAll<HTMLElement>("#main [data-task-key]")].flatMap((row) => (row.dataset.taskKey ? [row.dataset.taskKey] : []));

export const selection = {
  has: (key: string) => current.keys.has(key),
  size: () => current.keys.size,
  cursor: () => current.cursor,
  only: (key: string) => publish({ keys: new Set([key]), anchor: key, cursor: key }),
  toggle: (key: string) => {
    const keys = new Set(current.keys);
    if (!keys.delete(key)) keys.add(key);
    publish({ keys, anchor: key, cursor: key });
  },
  extendTo: (key: string, ordered: readonly string[] = rowKeys()) => {
    const anchor = current.anchor && ordered.includes(current.anchor) ? current.anchor : key;
    publish({ keys: new Set(between(ordered, anchor, key)), anchor, cursor: key });
  },
  set: (keys: readonly string[], anchor: string | null = keys[0] ?? null) =>
    publish(keys.length === 0 ? EMPTY : { keys: new Set(keys), anchor, cursor: keys.at(-1) ?? null }),
  all: () => selection.set(rowKeys()),
  clear: () => {
    if (current.keys.size > 0) publish(EMPTY);
  },
  keys: () => [...current.keys],
  tasks: () => {
    const seen = new Set<string>();
    return rowKeys().flatMap((key) => {
      const task = current.keys.has(key) ? tasks.get(key) : undefined;
      if (!task || seen.has(task._id)) return [];
      seen.add(task._id);
      return [task];
    });
  },
  task: (key: string) => tasks.get(key),
  register: (key: string, task: PlannerTask) => {
    leaving.delete(key);
    tasks.set(key, task);
    announce();
  },
  forget: (key: string) => {
    leaving.add(key);
    queueMicrotask(() => {
      if (!leaving.delete(key)) return;
      tasks.delete(key);
      if (!current.keys.has(key)) return;
      const keys = new Set(current.keys);
      keys.delete(key);
      publish(keys.size === 0 ? EMPTY : { ...current, keys });
    });
  },
  linger: (ids: readonly string[], on: boolean) => {
    const next = new Set(lingering);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    lingering = next;
    listeners.forEach((listener) => listener());
  },
  isLingering: (id: string) => lingering.has(id),
};

export const useRegisteredTask = (key: string, task: PlannerTask) => {
  useEffect(() => selection.register(key, task), [key, task]);
  useEffect(() => () => selection.forget(key), [key]);
};

export const useSelected = (key: string) =>
  useSyncExternalStore(
    subscribe,
    () => current.keys.has(key),
    () => false,
  );

export const useSelectionSize = () =>
  useSyncExternalStore(
    subscribe,
    () => current.keys.size,
    () => 0,
  );

export const useRegisteredTasks = () =>
  useSyncExternalStore(
    subscribe,
    () => registered,
    () => 0,
  );

export const useLingering = (id: string) =>
  useSyncExternalStore(
    subscribe,
    () => lingering.has(id),
    () => false,
  );
