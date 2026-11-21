import { generateKeyBetween } from "fractional-indexing";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { formatMinutes } from "../estimate";
import type { PlannerTask } from "../types";
import type { ChangeFn } from "./change";
import type { AreaColour } from "./colours";
import { shortDay, whenLabel } from "./dates";
import { taskAliases } from "./task-aliases";
import { both, dropLabel, dropTasks, nothing, patchLabelColour, patchLabelList, patchLabelName, patchSidebar, patchTask, showNewTask } from "./updaters";

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

export type MoveTarget = { parent: PlannerTask["parent"]; title: string; area?: PlannerTask["area"]; project?: PlannerTask["project"] };

let copies = 0;

const isTodayWhen = (when: PlannerTask["when"], today: string) => when.kind === "scheduled" && when.date <= today;

const copyOf = (task: PlannerTask, key: string) => {
  const { repeat: _repeat, ...rest } = task;
  return {
    ...rest,
    _id: key as Id<"tasks">,
    _creationTime: Date.now(),
    status: { kind: "open" },
    order: `${task.order}V`,
    checklist: task.checklist.map((entry) => ({ ...entry, _id: `${OPTIMISTIC}${key}:${entry.order}` as Id<"checklistItems"> })),
    workBlocks: [],
    focus: { ms: 0, sessions: [] },
  } satisfies PlannerTask;
};

const uncount = (task: PlannerTask, today: string) =>
  patchSidebar((sidebar) => ({
    ...sidebar,
    counts: {
      inbox: Math.max(sidebar.counts.inbox - (task.when.kind === "inbox" ? 1 : 0), 0),
      today: Math.max(sidebar.counts.today - (isTodayWhen(task.when, today) ? 1 : 0), 0),
    },
  }));

export const quoted = (title: string) => (title.length > 28 ? `${title.slice(0, 27)}…` : title);

export type Confirm = (ask: { title: string; body: string; action: string; onConfirm: () => void }) => void;

export const taskActions = (change: ChangeFn, task: PlannerTask, today: string, confirm: Confirm) => {
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
      confirm({
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

    moveTo: (target: MoveTarget) =>
      void change({
        title: `Moved to ${target.title}`,
        mutation: api.planner.tasks.move,
        args: { taskId, parent: target.parent },
        apply: onTask((current) => ({
          ...current,
          parent: target.parent,
          area: target.area,
          project: target.project,
          context: target.parent.kind === "loose" ? undefined : target.title,
        })),
        revert: onTask((current) => ({ ...current, parent: task.parent, area: task.area, project: task.project, context: task.context })),
        slot,
      }),

    duplicate: () => {
      copies += 1;
      const key = `${OPTIMISTIC}copy:${copies}`;
      const copy = copyOf(task, key);
      return change({
        title: `Duplicated ${quoted(task.title)}`,
        mutation: api.planner.tasks.duplicate,
        args: { taskId },
        apply: showNewTask(copy, today),
        revert: both(dropTasks([taskAliases.realId(key)]), uncount(copy, today)),
        onSaved: ({ taskId: made }) => taskAliases.set(key, made),
      });
    },

    convertToProject: (onSaved: (projectId: Id<"projects">) => void, onUndone?: () => void) =>
      change({
        title: "Turned into a Project",
        mutation: api.planner.convert.toProject,
        args: { taskId },
        apply: dropTasks([taskId]),
        revert: nothing,
        onSaved: ({ projectId }) => onSaved(projectId),
        ...(onUndone ? { onUndone } : {}),
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
};
