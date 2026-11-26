"use client";

import { useState, type ReactNode } from "react";
import { toast } from "@/components/ui/toast-stack";
import { showUndo } from "@/components/lifeos/undo";
import { TASK_IDS, type EntityRef, type NoteId, type TaskId } from "./model";
import { NotesContext, type NotesActions } from "./prose";
import { AREAS, NOTES, PROJECTS, TASKS } from "./sample";

const entityTitle = (ref: EntityRef) => (ref.kind === "task" ? TASKS[ref.id].title : ref.kind === "project" ? PROJECTS[ref.id].title : AREAS[ref.id].name);

const INITIAL_TODOS: Record<string, boolean> = Object.fromEntries(
  Object.values(NOTES).flatMap((note) => note.blocks.flatMap((block) => (block.kind === "todos" ? block.items.map((item) => [item.id, item.done] as const) : []))),
);

export const useNotesWorld = (initial: NoteId = "retrieval") => {
  const [open, setOpen] = useState<NoteId>(initial);
  const [tasks, setTasks] = useState<Record<TaskId, boolean>>(() => Object.fromEntries(TASK_IDS.map((id) => [id, TASKS[id].done])) as Record<TaskId, boolean>);
  const [todos, setTodos] = useState(INITIAL_TODOS);
  const [made, setMade] = useState<Record<string, TaskId>>({});

  const toggleTask = (id: TaskId) => {
    const next = !tasks[id];
    setTasks((current) => ({ ...current, [id]: next }));
    showUndo(next ? `Completed ${TASKS[id].title}` : `Reopened ${TASKS[id].title}`, () => setTasks((current) => ({ ...current, [id]: !next })), `task-${id}`);
  };

  const actions: NotesActions = {
    taskDone: (id) => tasks[id],
    toggleTask,
    openNote: setOpen,
    openEntity: (ref) => toast(`${entityTitle(ref)} opens beside the note`, { id: "open-entity" }),
  };

  const makeTask = (todo: string) => {
    setMade((current) => ({ ...current, [todo]: "rerun" }));
    showUndo("Task added to Honours thesis", () => setMade(({ [todo]: _removed, ...rest }) => rest), `make-${todo}`);
  };

  const toggleTodo = (todo: string) => {
    const task = made[todo];
    if (task) return toggleTask(task);
    setTodos((current) => ({ ...current, [todo]: !current[todo] }));
  };

  const todoDone = (todo: string) => {
    const task = made[todo];
    return task ? tasks[task] : (todos[todo] ?? false);
  };

  return { open, setOpen, actions, todoDone, toggleTodo, makeTask, taskFor: (todo: string) => made[todo] };
};

export type NotesWorld = ReturnType<typeof useNotesWorld>;

export const NotesProvider = ({ world, children }: { world: NotesWorld; children: ReactNode }) => <NotesContext value={world.actions}>{children}</NotesContext>;
