"use client";

import { useQuery } from "convex/react";
import { useEffect, useEffectEvent, useRef, useSyncExternalStore } from "react";
import { api } from "@lifeos/backend/api";
import type { Id } from "@lifeos/backend/dataModel";
import { drafts } from "../app/drafts";
import { useShell } from "../app/shell-context";
import { TaskItem, useCardHost } from "../app/task-item";

let current: Id<"tasks"> | null = null;
const listeners = new Set<() => void>();

const set = (taskId: Id<"tasks"> | null) => {
  current = taskId;
  for (const listener of listeners) listener();
};

export const openTaskBeside = (taskId: Id<"tasks">) => set(taskId);

const useTaskBeside = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => null,
  );

const Card = ({ taskId }: { taskId: Id<"tasks"> }) => {
  const { openCard, setOpenCard } = useShell();
  const { today, onCard, cardOf } = useCardHost();
  const task = useQuery(api.planner.tasks.row, { taskId });
  const key = drafts.keyFor(taskId);
  const shown = openCard?.key === key;
  const seen = useRef(false);
  const open = useEffectEvent(() => setOpenCard({ key, instant: false }));
  useEffect(() => open(), []);
  useEffect(() => {
    if (task === null) set(null);
  }, [task]);
  useEffect(() => {
    if (shown) seen.current = true;
    else if (seen.current) set(null);
  }, [shown]);
  if (!task || !shown) return null;
  return (
    <div
      data-task-beside
      className="fixed top-14 right-3 z-40 max-h-[calc(100dvh-4.5rem)] w-[min(30rem,calc(100vw-1.5rem))] overflow-y-auto overscroll-contain rounded-xl"
    >
      <ul aria-label="Task from the note">
        <TaskItem task={task} itemKey={key} sortable={false} today={today} card={cardOf(key)} onCard={onCard} settled />
      </ul>
    </div>
  );
};

export const TaskBeside = () => {
  const taskId = useTaskBeside();
  const { route } = useShell();
  useEffect(() => {
    if (route.kind !== "notes") set(null);
  }, [route.kind]);
  return taskId && route.kind === "notes" ? <Card key={taskId} taskId={taskId} /> : null;
};
