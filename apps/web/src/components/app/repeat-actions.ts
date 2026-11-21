"use client";

import { useMemo } from "react";
import { occurrenceActions, repeatActions } from "@lifeos/backend/client/repeat-actions";
import type { PlannerTask } from "@lifeos/backend/types";
import { useChange } from "./changes";

export { repeatActions } from "@lifeos/backend/client/repeat-actions";

export const useRepeatActions = (task: PlannerTask, today: string) => {
  const change = useChange();
  return useMemo(() => repeatActions(change, task, today), [change, task, today]);
};

export const useOccurrenceActions = () => {
  const change = useChange();
  return useMemo(() => occurrenceActions(change), [change]);
};
