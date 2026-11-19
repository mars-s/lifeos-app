"use client";

import { useCallback } from "react";
import { api } from "@lifeos/backend/api";
import type { PlannerTask } from "@lifeos/backend/types";
import { haptic } from "@/lib/haptics";
import { dropTasks, nothing, useChange } from "./changes";
import { sameRoute, type Route, type Via } from "./route";
import { selection } from "./selection";
import { liveShell, useShell } from "./shell-context";

export const useConvertToProject = () => {
  const change = useChange();
  const { route, setOpenCard } = useShell();
  return useCallback(
    (task: PlannerTask, via: Via) => {
      const from = route;
      let made: Route | null = null;
      haptic("drop");
      selection.clear();
      setOpenCard(null);
      void change({
        title: "Turned into a Project",
        mutation: api.planner.convert.toProject,
        args: { taskId: task._id },
        apply: dropTasks([task._id]),
        revert: nothing,
        onSaved: ({ projectId }) => {
          made = { kind: "project", id: projectId };
          liveShell.current?.navigate(made, via, "nav-forward");
        },
        onUndone: () => {
          const shell = liveShell.current;
          if (made && shell && sameRoute(shell.route, made)) shell.navigate(from, "keyboard", "nav-back");
        },
      });
    },
    [change, route, setOpenCard],
  );
};
