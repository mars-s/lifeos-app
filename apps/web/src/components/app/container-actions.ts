"use client";

import { generateKeyBetween } from "fractional-indexing";
import { useMemo } from "react";
import { api } from "@lifeos/backend/api";
import type { Id } from "@lifeos/backend/dataModel";
import type { PlannerTask, SidebarView } from "@lifeos/backend/types";
import { AREA_COLOURS, type AreaColour } from "@/components/lifeos/area";
import { haptic } from "@/lib/haptics";
import { both, dropContainer, nothing, patchContainer, patchProjectView, patchSidebar, useChange } from "./changes";
import { shortDay, whenLabel } from "./dates";
import type { Route, Via } from "./route";

export type SidebarArea = SidebarView["areas"][number];
export type SidebarProject = SidebarView["projects"][number];
type When = PlannerTask["when"];

const OPTIMISTIC = "optimistic:";

export const isDraftId = (id: string) => id.startsWith(OPTIMISTIC);

const quoted = (title: string) => (title.length > 28 ? `${title.slice(0, 27)}…` : title);

const mapAreas = (patch: (area: SidebarArea) => SidebarArea) => (sidebar: SidebarView) => ({ ...sidebar, areas: sidebar.areas.map(patch) });

const withoutProject = (projectId: string) => (sidebar: SidebarView) => ({
  ...sidebar,
  projects: sidebar.projects.filter((project) => project._id !== projectId),
  areas: sidebar.areas.map((area) => ({ ...area, projects: area.projects.filter((project) => project._id !== projectId) })),
});

const withProject = (project: SidebarProject, areaId: Id<"areas"> | null) => (sidebar: SidebarView) =>
  areaId === null
    ? { ...sidebar, projects: [...sidebar.projects, project] }
    : mapAreas((area) => (area._id === areaId ? { ...area, projects: [...area.projects, project] } : area))(sidebar);

const nextColour = (sidebar: SidebarView | undefined) => {
  const used = new Set<AreaColour>(sidebar?.areas.map((area) => area.colour));
  return AREA_COLOURS.find((colour) => !used.has(colour)) ?? AREA_COLOURS[(sidebar?.areas.length ?? 0) % AREA_COLOURS.length] ?? "slate";
};

const byOrder = (a: SidebarArea, b: SidebarArea) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0);

