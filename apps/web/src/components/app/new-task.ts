"use client";

import { generateNKeysBetween } from "fractional-indexing";
import { useEffect, useMemo } from "react";
import { api } from "@lifeos/backend/api";
import { addDays, type IsoDate } from "@lifeos/backend/date";
import type { Id } from "@lifeos/backend/dataModel";
import { blockMinutesFor } from "@lifeos/backend/plan";
import type { PlannerTask, SidebarView, TemplateRow } from "@lifeos/backend/types";
import { minuteAtPointer, SNAP_MINUTES } from "@/components/lifeos/timebox";
import { both, dropBlocksOf, dropTasks, nothing, useChange, type Updater } from "./changes";
import { momentAt } from "./dates";
import { drafts, type DraftBlock } from "./drafts";
import { readPlace, startUnderPointer, type NewTaskPlace } from "./new-task-place";
import { planCommands } from "./planner/commands";
import { localZone } from "./planner/model";
import { routeHref, type Route } from "./route";
import { selection } from "./selection";
import { useShell } from "./shell-context";
import { quoted } from "./task-actions";

type When = PlannerTask["when"];
type Parent = PlannerTask["parent"];
type Here = NewTaskPlace & { block?: DraftBlock; day?: IsoDate };

const contextFor = (route: Route, today: IsoDate) => {
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

const routePlace = (route: Route, today: IsoDate) => {
  const place: Here = { slot: routeHref(route), ...contextFor(route, today) };
  return place;
};

const NAVIGATION_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab", "Home", "End", "PageUp", "PageDown"]);

type Point = { x: number; y: number };

let pointer: Point | null = null;
let tracking = false;

const trackPointer = () => {
  if (tracking) return;
  tracking = true;
  window.addEventListener(
    "pointermove",
    (event) => {
      pointer = event.pointerType === "touch" ? null : { x: event.clientX, y: event.clientY };
    },
    { passive: true },
  );
  window.addEventListener("pointerout", (event) => {
    if (event.relatedTarget === null) pointer = null;
  });
  window.addEventListener("blur", () => {
    pointer = null;
  });
  window.addEventListener(
    "keydown",
    (event) => {
      if (NAVIGATION_KEYS.has(event.key)) pointer = null;
    },
    { capture: true, passive: true },
  );
};

const placeOf = (element: Element | null | undefined) =>
  readPlace(element?.closest<HTMLElement>("[data-new-task]")?.dataset.newTask ?? undefined);

const timeboxPlace = (x: number, y: number) => {
  const stack = document.elementsFromPoint(x, y);
  const surface = stack.find((element): element is HTMLElement => element instanceof HTMLElement && element.dataset.calDay !== undefined);
  const day = surface?.dataset.calDay as IsoDate | undefined;
  const place = day && placeOf(document.querySelector(`#main [data-plan-day="${CSS.escape(day)}"]`));
  if (!surface || !day || !place) return undefined;
  if (stack[0] !== surface) return { ...place, day } satisfies Here;
  const minutes = blockMinutesFor(undefined);
  const minute = startUnderPointer(minuteAtPointer(y, surface.getBoundingClientRect().top), minutes, SNAP_MINUTES);
  return { ...place, day, block: { date: day, minute, minutes } } satisfies Here;
};

const placeHere = (at: Point | null) => {
  if (at) {
    const pointed = timeboxPlace(at.x, at.y) ?? placeOf(document.elementFromPoint(at.x, at.y));
    if (pointed) return pointed;
  }
  const focused = document.activeElement;
  const fromFocus = focused && focused !== document.body ? placeOf(focused) : undefined;
  if (fromFocus) return fromFocus;
  const [chosen] = selection.keys();
  return chosen ? placeOf(document.querySelector(`#main [data-task-key="${CSS.escape(chosen)}"]`)) : undefined;
};

const parentIds = (parent: Parent | undefined) => ({
  areaId: parent?.kind === "area" ? parent.areaId : undefined,
  projectId: parent?.kind === "project" ? parent.projectId : undefined,
});

const fromTemplate = (template: TemplateRow, when: When, today: IsoDate) => {
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

export type NewTask = { byKey: boolean; into?: Route; here?: boolean; at?: Point; template?: TemplateRow };

export const useNewTask = (sidebar: SidebarView | undefined) => {
  const { today, route, navigate, setOpenCard, closeCard } = useShell();
  const change = useChange();
  useEffect(trackPointer, []);
  return useMemo(
    () =>
      ({ byKey, into, here = false, at, template }: NewTask) => {
        const wanted = into ?? route;
        const home: Route = wanted.kind === "logbook" || wanted.kind === "trash" || wanted.kind === "missing" ? { kind: "inbox" } : wanted;
        const pointed: Here | undefined = here && !into ? placeHere(at ?? pointer) : undefined;
        const returnTo = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : undefined;
        const place: Here = pointed ?? routePlace(home, today);
        const moves = !pointed && routeHref(home) !== routeHref(route);
        if (moves) navigate(home, "keyboard");
        if (pointed?.day) planCommands.reveal?.(pointed.day);
        const { areaId, projectId } = parentIds(place.parent);
        const area = areaId ? sidebar?.areas.find((entry) => entry._id === areaId) : undefined;
        const projectArea = projectId ? sidebar?.areas.find((entry) => entry.projects.some((project) => project._id === projectId)) : undefined;
        const project = projectId ? [...(sidebar?.projects ?? []), ...(projectArea?.projects ?? [])].find((entry) => entry._id === projectId) : undefined;
        const owner = area ?? projectArea;
        const parent = place.parent ?? { kind: "loose" };
        const shaped = template && fromTemplate(template, place.when, today);
        const onSaved = ({ taskId }: { taskId: Id<"tasks"> }) => drafts.saved(key, taskId);
        const afterSave = (saved: boolean) => {
          if (saved) return;
          drafts.failed(key);
          closeCard(key);
        };
        const uncreate: Updater = (store) => both(dropTasks([drafts.realId(key)]), dropBlocksOf([drafts.realId(key)]))(store);
        const onUndo = () => {
          drafts.release(key);
          closeCard(key);
        };
        const save = (title: string) =>
          void change({
            title: "Task created",
            mutation: api.planner.tasks.create,
            args: {
              title,
              when: place.when,
              ...(place.parent ? { parent: place.parent } : {}),
              ...(place.block ? { block: { start: momentAt(place.block.date, place.block.minute), minutes: place.block.minutes, timeZone: localZone() } } : {}),
            },
            apply: nothing,
            revert: uncreate,
            onSaved,
            onUndo,
          }).then(afterSave);
        const key = drafts.add(
          place.slot,
          {
            title: "",
            notes: "",
            when: place.when,
            parent,
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
          template ? undefined : { save, ...(place.block ? { block: place.block } : {}), ...(returnTo ? { returnTo } : {}) },
        );
        selection.clear();
        setOpenCard({ key, instant: byKey }, moves ? home : undefined);
        if (!template) return;
        void change({
          title: `${quoted(template.title)} created`,
          mutation: api.planner.templates.createTask,
          args: { templateId: template._id, when: place.when, ...(place.parent ? { parent: place.parent } : {}), today },
          apply: nothing,
          revert: uncreate,
          onSaved,
          onUndo,
        }).then(afterSave);
      },
    [change, navigate, route, setOpenCard, closeCard, sidebar, today],
  );
};
