"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { Id } from "@lifeos/backend/dataModel";
import type { IsoDate } from "@lifeos/backend/date";
import type { PlannerTask } from "@lifeos/backend/types";

const OPTIMISTIC = "optimistic:task:";
const CLOCK_SKEW_MS = 60_000;

export type DraftBlock = { date: IsoDate; minute: number; minutes: number };

type Draft = {
  key: string;
  slot: string;
  task: PlannerTask;
  known: ReadonlySet<string>;
  createdAt: number;
  taskId?: Id<"tasks">;
  save?: (title: string) => void;
  block?: DraftBlock;
  returnTo?: HTMLElement;
};

type Unsaved = { save: (title: string) => void; block?: DraftBlock; returnTo?: HTMLElement };

type Snapshot = { drafts: readonly Draft[]; adopted: ReadonlyMap<string, PlannerTask> };

const EMPTY: Snapshot = { drafts: [], adopted: new Map() };

let snapshot = EMPTY;
let count = 0;
const aliases = new Map<string, string>();
const realIds = new Map<string, Id<"tasks">>();
const waiting = new Map<string, ((taskId: Id<"tasks"> | null) => void)[]>();
const listeners = new Set<() => void>();

const publish = (next: Snapshot) => {
  snapshot = next;
  listeners.forEach((listener) => listener());
};

const settle = (key: string, taskId: Id<"tasks"> | null) => {
  waiting.get(key)?.forEach((resolve) => resolve(taskId));
  waiting.delete(key);
};

export const isDraftTask = (id: string) => id.startsWith(OPTIMISTIC);

export const drafts = {
  add: (slot: string, fields: Omit<PlannerTask, "_id" | "_creationTime">, known: ReadonlySet<string>, unsaved?: Unsaved) => {
    count += 1;
    const key = `${OPTIMISTIC}${count}`;
    const createdAt = Date.now();
    const task = { ...fields, _id: key as Id<"tasks">, _creationTime: createdAt };
    publish({ ...snapshot, drafts: [...snapshot.drafts, { key, slot, task, known, createdAt, ...unsaved }] });
    return key;
  },

  exists: (key: string) => snapshot.drafts.some((draft) => draft.key === key),

  isUnsaved: (key: string) => snapshot.drafts.some((draft) => draft.key === key && draft.save !== undefined),

  commit: (key: string, title: string) => {
    const draft = snapshot.drafts.find((candidate) => candidate.key === key);
    const trimmed = title.trim();
    if (!draft?.save || trimmed === "") return false;
    const { save } = draft;
    publish({
      ...snapshot,
      drafts: snapshot.drafts.map((candidate) =>
        candidate.key === key ? { ...candidate, save: undefined, task: { ...candidate.task, title: trimmed } } : candidate,
      ),
    });
    save(trimmed);
    return true;
  },

  discard: (key: string) => {
    const draft = snapshot.drafts.find((candidate) => candidate.key === key && candidate.save !== undefined);
    if (!draft) return undefined;
    publish({ ...snapshot, drafts: snapshot.drafts.filter((candidate) => candidate.key !== key) });
    settle(key, null);
    return draft.returnTo;
  },

  saved: (key: string, taskId: Id<"tasks">) => {
    aliases.set(taskId, key);
    realIds.set(key, taskId);
    publish({ ...snapshot, drafts: snapshot.drafts.map((draft) => (draft.key === key ? { ...draft, taskId } : draft)) });
    settle(key, taskId);
  },

  failed: (key: string) => {
    publish({ ...snapshot, drafts: snapshot.drafts.filter((draft) => draft.key !== key) });
    settle(key, null);
  },

  keepOnly: (openKey: string | undefined) => {
    const kept = snapshot.drafts.filter((draft) => draft.key === openKey || (draft.taskId === undefined && draft.save === undefined));
    if (kept.length === snapshot.drafts.length) return;
    const adopted = new Map([...snapshot.adopted].filter(([key]) => kept.some((draft) => draft.key === key)));
    const dropped = snapshot.drafts.filter((draft) => !kept.includes(draft));
    publish({ drafts: kept, adopted });
    for (const draft of dropped) if (draft.save) settle(draft.key, null);
  },

  release: (key: string) => {
    if (!snapshot.drafts.some((draft) => draft.key === key)) return;
    const adopted = new Map(snapshot.adopted);
    adopted.delete(key);
    publish({ drafts: snapshot.drafts.filter((draft) => draft.key !== key), adopted });
  },

  adopt: (key: string, task: PlannerTask) => {
    if (snapshot.adopted.get(key) === task) return;
    publish({ ...snapshot, adopted: new Map(snapshot.adopted).set(key, task) });
  },

  realId: (id: string) => realIds.get(id) ?? (id as Id<"tasks">),

  whenSaved: (key: string) =>
    new Promise<Id<"tasks"> | null>((resolve) => {
      const known = realIds.get(key);
      if (known) return resolve(known);
      if (!snapshot.drafts.some((draft) => draft.key === key)) return resolve(null);
      waiting.set(key, [...(waiting.get(key) ?? []), resolve]);
    }),

  keyFor: (taskId: string) => aliases.get(taskId) ?? taskId,

  count: (slot: string) => snapshot.drafts.filter((draft) => draft.slot === slot).length,
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

const read = () => snapshot;
const readServer = () => EMPTY;

const claims = (draft: Draft, task: PlannerTask) =>
  draft.taskId !== undefined
    ? draft.taskId === task._id
    : !draft.known.has(task._id) && task._creationTime >= draft.createdAt - CLOCK_SKEW_MS && task.title === draft.task.title;

const readBlocks = () => snapshot.drafts;

export const useDraftBlocks = () => {
  const live = useSyncExternalStore(subscribe, readBlocks, () => EMPTY.drafts);
  return useMemo(
    () => live.flatMap((draft) => (draft.block && draft.taskId === undefined ? [{ key: draft.key, title: draft.task.title, block: draft.block }] : [])),
    [live],
  );
};

export const useDraftCount = (slot: string) => useSyncExternalStore(subscribe, () => drafts.count(slot), () => 0);

export const useRows = (tasks: readonly PlannerTask[], slot: string | undefined) => {
  const { drafts: live, adopted } = useSyncExternalStore(subscribe, read, readServer);
  const claimed = useMemo(
    () =>
      live.length === 0
        ? []
        : tasks.flatMap((task) => {
            const draft = live.find((candidate) => claims(candidate, task));
            return draft ? [{ key: draft.key, task }] : [];
          }),
    [live, tasks],
  );
  useEffect(() => {
    for (const { key, task } of claimed) drafts.adopt(key, task);
  }, [claimed]);
  return useMemo(() => {
    const taken = new Set(claimed.map(({ task }) => task._id));
    const rows = tasks.filter((task) => !taken.has(task._id)).map((task) => ({ key: drafts.keyFor(task._id), task }));
    const hosted = slot === undefined ? [] : live.filter((draft) => draft.slot === slot);
    return [
      ...rows,
      ...hosted.map((draft) => ({
        key: draft.key,
        task: claimed.find((entry) => entry.key === draft.key)?.task ?? adopted.get(draft.key) ?? draft.task,
      })),
    ];
  }, [tasks, claimed, live, adopted, slot]);
};
