"use client";

import { generateKeyBetween } from "fractional-indexing";
import { useMemo } from "react";
import { api } from "@lifeos/backend/api";
import type { Id } from "@lifeos/backend/dataModel";
import type { PlannerTask } from "@lifeos/backend/types";
import type { AreaColour } from "@/components/lifeos/area";
import { formatMinutes } from "@/components/lifeos/format";
import { both, dropLabel, nothing, patchLabelColour, patchLabelList, patchLabelName, patchTask, useChange } from "./changes";
import { askToConfirm } from "./confirm";
import { shortDay, whenLabel } from "./dates";

type Item = PlannerTask["checklist"][number];
type Label = PlannerTask["labels"][number];

const OPTIMISTIC = "optimistic:";

export const isOptimistic = (id: string) => id.startsWith(OPTIMISTIC);

const byOrder = (a: Item, b: Item) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0);

const withChecklist = (patch: (items: Item[]) => Item[]) => (task: PlannerTask) => ({
  ...task,
  checklist: patch(task.checklist).toSorted(byOrder),
});

const withEstimate = (minutes: number | undefined) => (task: PlannerTask) => {
  const { estimateMinutes: _previous, ...rest } = task;
  return minutes === undefined ? rest : { ...rest, estimateMinutes: minutes };
};

const withDeadline = (deadline: string | undefined) => (task: PlannerTask) => {
  const { deadline: _previous, ...rest } = task;
  return deadline === undefined ? rest : { ...rest, deadline };
};

const withLabels = (labels: Label[]) => (task: PlannerTask) => ({ ...task, labels, labelIds: labels.map((label) => label._id) });

export const quoted = (title: string) => (title.length > 28 ? `${title.slice(0, 27)}…` : title);

