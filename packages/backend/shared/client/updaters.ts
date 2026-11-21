import type { OptimisticLocalStore } from "convex/browser";
import type { DefaultFunctionArgs, FunctionReference } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { PlannerTask, SidebarView, WorkBlockRow } from "../types";
import type { AreaColour } from "./colours";
import { putBack, type Node, type Updater } from "./local-views";
import { taskAliases } from "./task-aliases";

const TASK_VIEWS = [
  api.planner.today.get,
  api.planner.lists.inbox,
  api.planner.lists.anytime,
  api.planner.lists.someday,
  api.planner.lists.upcoming,
  api.planner.lists.logbook,
  api.planner.lists.area,
  api.planner.lists.project,
  api.planner.labels.list,
  api.planner.sidebar.get,
  api.planner.trash.list,
  api.planner.plan.week,
  api.planner.workBlocks.range,
  api.planner.tasks.row,
] as readonly FunctionReference<"query">[];

const isTaskNode = (node: Node) => "checklist" in node && "labelIds" in node;

const mapDeep: (value: unknown, visit: (node: Node) => Node) => unknown = (value, visit) => {
  if (Array.isArray(value)) {
    const next = value.map((inner) => mapDeep(inner, visit));
    return next.some((inner, index) => inner !== value[index]) ? next : value;
  }
  if (value === null || typeof value !== "object") return value;
  const node = value as Node;
  const visited = visit(node);
  if (visited !== node) return visited;
  const entries = Object.entries(node).map(([key, inner]) => [key, mapDeep(inner, visit)] as const);
  return entries.some(([key, inner]) => inner !== node[key]) ? Object.fromEntries(entries) : value;
};

const rewriteViews = (store: OptimisticLocalStore, visit: (node: Node) => Node) => {
  for (const view of TASK_VIEWS) {
    for (const { args, value } of store.getAllQueries(view)) {
      if (value === undefined) continue;
      const next = mapDeep(value, visit);
      if (next !== value) store.setQuery(view, args, next);
    }
  }
};

export const patchTask =
  (taskId: Id<"tasks">, patch: (task: PlannerTask) => PlannerTask) =>
  (store: OptimisticLocalStore) => {
    const id = taskAliases.realId(taskId);
    rewriteViews(store, (node) => (node._id === id && "checklist" in node ? (patch(node as unknown as PlannerTask) as unknown as Node) : node));
  };


export const patchTasks =
  (taskIds: readonly Id<"tasks">[], patch: (task: PlannerTask) => PlannerTask) =>
  (store: OptimisticLocalStore) => {
    const ids = new Set<string>(taskIds);
    rewriteViews(store, (node) =>
      isTaskNode(node) && ids.has(node._id as string) ? (patch(node as unknown as PlannerTask) as unknown as Node) : node,
    );
  };

const ORDERED_VIEWS = [api.planner.lists.inbox, api.planner.lists.area, api.planner.lists.project] as readonly FunctionReference<"query">[];

const byOrder = (a: Node, b: Node) => ((a.order as string) < (b.order as string) ? -1 : (a.order as string) > (b.order as string) ? 1 : 0);

const reorderDeep: (value: unknown, taskId: string, order: string) => unknown = (value, taskId, order) => {
  if (Array.isArray(value)) {
    const holds = value.some((inner) => inner && typeof inner === "object" && (inner as Node)._id === taskId && isTaskNode(inner as Node));
    if (holds) return value.map((inner) => ((inner as Node)._id === taskId ? { ...(inner as Node), order } : inner)).toSorted(byOrder);
    const next = value.map((inner) => reorderDeep(inner, taskId, order));
    return next.some((inner, index) => inner !== value[index]) ? next : value;
  }
  if (value === null || typeof value !== "object") return value;
  const node = value as Node;
  const entries = Object.entries(node).map(([key, inner]) => [key, reorderDeep(inner, taskId, order)] as const);
  return entries.some(([key, inner]) => inner !== node[key]) ? Object.fromEntries(entries) : value;
};

export const reorderTask =
  (taskId: Id<"tasks">, order: string) =>
  (store: OptimisticLocalStore) => {
    for (const view of ORDERED_VIEWS) {
      for (const { args, value } of store.getAllQueries(view)) {
        if (value === undefined) continue;
        const next = reorderDeep(value, taskId, order);
        if (next !== value) store.setQuery(view, args, next);
      }
    }
  };

const dropDeep: (value: unknown, gone: (node: Node) => boolean) => unknown = (value, gone) => {
  if (Array.isArray(value)) {
    const kept = value.filter((inner) => !(inner && typeof inner === "object" && !Array.isArray(inner) && gone(inner as Node)));
    const next = kept.map((inner) => dropDeep(inner, gone));
    return next.length !== value.length || next.some((inner, index) => inner !== value[index]) ? next : value;
  }
  if (value === null || typeof value !== "object") return value;
  const node = value as Node;
  const entries = Object.entries(node).map(([key, inner]) => [key, dropDeep(inner, gone)] as const);
  return entries.some(([key, inner]) => inner !== node[key]) ? Object.fromEntries(entries) : value;
};

