"use client";

import type { OptimisticLocalStore } from "convex/browser";
import { useConvex } from "convex/react";
import type { DefaultFunctionArgs, FunctionArgs, FunctionReference } from "convex/server";
import { useMemo } from "react";
import { api } from "@lifeos/backend/api";
import type { Id } from "@lifeos/backend/dataModel";
import type { SerialisedResult } from "@lifeos/backend/result";
import type { PlannerTask } from "@lifeos/backend/types";
import type { AreaColour } from "@/components/lifeos/area";
import { showUndo } from "@/components/lifeos/undo";
import { toast } from "@/components/ui/toast-stack";

export type Updater = (store: OptimisticLocalStore) => void;

type Node = Record<string, unknown>;
type ChangeResult = SerialisedResult<{ activityId: Id<"activity"> | null }, { kind: string }>;
type ChangeMutation = FunctionReference<"mutation", "public", DefaultFunctionArgs, ChangeResult>;

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
] as readonly FunctionReference<"query">[];

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
  (store: OptimisticLocalStore) =>
    rewriteViews(store, (node) =>
      node._id === taskId && "checklist" in node ? (patch(node as unknown as PlannerTask) as unknown as Node) : node,
    );

export const patchLabelColour =
  (labelId: Id<"labels">, colour: AreaColour) =>
  (store: OptimisticLocalStore) =>
    rewriteViews(store, (node) => (node._id === labelId && "colour" in node && "name" in node ? { ...node, colour } : node));

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
};

const reasonFor = (kind: string | undefined) => (kind && REASONS[kind]) || "LifeOS could not save it. Try again.";

export type Change<Mutation extends ChangeMutation> = {
  title: string;
  mutation: Mutation;
  args: FunctionArgs<Mutation>;
  apply: Updater;
  revert: Updater;
  slot?: string;
};

export const useChange = () => {
  const convex = useConvex();
  return useMemo(() => {
    const send = (mutation: ChangeMutation, args: DefaultFunctionArgs, optimisticUpdate: Updater) =>
      convex.mutation(mutation, args, { optimisticUpdate });

    const undo = async (sent: Promise<Id<"activity"> | null>, revert: Updater) => {
      const activityId = await sent;
      if (!activityId) return;
      const result = await convex
        .mutation(api.platform.undo.undo, { activityId }, { optimisticUpdate: revert })
        .catch(() => undefined);
      if (!result?.ok) toast.error("That could not be undone", { description: reasonFor(result?.error.kind) });
    };

    return <Mutation extends ChangeMutation>({ title, mutation, args, apply, revert, slot }: Change<Mutation>) => {
      const refused = (kind: string | undefined) => {
        forget();
        toast.error("That did not save", { description: reasonFor(kind) });
        return { saved: false, activityId: null };
      };
      const sent = send(mutation, args, apply).then(
        (result) => (result.ok ? { saved: true, activityId: result.value.activityId } : refused(result.error.kind)),
        () => refused(undefined),
      );
      const forget = showUndo(
        title,
        () => void undo(sent.then(({ activityId }) => activityId), revert),
        slot,
      );
      return sent.then(({ saved }) => saved);
    };
  }, [convex]);
};
