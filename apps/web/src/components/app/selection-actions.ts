"use client";

import { useMemo } from "react";
import { api } from "@lifeos/backend/api";
import type { PlannerTask } from "@lifeos/backend/types";
import { formatMinutes } from "@/components/lifeos/format";
import { haptic } from "@/lib/haptics";
import { LINGER_MS } from "@/lib/motion-tokens";
import { dropTasks, nothing, patchTasks, useChange } from "./changes";
import { shortDay, whenLabel } from "./dates";
import { selection } from "./selection";

type Label = PlannerTask["labels"][number];
type Parent = PlannerTask["parent"];
export type MoveTarget = { parent: Parent; title: string; area?: PlannerTask["area"]; project?: PlannerTask["project"] };

const idsOf = (tasks: readonly PlannerTask[]) => tasks.map((task) => task._id);

const byId = (tasks: readonly PlannerTask[]) => new Map(tasks.map((task) => [task._id, task] as const));

const said = (tasks: readonly PlannerTask[], one: string, many: string) => (tasks.length === 1 ? one : `${tasks.length} Tasks ${many}`);

const restoreFrom = (tasks: readonly PlannerTask[]) => {
  const before = byId(tasks);
  return patchTasks(idsOf(tasks), (task) => before.get(task._id) ?? task);
};

const pending = new Map<string, ReturnType<typeof setTimeout>>();

export const useSelectionActions = (today: string) => {
  const change = useChange();
  return useMemo(() => {
    const complete = (tasks: readonly PlannerTask[]) => {
      const open = tasks.filter((task) => task.status.kind === "open");
      if (open.length === 0) return;
      const taskIds = idsOf(open);
      void change({
        title: said(open, "Task completed", "completed"),
        mutation: api.planner.selection.complete,
        args: { taskIds },
        apply: dropTasks(taskIds),
        revert: nothing,
      });
    };

    return {
      setWhen: (tasks: readonly PlannerTask[], when: PlannerTask["when"]) =>
        void change({
          title: said(tasks, `Moved to ${whenLabel(when, today)}`, `moved to ${whenLabel(when, today)}`),
          mutation: api.planner.selection.setWhen,
          args: { taskIds: idsOf(tasks), when },
          apply: patchTasks(idsOf(tasks), (task) => ({ ...task, when })),
          revert: restoreFrom(tasks),
        }),

      setDeadline: (tasks: readonly PlannerTask[], deadline: string | null) =>
        void change({
          title: deadline
            ? said(tasks, `Deadline set to ${shortDay(deadline)}`, `due ${shortDay(deadline)}`)
            : said(tasks, "Deadline cleared", "have no Deadline now"),
          mutation: api.planner.selection.setDeadline,
          args: { taskIds: idsOf(tasks), deadline },
          apply: patchTasks(idsOf(tasks), ({ deadline: _previous, ...task }) => (deadline ? { ...task, deadline } : task)),
          revert: restoreFrom(tasks),
        }),

      setEstimate: (tasks: readonly PlannerTask[], minutes: number | null) =>
        void change({
          title:
            minutes === null
              ? said(tasks, "Estimate cleared", "have no Estimate now")
              : said(tasks, `Estimate set to ${formatMinutes(minutes)}`, `estimated at ${formatMinutes(minutes)}`),
          mutation: api.planner.selection.setEstimate,
          args: { taskIds: idsOf(tasks), minutes },
          apply: patchTasks(idsOf(tasks), ({ estimateMinutes: _previous, ...task }) =>
            minutes === null ? task : { ...task, estimateMinutes: minutes },
          ),
          revert: restoreFrom(tasks),
        }),

      setLabel: (tasks: readonly PlannerTask[], label: Label, on: boolean) =>
        void change({
          title: on ? said(tasks, `Labelled ${label.name}`, `labelled ${label.name}`) : said(tasks, `Removed ${label.name}`, `lost ${label.name}`),
          mutation: api.planner.selection.setLabel,
          args: { taskIds: idsOf(tasks), labelId: label._id, on },
          apply: patchTasks(idsOf(tasks), (task) => {
            const labels = [...task.labels.filter((entry) => entry._id !== label._id), ...(on ? [label] : [])];
            return { ...task, labels, labelIds: labels.map((entry) => entry._id) };
          }),
          revert: restoreFrom(tasks),
        }),

      move: (tasks: readonly PlannerTask[], target: MoveTarget) =>
        void change({
          title: said(tasks, `Moved to ${target.title}`, `moved to ${target.title}`),
          mutation: api.planner.selection.move,
          args: { taskIds: idsOf(tasks), parent: target.parent },
          apply: patchTasks(idsOf(tasks), (task) => ({
            ...task,
            parent: target.parent,
            area: target.area,
            project: target.project,
            context: target.parent.kind === "loose" ? undefined : target.title,
          })),
          revert: restoreFrom(tasks),
        }),

      complete,

      completeSoon: (tasks: readonly PlannerTask[]) => {
        const open = tasks.filter((task) => task.status.kind === "open" && !pending.has(task._id));
        if (open.length === 0) return;
        const ids = idsOf(open);
        haptic("complete");
        selection.linger(ids, true);
        const timer = setTimeout(() => {
          ids.forEach((id) => pending.delete(id));
          complete(open);
          setTimeout(() => selection.linger(ids, false), LINGER_MS);
        }, LINGER_MS);
        ids.forEach((id) => pending.set(id, timer));
      },

      keepOpen: (task: PlannerTask) => {
        const timer = pending.get(task._id);
        if (!timer) return false;
        clearTimeout(timer);
        const ids = [...pending].filter(([, other]) => other === timer).map(([id]) => id);
        ids.forEach((id) => pending.delete(id));
        selection.linger(ids, false);
        haptic("toggle");
        return true;
      },

      reopen: (tasks: readonly PlannerTask[]) =>
        void change({
          title: said(tasks, "Task reopened", "reopened"),
          mutation: api.planner.selection.reopen,
          args: { taskIds: idsOf(tasks) },
          apply: patchTasks(idsOf(tasks), (task) => ({ ...task, status: { kind: "open" } })),
          revert: restoreFrom(tasks),
        }),

      trash: (tasks: readonly PlannerTask[]) => {
        if (tasks.length === 0) return;
        haptic("drop");
        void change({
          title: said(tasks, "Task moved to Trash", "moved to Trash"),
          mutation: api.planner.selection.trash,
          args: { taskIds: idsOf(tasks) },
          apply: dropTasks(idsOf(tasks)),
          revert: nothing,
        });
      },
    };
  }, [change, today]);
};

export type SelectionActions = ReturnType<typeof useSelectionActions>;