const dropFromViews = (store: OptimisticLocalStore, gone: (node: Node) => boolean) => {
  for (const view of TASK_VIEWS) {
    for (const { args, value } of store.getAllQueries(view)) {
      if (value === undefined) continue;
      const next = dropDeep(value, gone);
      if (next !== value) store.setQuery(view, args, next);
    }
  }
};

export const dropTasks =
  (taskIds: readonly Id<"tasks">[]) =>
  (store: OptimisticLocalStore) => {
    const ids = new Set<string>(taskIds);
    dropFromViews(store, (node) => isTaskNode(node) && ids.has(node._id as string));
  };

const taskAmong = (taskIds: readonly string[]) => {
  const ids = new Set(taskIds);
  return (node: Node) => isTaskNode(node) && ids.has(node._id as string);
};

const blockAmong = (taskIds: readonly string[]) => {
  const ids = new Set(taskIds);
  return (node: Node) => typeof node.taskId === "string" && ids.has(node.taskId) && "minutes" in node;
};

type Seen = { view: FunctionReference<"query">; args: DefaultFunctionArgs; value: unknown };

const restorable = (drop: Updater, gone: (node: Node) => boolean) => {
  let before: readonly Seen[] | null = null;
  return {
    apply: (store: OptimisticLocalStore) => {
      const seen = before ? [] : TASK_VIEWS.flatMap((view) => store.getAllQueries(view).map(({ args, value }) => ({ view, args, value })));
      drop(store);
      before ??= seen.filter(({ view, args, value }) => store.getQuery(view, args) !== value);
    },
    revert: (store: OptimisticLocalStore) => {
      for (const { view, args, value } of before ?? []) {
        const now: unknown = store.getQuery(view, args);
        if (now !== undefined) store.setQuery(view, args, putBack(value, now, gone));
      }
    },
  };
};

export const completingTasks = (taskIds: readonly Id<"tasks">[]) =>
  restorable(both(patchTasks(taskIds, (task) => ({ ...task, status: { kind: "completed", at: Date.now() } })), dropTasks(taskIds)), taskAmong(taskIds));

export const trashingTasks = (taskIds: readonly Id<"tasks">[]) => {
  const tasks = taskAmong(taskIds);
  const blocks = blockAmong(taskIds);
  return restorable(both(dropTasks(taskIds), dropBlocksOf(taskIds)), (node) => tasks(node) || blocks(node));
};

const byStart = (a: { start: number }, b: { start: number }) => a.start - b.start;

const rewriteBlocks = (store: OptimisticLocalStore, rewrite: (blocks: WorkBlockRow[], window: { from: number; to: number }) => WorkBlockRow[]) => {
  for (const { args, value } of store.getAllQueries(api.planner.workBlocks.range)) {
    if (value?.ok) store.setQuery(api.planner.workBlocks.range, args, { ok: true, value: rewrite(value.value, args) });
  }
};

export const putBlock =
  (block: WorkBlockRow) =>
  (store: OptimisticLocalStore) => {
    rewriteBlocks(store, (blocks, { from, to }) => {
      const others = blocks.filter((each) => each._id !== block._id);
      return block.start >= from && block.start < to ? [...others, block].toSorted(byStart) : others;
    });
    const { _id, start, minutes, done } = block;
    patchTask(block.taskId, (task) => ({
      ...task,
      workBlocks: [...task.workBlocks.filter((each) => each._id !== _id), { _id, start, minutes, done }].toSorted(byStart),
    }))(store);
  };

export const dropBlock =
  (block: Pick<WorkBlockRow, "_id" | "taskId">) =>
  (store: OptimisticLocalStore) => {
    rewriteBlocks(store, (blocks) => blocks.filter((each) => each._id !== block._id));
    patchTask(block.taskId, (task) => ({ ...task, workBlocks: task.workBlocks.filter((each) => each._id !== block._id) }))(store);
  };

export const dropBlockAt =
  (taskId: Id<"tasks">, start: number) =>
  (store: OptimisticLocalStore) => {
    const id = taskAliases.realId(taskId);
    rewriteBlocks(store, (blocks) => blocks.filter((each) => !(each.taskId === id && each.start === start)));
    patchTask(taskId, (task) => ({ ...task, workBlocks: task.workBlocks.filter((each) => each.start !== start) }))(store);
  };

export const dropBlocksOf =
  (taskIds: readonly Id<"tasks">[]) =>
  (store: OptimisticLocalStore) => {
    const ids = new Set<string>(taskIds);
    rewriteBlocks(store, (blocks) => blocks.filter((each) => !ids.has(each.taskId)));
  };

export const dropContainer =
  (id: Id<"areas"> | Id<"projects">) =>
  (store: OptimisticLocalStore) =>
    dropFromViews(store, (node) => node._id === id && "title" in node && !isTaskNode(node));

