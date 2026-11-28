"use client";

import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useCallback, useEffect } from "react";
import type { PlannerTask } from "@lifeos/backend/types";
import { registry } from "../../lib/atoms";

type Selection = { keys: ReadonlySet<string>; anchor: string | null; cursor: string | null };

const EMPTY: Selection = { keys: new Set(), anchor: null, cursor: null };

const selectionAtom = Atom.make(EMPTY).pipe(Atom.keepAlive);
const lingeringAtom = Atom.make<ReadonlySet<string>>(new Set<string>()).pipe(Atom.keepAlive);
const registeredAtom = Atom.make(0).pipe(Atom.keepAlive);
const tasks = new Map<string, PlannerTask>();

const leaving = new Set<string>();

let announcing = false;

const announce = () => {
  if (announcing) return;
  announcing = true;
  queueMicrotask(() => {
    announcing = false;
    registry.update(registeredAtom, (registered) => registered + 1);
  });
};

const now = () => registry.get(selectionAtom);

const publish = (next: Selection) => registry.set(selectionAtom, next);

const between = (ordered: readonly string[], from: string, to: string) => {
  const start = ordered.indexOf(from);
  const end = ordered.indexOf(to);
  if (start === -1 || end === -1) return [to];
  return ordered.slice(Math.min(start, end), Math.max(start, end) + 1);
};

export const rowKeys = () =>
  [...document.querySelectorAll<HTMLElement>("#main [data-task-key]")].flatMap((row) => (row.dataset.taskKey ? [row.dataset.taskKey] : []));

export const selection = {
  has: (key: string) => now().keys.has(key),
  size: () => now().keys.size,
  cursor: () => now().cursor,
  only: (key: string) => publish({ keys: new Set([key]), anchor: key, cursor: key }),
  toggle: (key: string) => {
    const keys = new Set(now().keys);
    if (!keys.delete(key)) keys.add(key);
    publish({ keys, anchor: key, cursor: key });
  },
  extendTo: (key: string, ordered: readonly string[] = rowKeys()) => {
    const { anchor: held } = now();
    const anchor = held && ordered.includes(held) ? held : key;
    publish({ keys: new Set(between(ordered, anchor, key)), anchor, cursor: key });
  },
  set: (keys: readonly string[], anchor: string | null = keys[0] ?? null) =>
    publish(keys.length === 0 ? EMPTY : { keys: new Set(keys), anchor, cursor: keys.at(-1) ?? null }),
  all: () => selection.set(rowKeys()),
  clear: () => {
    if (now().keys.size > 0) publish(EMPTY);
  },
  keys: () => [...now().keys],
  tasks: () => {
    const seen = new Set<string>();
    const { keys } = now();
    return rowKeys().flatMap((key) => {
      const task = keys.has(key) ? tasks.get(key) : undefined;
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
      const current = now();
      if (!current.keys.has(key)) return;
      const keys = new Set(current.keys);
      keys.delete(key);
      publish(keys.size === 0 ? EMPTY : { ...current, keys });
    });
  },
  linger: (ids: readonly string[], on: boolean) => {
    const next = new Set(registry.get(lingeringAtom));
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    registry.set(lingeringAtom, next);
  },
  isLingering: (id: string) => registry.get(lingeringAtom).has(id),
};

export const useRegisteredTask = (key: string, task: PlannerTask) => {
  useEffect(() => selection.register(key, task), [key, task]);
  useEffect(() => () => selection.forget(key), [key]);
};

const sizeOf = (current: Selection) => current.keys.size;

export const useSelected = (key: string) => useAtomValue(selectionAtom, useCallback((current: Selection) => current.keys.has(key), [key]));

export const useSelectionSize = () => useAtomValue(selectionAtom, sizeOf);

export const useRegisteredTasks = () => useAtomValue(registeredAtom);

export const useLingering = (id: string) => useAtomValue(lingeringAtom, useCallback((lingering: ReadonlySet<string>) => lingering.has(id), [id]));
