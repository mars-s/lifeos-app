"use client";

import { useMemo } from "react";
import { api } from "@lifeos/backend/api";
import { addDays, type IsoDate } from "@lifeos/backend/date";
import type { SidebarView } from "@lifeos/backend/types";
import { useChange } from "./changes";
import { drafts } from "./drafts";
import { routeHref, type Route } from "./route";
import { selection } from "./selection";
import { useShell } from "./shell-context";

const newTaskFor = (route: Route, today: IsoDate) => {
  switch (route.kind) {
    case "today":
      return { when: { kind: "scheduled", date: today, evening: false } } as const;
    case "upcoming":
      return { when: { kind: "scheduled", date: addDays(today, 1), evening: false } } as const;
    case "anytime":
      return { when: { kind: "anytime" } } as const;
    case "someday":
      return { when: { kind: "someday" } } as const;
    case "area":
      return { when: { kind: "anytime" }, parent: { kind: "area", areaId: route.id } } as const;
    case "project":
      return { when: { kind: "anytime" }, parent: { kind: "project", projectId: route.id } } as const;
    default:
      return { when: { kind: "inbox" } } as const;
  }
};

export const knownTaskIds = () =>
  new Set([...document.querySelectorAll<HTMLElement>("#main [data-task-id]")].flatMap((row) => row.dataset.taskId ?? []));

export const useNewTask = (sidebar: SidebarView | undefined) => {
  const { today, route, navigate, setOpenCard } = useShell();
  const change = useChange();
  return useMemo(
    () => (byKey: boolean, into?: Route) => {
      const wanted = into ?? route;
      const home: Route = wanted.kind === "logbook" || wanted.kind === "trash" || wanted.kind === "missing" ? { kind: "inbox" } : wanted;
      const context = newTaskFor(home, today);
      const moves = routeHref(home) !== routeHref(route);
      if (moves) navigate(home, "keyboard");
      const area = home.kind === "area" ? sidebar?.areas.find((entry) => entry._id === home.id) : undefined;
      const projectArea = home.kind === "project" ? sidebar?.areas.find((entry) => entry.projects.some((project) => project._id === home.id)) : undefined;
      const project =
        home.kind === "project" ? [...(sidebar?.projects ?? []), ...(projectArea?.projects ?? [])].find((entry) => entry._id === home.id) : undefined;
      const owner = area ?? projectArea;
      const key = drafts.add(
        routeHref(home),
        {
          title: "New Task",
          notes: "",
          when: context.when,
          parent: ("parent" in context && context.parent) || { kind: "loose" },
          labelIds: [],
          status: { kind: "open" },
          order: "~",
          context: project?.title ?? area?.title,
          area: owner && { _id: owner._id, title: owner.title, colour: owner.colour, icon: owner.icon },
          project: project && { _id: project._id, title: project.title },
          labels: [],
          checklist: [],
          workBlocks: [],
          focus: { ms: 0, sessions: [] },
        },
        moves ? new Set<string>() : knownTaskIds(),
      );
      selection.clear();
      setOpenCard({ key, instant: byKey }, moves ? home : undefined);
      void change({
        title: "Task created",
        mutation: api.planner.tasks.create,
        args: { title: "New Task", ...context },
        apply: () => undefined,
        revert: () => undefined,
        onSaved: ({ taskId }) => drafts.saved(key, taskId),
      }).then((saved) => {
        if (saved) return;
        drafts.failed(key);
        setOpenCard(null);
      });
    },
    [change, navigate, route, setOpenCard, sidebar, today],
  );
};
