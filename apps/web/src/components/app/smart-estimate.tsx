"use client";

import type { OptimisticLocalStore } from "convex/browser";
import { useMutation } from "convex/react";
import { useEffect, useMemo } from "react";
import { api } from "@lifeos/backend/api";
import type { PlannerTask } from "@lifeos/backend/types";
import { EstimateField } from "@/components/lifeos/estimate-field";
import { useChange } from "./changes";
import { isDraftTask } from "./drafts";
import { useQuietView } from "./hooks";

export const TaskEstimateField = ({ task, onChange }: { task: PlannerTask; onChange: (minutes: number | null) => void }) => {
  const open = task.estimateMinutes === undefined && !isDraftTask(task._id);
  const suggestion = useQuietView(api.planner.smartEstimates.forTask, open ? { taskId: task._id } : "skip");
  const request = useMutation(api.planner.smartEstimates.request);
  useEffect(() => {
    if (open) request({ taskId: task._id }).catch(() => undefined);
  }, [open, request, task._id]);
  return <EstimateField minutes={task.estimateMinutes} suggestion={open ? (suggestion ?? undefined) : undefined} onChange={onChange} />;
};

const withSmartEstimates = (enabled: boolean) => (store: OptimisticLocalStore) => {
    for (const { args, value } of store.getAllQueries(api.planner.smartEstimates.status)) {
      if (value) store.setQuery(api.planner.smartEstimates.status, args, { ...value, enabled });
    }
    for (const { args } of store.getAllQueries(api.planner.smartEstimates.forTask)) {
      if (!enabled) store.setQuery(api.planner.smartEstimates.forTask, args, null);
    }
  };

export const useSmartEstimates = () => {
  const status = useQuietView(api.planner.smartEstimates.status, {});
  const change = useChange();
  return useMemo(
    () => ({
      status,
      set: (enabled: boolean) =>
        change({
          title: enabled ? "Smart Estimates on" : "Smart Estimates off",
          mutation: api.platform.preferences.setSmartEstimates,
          args: { enabled },
          apply: withSmartEstimates(enabled),
          revert: withSmartEstimates(!enabled),
        }),
    }),
    [change, status],
  );
};
