"use client";

import { useConvex } from "convex/react";
import { useMemo } from "react";
import { api } from "@lifeos/backend/api";
import type { Id } from "@lifeos/backend/dataModel";
import type { FolderRef } from "@lifeos/notes/markdown";
import { haptic } from "@/lib/haptics";
import { nothing, useChange } from "../app/changes";
import { drafts } from "../app/drafts";
import type { Route } from "../app/route";
import { selection } from "../app/selection";
import { useShell } from "../app/shell-context";
import { forgetLocal } from "./library";

const asRoute = (route: Route) => route;

const homeOf = (task: { when: { kind: string; date?: string }; project?: { _id: Id<"projects"> } | undefined; area?: { _id: Id<"areas"> } | undefined }, today: string) => {
  if (task.project) return asRoute({ kind: "project", id: task.project._id });
  if (task.when.kind === "inbox") return asRoute({ kind: "inbox" });
  if (task.when.kind === "someday") return asRoute({ kind: "someday" });
  if (task.when.kind === "scheduled" && task.when.date && task.when.date <= today) return asRoute({ kind: "today" });
  if (task.when.kind === "scheduled") return asRoute({ kind: "upcoming" });
  if (task.area) return asRoute({ kind: "area", id: task.area._id });
  return asRoute({ kind: "anytime" });
};

export const useNoteActions = () => {
  const convex = useConvex();
  const change = useChange();
  const shell = useShell();
  return useMemo(
    () => ({
      toggleTask: (taskId: string, done: boolean) => {
        haptic(done ? "complete" : "toggle");
        void change({
          title: done ? "Task completed" : "Task reopened",
          mutation: done ? api.planner.tasks.complete : api.planner.tasks.uncomplete,
          args: { taskId: taskId as Id<"tasks"> },
          apply: nothing,
          revert: nothing,
        });
      },
      openEntity: async (table: "tasks" | "projects" | "areas", id: string) => {
        if (table === "areas") return shell.navigate({ kind: "area", id: id as Id<"areas"> }, "pointer");
        if (table === "projects") return shell.navigate({ kind: "project", id: id as Id<"projects"> }, "pointer");
        const task = await convex.query(api.planner.tasks.row, { taskId: id as Id<"tasks"> }).catch(() => null);
        if (!task) return;
        const home = homeOf(task, shell.today);
        selection.clear();
        shell.navigate(home, "pointer");
        shell.setOpenCard({ key: drafts.keyFor(id as Id<"tasks">), instant: false }, home);
      },
      makeTask: (title: string, folder: FolderRef | undefined, done: { saved: (taskId: string) => void; undone: () => void }) => {
        const parent =
          folder?.table === "projects"
            ? { kind: "project" as const, projectId: folder.id as Id<"projects"> }
            : folder?.table === "areas"
              ? { kind: "area" as const, areaId: folder.id as Id<"areas"> }
              : undefined;
        haptic("toggle");
        void change({
          title: "Task made from the note",
          mutation: api.planner.tasks.create,
          args: { title, ...(parent ? { parent } : {}) },
          apply: nothing,
          revert: nothing,
          onSaved: ({ taskId }) => done.saved(taskId),
          onUndo: done.undone,
        });
      },
      trash: (noteId: Id<"notes"> | undefined, docId: string, onUndone: () => void) => {
        forgetLocal(docId);
        if (!noteId) return;
        void change({
          title: "Note moved to the Trash",
          mutation: api.notes.notes.trash,
          args: { noteId },
          apply: nothing,
          revert: nothing,
          onUndo: onUndone,
        });
      },
    }),
    [change, convex, shell],
  );
};