export const useContainerActions = (shell: { route: Route; navigate: (route: Route, via: Via) => void }) => {
  const change = useChange();
  return useMemo(() => {
    const { route, navigate } = shell;
    const leave = (kind: "area" | "project", id: string, to: Route) => {
      if (route.kind === kind && route.id === id) navigate(to, "keyboard");
    };

    return {
      createArea: (title: string, sidebar: SidebarView | undefined) => {
        const draftId = `${OPTIMISTIC}area:${title}` as Id<"areas">;
        const colour = nextColour(sidebar);
        const order = generateKeyBetween(sidebar?.areas.at(-1)?.order ?? null, null);
        void change({
          title: `Area ${quoted(title)} created`,
          mutation: api.planner.areas.create,
          args: { title, colour },
          apply: patchSidebar((current) => ({
            ...current,
            areas: [...current.areas, { _id: draftId, title, colour, icon: undefined, order, projects: [] }],
          })),
          revert: nothing,
          onSaved: ({ areaId }) => navigate({ kind: "area", id: areaId }, "keyboard"),
        });
      },

      createProject: (title: string, areaId: Id<"areas"> | null) => {
        const draft = { _id: `${OPTIMISTIC}project:${title}` as Id<"projects">, title, someday: false, progress: { done: 0, total: 0 } };
        void change({
          title: `Project ${quoted(title)} created`,
          mutation: api.planner.projects.create,
          args: { title, ...(areaId ? { areaId } : {}) },
          apply: patchSidebar(withProject(draft, areaId)),
          revert: nothing,
          onSaved: ({ projectId }) => navigate({ kind: "project", id: projectId }, "keyboard"),
        });
      },

      renameArea: (area: { _id: Id<"areas">; title: string }, title: string) =>
        void change({
          title: "Area renamed",
          mutation: api.planner.areas.rename,
          args: { areaId: area._id, title },
          apply: patchContainer(area._id, { title }),
          revert: patchContainer(area._id, { title: area.title }),
        }),

      setAreaColour: (area: { _id: Id<"areas">; title: string; colour: AreaColour }, colour: AreaColour) => {
        haptic("toggle");
        void change({
          title: `${quoted(area.title)} is now ${colour}`,
          mutation: api.planner.areas.setColour,
          args: { areaId: area._id, colour },
          apply: patchContainer(area._id, { colour }),
          revert: patchContainer(area._id, { colour: area.colour }),
          slot: `area-colour:${area._id}`,
        });
      },

      setAreaIcon: (area: { _id: Id<"areas">; title: string; icon?: string }, icon: string | null) => {
        haptic("toggle");
        void change({
          title: icon ? "Icon changed" : "Icon removed",
          mutation: api.planner.areas.setIcon,
          args: { areaId: area._id, icon },
          apply: patchContainer(area._id, { icon: icon ?? undefined }),
          revert: patchContainer(area._id, { icon: area.icon }),
          slot: `area-icon:${area._id}`,
        });
      },

      reorderArea: (area: SidebarArea, order: string) =>
        void change({
          title: `Moved ${quoted(area.title)}`,
          mutation: api.planner.areas.reorder,
          args: { areaId: area._id, order },
          apply: patchSidebar((sidebar) => ({
            ...sidebar,
            areas: sidebar.areas.map((entry) => (entry._id === area._id ? { ...entry, order } : entry)).toSorted(byOrder),
          })),
          revert: patchSidebar((sidebar) => ({
            ...sidebar,
            areas: sidebar.areas.map((entry) => (entry._id === area._id ? { ...entry, order: area.order } : entry)).toSorted(byOrder),
          })),
        }),

      trashArea: (area: { _id: Id<"areas">; title: string }) => {
        haptic("drop");
        leave("area", area._id, { kind: "today" });
        void change({
          title: `${quoted(area.title)} moved to Trash`,
          mutation: api.planner.areas.trash,
          args: { areaId: area._id },
          apply: dropContainer(area._id),
          revert: nothing,
        });
      },

      renameProject: (project: { _id: Id<"projects">; title: string }, title: string) =>
        void change({
          title: "Project renamed",
          mutation: api.planner.projects.rename,
          args: { projectId: project._id, title },
          apply: patchContainer(project._id, { title }),
          revert: patchContainer(project._id, { title: project.title }),
        }),

      setProjectNotes: (project: { _id: Id<"projects">; notes: string }, notes: string) =>
        void change({
          title: "Notes changed",
          mutation: api.planner.projects.setNotes,
          args: { projectId: project._id, notes },
          apply: patchProjectView(project._id, { notes }),
          revert: patchProjectView(project._id, { notes: project.notes }),
        }),

      setProjectWhen: (project: { _id: Id<"projects"> }, when: When, today: string) =>
        void change({
          title: `Project moved to ${whenLabel(when, today)}`,
          mutation: api.planner.projects.setWhen,
          args: { projectId: project._id, when },
          apply: both(patchProjectView(project._id, { when }), patchContainer(project._id, { someday: when.kind === "someday" })),
          revert: nothing,
        }),

      setProjectDeadline: (project: { _id: Id<"projects"> }, deadline: string | null) =>
        void change({
          title: deadline ? `Deadline set to ${shortDay(deadline)}` : "Deadline cleared",
          mutation: api.planner.projects.setDeadline,
          args: { projectId: project._id, deadline },
          apply: patchProjectView(project._id, { deadline: deadline ?? undefined }),
          revert: nothing,
        }),

      moveProject: (project: SidebarProject, to: { _id: Id<"areas">; title: string } | null) =>
        void change({
          title: to ? `Moved to ${quoted(to.title)}` : "Moved out of its Area",
          mutation: api.planner.projects.move,
          args: { projectId: project._id, areaId: to?._id ?? null },
          apply: patchSidebar((sidebar) => withProject(project, to?._id ?? null)(withoutProject(project._id)(sidebar))),
          revert: nothing,
        }),

      completeProject: (project: { _id: Id<"projects">; title: string }, areaId: Id<"areas"> | undefined) => {
        haptic("complete");
        leave("project", project._id, areaId ? { kind: "area", id: areaId } : { kind: "today" });
        void change({
          title: `${quoted(project.title)} completed`,
          mutation: api.planner.projects.complete,
          args: { projectId: project._id },
          apply: dropContainer(project._id),
          revert: nothing,
        });
      },

      trashProject: (project: { _id: Id<"projects">; title: string }, areaId: Id<"areas"> | undefined) => {
        haptic("drop");
        leave("project", project._id, areaId ? { kind: "area", id: areaId } : { kind: "today" });
        void change({
          title: `${quoted(project.title)} moved to Trash`,
          mutation: api.planner.projects.trash,
          args: { projectId: project._id },
          apply: dropContainer(project._id),
          revert: nothing,
        });
      },
    };
  }, [change, shell]);
};

export type ContainerActions = ReturnType<typeof useContainerActions>;