export const useTaskActions = (task: PlannerTask, today: string) => {
  const change = useChange();
  return useMemo(() => {
    const taskId = task._id;
    const slot = `card:${taskId}`;
    const onTask = (patch: (task: PlannerTask) => PlannerTask) => patchTask(taskId, patch);
    const item = (itemId: string) => task.checklist.find((entry) => entry._id === itemId);
    const editItem = (itemId: string, fields: Partial<Item>) =>
      onTask(withChecklist((items) => items.map((entry) => (entry._id === itemId ? { ...entry, ...fields } : entry))));

    return {
      setEstimate: (minutes: number | null) =>
        change({
          title: minutes === null ? "Estimate cleared" : `Estimate set to ${formatMinutes(minutes)}`,
          mutation: api.planner.tasks.setEstimate,
          args: { taskId, minutes },
          apply: onTask(withEstimate(minutes ?? undefined)),
          revert: onTask(withEstimate(task.estimateMinutes)),
          slot,
        }),

      addItem: (title: string) => {
        const order = generateKeyBetween(task.checklist.at(-1)?.order ?? null, null);
        const added = { _id: `${OPTIMISTIC}${order}` as Id<"checklistItems">, title, done: false, order };
        return change({
          title: `Added ${quoted(title)}`,
          mutation: api.planner.checklist.add,
          args: { taskId, title },
          apply: onTask(withChecklist((items) => [...items, added])),
          revert: onTask(withChecklist((items) => items.filter((entry) => entry.order !== order))),
          slot,
        });
      },

      editItem: (itemId: string, title: string) => {
        const before = item(itemId);
        if (!before || isOptimistic(itemId)) return;
        void change({
          title: "Checklist Item renamed",
          mutation: api.planner.checklist.edit,
          args: { itemId: before._id, title },
          apply: editItem(itemId, { title }),
          revert: editItem(itemId, { title: before.title }),
          slot,
        });
      },

      tickItem: (itemId: string, done: boolean) => {
        const before = item(itemId);
        if (!before || isOptimistic(itemId)) return;
        void change({
          title: done ? `Ticked ${quoted(before.title)}` : `Unticked ${quoted(before.title)}`,
          mutation: api.planner.checklist.tick,
          args: { itemId: before._id, done },
          apply: editItem(itemId, { done }),
          revert: editItem(itemId, { done: before.done }),
          slot,
        });
      },

      moveItem: (itemId: string, toIndex: number) => {
        const moved = item(itemId);
        if (!moved || isOptimistic(itemId)) return;
        const others = task.checklist.filter((entry) => entry._id !== itemId);
        const order = generateKeyBetween(others[toIndex - 1]?.order ?? null, others[toIndex]?.order ?? null);
        void change({
          title: `Moved ${quoted(moved.title)}`,
          mutation: api.planner.checklist.reorder,
          args: { itemId: moved._id, order },
          apply: editItem(itemId, { order }),
          revert: editItem(itemId, { order: moved.order }),
          slot,
        });
      },

      removeItem: (itemId: string) => {
        const removed = item(itemId);
        if (!removed || isOptimistic(itemId)) return;
        void change({
          title: `Deleted ${quoted(removed.title)}`,
          mutation: api.planner.checklist.remove,
          args: { itemId: removed._id },
          apply: onTask(withChecklist((items) => items.filter((entry) => entry._id !== itemId))),
          revert: onTask(withChecklist((items) => [...items, removed])),
          slot,
        });
      },

      toggleLabel: (label: Label) => {
        const has = task.labelIds.includes(label._id);
        const next = has ? task.labels.filter((entry) => entry._id !== label._id) : [...task.labels, label];
        void change({
          title: has ? `Removed ${label.name}` : `Labelled ${label.name}`,
          mutation: api.planner.tasks.setLabels,
          args: { taskId, labelIds: next.map((entry) => entry._id) },
          apply: onTask(withLabels(next)),
          revert: onTask(withLabels(task.labels)),
          slot,
        });
      },

      createLabel: (name: string, colour: AreaColour) => {
        const created = { _id: `${OPTIMISTIC}${name}` as Id<"labels">, name, colour };
        void change({
          title: `Labelled ${name}`,
          mutation: api.planner.labels.create,
          args: { name, colour, taskId },
          apply: both(
            patchLabelList((labels) => [...labels, created]),
            onTask(withLabels([...task.labels, created])),
          ),
          revert: both(
            patchLabelList((labels) => labels.filter((label) => label.name !== name)),
            onTask(withLabels(task.labels)),
          ),
          slot,
        });
      },

      recolourLabel: (label: Label, colour: AreaColour) => {
        if (isOptimistic(label._id)) return;
        void change({
          title: `${label.name} is now ${colour}`,
          mutation: api.planner.labels.setColour,
          args: { labelId: label._id, colour },
          apply: patchLabelColour(label._id, colour),
          revert: patchLabelColour(label._id, label.colour),
          slot,
        });
      },

      renameLabel: (label: Label, name: string) => {
        if (isOptimistic(label._id)) return;
        void change({
          title: `${quoted(label.name)} is now ${quoted(name)}`,
          mutation: api.planner.labels.rename,
          args: { labelId: label._id, name },
          apply: patchLabelName(label._id, name),
          revert: patchLabelName(label._id, label.name),
          slot,
        });
      },

      removeLabel: (label: Label) => {
        if (isOptimistic(label._id)) return;
        askToConfirm({
          title: `Delete the Label “${quoted(label.name)}”?`,
          body: "It comes off every Task that has it. This cannot be undone.",
          action: "Delete Label",
          onConfirm: () =>
            void change({
              title: `Label ${quoted(label.name)} deleted`,
              mutation: api.planner.labels.remove,
              args: { labelId: label._id },
              apply: dropLabel(label._id),
              revert: nothing,
              permanent: true,
            }),
        });
      },

      rename: (title: string) =>
        void change({
          title: "Task renamed",
          mutation: api.planner.tasks.rename,
          args: { taskId, title },
          apply: onTask((current) => ({ ...current, title })),
          revert: onTask((current) => ({ ...current, title: task.title })),
          slot,
        }),

      setNotes: (notes: string) =>
        void change({
          title: "Notes changed",
          mutation: api.planner.tasks.setNotes,
          args: { taskId, notes },
          apply: onTask((current) => ({ ...current, notes })),
          revert: onTask((current) => ({ ...current, notes: task.notes })),
          slot,
        }),

      setWhen: (when: PlannerTask["when"]) =>
        void change({
          title: `Moved to ${whenLabel(when, today)}`,
          mutation: api.planner.tasks.setWhen,
          args: { taskId, when },
          apply: onTask((current) => ({ ...current, when })),
          revert: onTask((current) => ({ ...current, when: task.when })),
          slot,
        }),

      complete: () =>
        change({
          title: `Completed ${quoted(task.title)}`,
          mutation: api.planner.tasks.complete,
          args: { taskId },
          apply: onTask((current) => ({ ...current, status: { kind: "completed", at: Date.now() } })),
          revert: onTask((current) => ({ ...current, status: task.status })),
          slot,
        }),

      reopen: () =>
        change({
          title: `Reopened ${quoted(task.title)}`,
          mutation: api.planner.tasks.uncomplete,
          args: { taskId },
          apply: onTask((current) => ({ ...current, status: { kind: "open" } })),
          revert: onTask((current) => ({ ...current, status: task.status })),
          slot,
        }),

      setDeadline: (deadline: string | null) =>
        void change({
          title: deadline ? `Deadline set to ${shortDay(deadline)}` : "Deadline cleared",
          mutation: api.planner.tasks.setDeadline,
          args: { taskId, deadline },
          apply: onTask(withDeadline(deadline ?? undefined)),
          revert: onTask(withDeadline(task.deadline)),
          slot,
        }),
    };
  }, [change, task, today]);
};