export const patchContainer =
  (id: Id<"areas"> | Id<"projects">, fields: Node) =>
  (store: OptimisticLocalStore) =>
    rewriteViews(store, (node) => (node._id === id && "title" in node && !isTaskNode(node) ? { ...node, ...fields } : node));

export const patchSidebar =
  (patch: (sidebar: SidebarView) => SidebarView) =>
  (store: OptimisticLocalStore) => {
    for (const { args, value } of store.getAllQueries(api.planner.sidebar.get)) {
      if (value?.ok) store.setQuery(api.planner.sidebar.get, args, { ok: true, value: patch(value.value) });
    }
  };

export const patchProjectView =
  (projectId: Id<"projects">, fields: Node) =>
  (store: OptimisticLocalStore) => {
    const view = store.getQuery(api.planner.lists.project, { projectId });
    if (view) store.setQuery(api.planner.lists.project, { projectId }, { ...view, project: { ...view.project, ...fields } });
  };

export const nothing = () => undefined;

const isTodayWhen = (when: PlannerTask["when"], today: string) => when.kind === "scheduled" && when.date <= today;

const placed = (tasks: readonly PlannerTask[], task: PlannerTask) => [...tasks, task].toSorted(byOrder);

const showInContainer = (task: PlannerTask, store: OptimisticLocalStore) => {
  const { parent } = task;
  if (parent.kind === "project") {
    const view = store.getQuery(api.planner.lists.project, { projectId: parent.projectId });
    if (view)
      store.setQuery(api.planner.lists.project, { projectId: parent.projectId }, {
        ...view,
        sections: view.sections.map((section) =>
          (section.heading?._id ?? undefined) === parent.headingId ? { ...section, tasks: placed(section.tasks, task) } : section,
        ),
      });
  }
  if (parent.kind === "area") {
    const view = store.getQuery(api.planner.lists.area, { areaId: parent.areaId });
    if (view) store.setQuery(api.planner.lists.area, { areaId: parent.areaId }, { ...view, tasks: placed(view.tasks, task) });
  }
};

const showOnDay = (task: PlannerTask, store: OptimisticLocalStore) => {
  const { when } = task;
  if (when.kind !== "scheduled") return;
  for (const { args, value } of store.getAllQueries(api.planner.lists.upcoming)) {
    if (!value?.ok || !value.value.days.some((day) => day.date === when.date)) continue;
    store.setQuery(api.planner.lists.upcoming, args, {
      ok: true,
      value: { ...value.value, days: value.value.days.map((day) => (day.date === when.date ? { ...day, tasks: [...day.tasks, task] } : day)) },
    });
  }
};

export const showNewTask =
  (task: PlannerTask, today: string) =>
  (store: OptimisticLocalStore) => {
    if (task.when.kind === "inbox") {
      const inbox = store.getQuery(api.planner.lists.inbox, {});
      if (inbox) store.setQuery(api.planner.lists.inbox, {}, { tasks: placed(inbox.tasks, task) });
    }
    showInContainer(task, store);
    showOnDay(task, store);
    if (isTodayWhen(task.when, today)) {
      const view = store.getQuery(api.planner.today.get, { date: today });
      const evening = task.when.kind === "scheduled" && task.when.evening;
      if (view?.ok)
        store.setQuery(api.planner.today.get, { date: today }, {
          ok: true,
          value: evening ? { ...view.value, evening: [...view.value.evening, task] } : { ...view.value, tasks: [...view.value.tasks, task] },
        });
    }
    patchSidebar((sidebar) => ({
      ...sidebar,
      counts: {
        inbox: sidebar.counts.inbox + (task.when.kind === "inbox" ? 1 : 0),
        today: sidebar.counts.today + (isTodayWhen(task.when, today) ? 1 : 0),
      },
    }))(store);
  };

export const patchLabelColour =
  (labelId: Id<"labels">, colour: AreaColour) =>
  (store: OptimisticLocalStore) =>
    rewriteViews(store, (node) => (node._id === labelId && "colour" in node && "name" in node ? { ...node, colour } : node));

const isLabelNode = (node: Node, labelId: string) => node._id === labelId && "colour" in node && "name" in node;

export const patchLabelName =
  (labelId: Id<"labels">, name: string) =>
  (store: OptimisticLocalStore) =>
    rewriteViews(store, (node) => (isLabelNode(node, labelId) ? { ...node, name } : node));

export const dropLabel =
  (labelId: Id<"labels">) =>
  (store: OptimisticLocalStore) =>
    dropFromViews(store, (node) => isLabelNode(node, labelId));

export const patchLabelList =
  (patch: (labels: PlannerTask["labels"]) => PlannerTask["labels"]) =>
  (store: OptimisticLocalStore) => {
    const labels = store.getQuery(api.planner.labels.list, {});
    if (labels) store.setQuery(api.planner.labels.list, {}, patch(labels));
  };

export const both =
  (...updaters: Updater[]) =>
  (store: OptimisticLocalStore) =>
    updaters.forEach((update) => update(store));

