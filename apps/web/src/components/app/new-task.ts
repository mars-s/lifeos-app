"use client";

import { generateNKeysBetween } from "fractional-indexing";
import { useMemo } from "react";
import { api } from "@lifeos/backend/api";
import { addDays, type IsoDate } from "@lifeos/backend/date";
import type { Id } from "@lifeos/backend/dataModel";
import type { PlannerTask, SidebarView, TemplateRow } from "@lifeos/backend/types";
import { nothing, useChange } from "./changes";
import { drafts } from "./drafts";
import { routeHref, type Route } from "./route";
import { selection } from "./selection";
import { useShell } from "./shell-context";
import { quoted } from "./task-actions";

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

const fromTemplate = (template: TemplateRow, when: PlannerTask["when"], today: IsoDate) => {
  const keys = generateNKeysBetween(null, null, template.checklist.length);
  const date = when.kind === "scheduled" ? (when.date as IsoDate) : today;
  const homed = template.parent.kind !== "loose";
  return {
    title: template.title,
    notes: template.notes,
    ...(template.estimateMinutes === undefined ? {} : { estimateMinutes: template.estimateMinutes }),
    ...(template.deadlineOffsetDays === undefined ? {} : { deadline: addDays(date, template.deadlineOffsetDays) }),
    labelIds: template.labelIds,
    labels: template.labels,
    checklist: template.checklist.map((title, index) => ({
      _id: `optimistic:${keys[index]}` as Id<"checklistItems">,
      title,
      done: false,
      order: keys[index] ?? "a0",
    })),
    ...(homed
      ? { parent: template.parent, area: template.area, project: template.project, context: template.project?.title ?? template.area?.title }
      : {}),
  };
};

export const knownTaskIds = () =>
  new Set([...document.querySelectorAll<HTMLElement>("#main [data-task-id]")].flatMap((row) => row.dataset.taskId ?? []));

export const useNewTask = (sidebar: SidebarView | undefined) => {
  const { today, route, navigate, setOpenCard } = useShell();
  const change = useChange();
  return useMemo(
    () => (byKey: boolean, into?: Route, template?: TemplateRow) => {
      const wanted = into ?? route;
      const home: Route = wanted.kind === "logbook" || wanted.kind === "trash" || wanted.kind === "templates" || wanted.kind === "missing" ? { kind: "inbox" } : wanted;
      const context = newTaskFor(home, today);
      const moves = routeHref(home) !== routeHref(route);
      if (moves) navigate(home, "keyboard");
      const area = home.kind === "area" ? sidebar?.areas.find((entry) => entry._id === home.id) : undefined;
      const projectArea = home.kind === "project" ? sidebar?.areas.find((entry) => entry.projects.some((project) => project._id === home.id)) : undefined;
      const project =
        home.kind === "project" ? [...(sidebar?.projects ?? []), ...(projectArea?.projects ?? [])].find((entry) => entry._id === home.id) : undefined;
      const owner = area ?? projectArea;
      const shaped = template && fromTemplate(template, context.when, today);
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
          ...shaped,
        },
        moves ? new Set<string>() : knownTaskIds(),
      );
      selection.clear();
      setOpenCard({ key, instant: byKey }, moves ? home : undefined);
      const onSaved = ({ taskId }: { taskId: Id<"tasks"> }) => drafts.saved(key, taskId);
      const saving = template
        ? change({
            title: `${quoted(template.title)} created`,
            mutation: api.planner.templates.createTask,
            args: { templateId: template._id, when: context.when, ...("parent" in context ? { parent: context.parent } : {}), today },
            apply: nothing,
            revert: nothing,
            onSaved,
          })
        : change({
            title: "Task created",
            mutation: api.planner.tasks.create,
            args: { title: "New Task", ...context },
            apply: nothing,
            revert: nothing,
            onSaved,
          });
      void saving.then((saved) => {
        if (saved) return;
        drafts.failed(key);
        setOpenCard(null);
      });
    },
    [change, navigate, route, setOpenCard, sidebar, today],
  );
};
