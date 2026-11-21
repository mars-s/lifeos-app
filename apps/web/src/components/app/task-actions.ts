"use client";

import { useMemo } from "react";
import { taskActions } from "@lifeos/backend/client/task-actions";
import type { PlannerTask } from "@lifeos/backend/types";
import { useChange } from "./changes";
import { askToConfirm } from "./confirm";

export { isOptimistic, quoted } from "@lifeos/backend/client/task-actions";

export const useTaskActions = (task: PlannerTask, today: string) => {
  const change = useChange();
  return useMemo(() => taskActions(change, task, today, askToConfirm), [change, task, today]);
};
