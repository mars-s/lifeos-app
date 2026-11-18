"use client";

import type { OptimisticLocalStore } from "convex/browser";
import { useConvex } from "convex/react";
import type { DefaultFunctionArgs, FunctionArgs, FunctionReference } from "convex/server";
import { useMemo } from "react";
import { api } from "@lifeos/backend/api";
import type { Id } from "@lifeos/backend/dataModel";
import type { SerialisedResult } from "@lifeos/backend/result";
import type { PlannerTask, SidebarView } from "@lifeos/backend/types";
import type { AreaColour } from "@/components/lifeos/area";
import { showUndo } from "@/components/lifeos/undo";
import { toast } from "@/components/ui/toast-stack";
import { drafts, isDraftTask } from "./drafts";

export type Updater = (store: OptimisticLocalStore) => void;

type Node = Record<string, unknown>;
type ChangeResult = SerialisedResult<{ activityId: Id<"activity"> | null }, { kind: string }>;
type ChangeMutation = FunctionReference<"mutation", "public", DefaultFunctionArgs, ChangeResult>;
type SavedValue<Mutation extends ChangeMutation> = Extract<Mutation["_returnType"], { ok: true }>["value"];

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
    const id = drafts.realId(taskId);
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

const REASONS: Record<string, string> = {
  empty_title: "It needs a title.",
  not_found: "It was removed somewhere else.",
  invalid_estimate: "An Estimate is between one minute and a day.",
  invalid_date: "That date does not exist.",
  changed_since: "It was changed again after that.",
  already_undone: "It was already undone.",
  invalid_icon: "That icon is not one LifeOS knows.",
  name_taken: "Another Label already has that name.",
  not_trashed: "It is no longer in Trash.",
  not_undoable: "That change is permanent.",
  selection_too_large: "That is too many Tasks at once. Try 500 or fewer.",
};

export const reasonFor = (kind: string | undefined) => (kind && REASONS[kind]) || "LifeOS could not save it. Try again.";

export type Change<Mutation extends ChangeMutation> = {
  title: string;
  mutation: Mutation;
  args: FunctionArgs<Mutation>;
  apply: Updater;
  revert: Updater;
  slot?: string;
  permanent?: boolean;
  onSaved?: (value: SavedValue<Mutation>) => void;
};

export const useChange = () => {
  const convex = useConvex();
  return useMemo(() => {
    const send = async (mutation: ChangeMutation, args: DefaultFunctionArgs, optimisticUpdate: Updater) => {
      const draftKey = typeof args.taskId === "string" && isDraftTask(args.taskId) ? args.taskId : null;
      const taskId = draftKey ? await drafts.whenSaved(draftKey) : null;
      if (draftKey && !taskId) return { ok: false, error: { kind: "not_found" } } satisfies ChangeResult;
      const taskIds = Array.isArray(args.taskIds) ? { taskIds: args.taskIds.map((id) => drafts.realId(String(id))) } : {};
      return convex.mutation(mutation, { ...args, ...taskIds, ...(taskId ? { taskId } : {}) }, { optimisticUpdate });
    };

    const undo = async (sent: Promise<Id<"activity"> | null>, revert: Updater) => {
      const activityId = await sent;
      if (!activityId) return;
      const result = await convex
        .mutation(api.platform.undo.undo, { activityId }, { optimisticUpdate: revert })
        .catch(() => undefined);
      if (!result?.ok) toast.error("That could not be undone", { description: reasonFor(result?.error.kind) });
    };

    return <Mutation extends ChangeMutation>({ title, mutation, args, apply, revert, slot, permanent, onSaved }: Change<Mutation>) => {
      const refused = (kind: string | undefined) => {
        forget();
        toast.error("That did not save", { description: reasonFor(kind) });
        return { saved: false, activityId: null };
      };
      const sent = send(mutation, args, apply).then(
        (result) => {
          if (!result.ok) return refused(result.error.kind);
          onSaved?.(result.value as SavedValue<Mutation>);
          if (permanent) toast(title);
          return { saved: true, activityId: result.value.activityId };
        },
        () => refused(undefined),
      );
      const forget = permanent
        ? nothing
        : showUndo(
            title,
            () => void undo(sent.then(({ activityId }) => activityId), revert),
            slot,
          );
      return sent.then(({ saved }) => saved);
    };
  }, [convex]);
};
