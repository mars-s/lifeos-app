"use client";

import { ViewTransition } from "react";
import type { SidebarView } from "@lifeos/backend/types";
import { AreaDot } from "@/components/lifeos/area";
import { ListSkeleton, Missing, ListPage } from "../list-page";
import { PanelNotice } from "../panel-boundary";
import type { Route } from "../route";
import { LIST_META, NOTES_META, PLANNER_META, SETTINGS_META } from "../sidebar";
import { NotesScreen } from "../../notes/notes-screen";
import { AnytimeScreen, SomedayScreen } from "./grouped";
import { AreaScreen, ProjectScreen } from "./containers";
import { LogbookScreen } from "./logbook";
import { PlannerScreen } from "./planner";
import { FeatureScreen } from "../settings/features";
import { SettingsScreen } from "../settings/settings-screen";
import { InboxScreen, TodayScreen } from "./today";
import { TrashScreen } from "./trash";

const knows = (sidebar: SidebarView, route: Extract<Route, { kind: "area" | "project" }>) =>
  route.kind === "area"
    ? sidebar.areas.some((area) => area._id === route.id)
    : [...sidebar.projects, ...sidebar.areas.flatMap((area) => area.projects)].some((project) => project._id === route.id);

const headerOf = (route: Route, sidebar: SidebarView | undefined) => {
  switch (route.kind) {
    case "planner":
      return { title: PLANNER_META.label, icon: PLANNER_META.icon };
    case "settings":
      return { title: SETTINGS_META.label, icon: SETTINGS_META.icon };
    case "notes":
      return { title: NOTES_META.label, icon: NOTES_META.icon };
    case "area": {
      const area = sidebar?.areas.find((entry) => entry._id === route.id);
      return { title: area?.title ?? "Area", leading: area && <AreaDot colour={area.colour} className="size-3" /> };
    }
    case "project": {
      const projects = [...(sidebar?.projects ?? []), ...(sidebar?.areas.flatMap((area) => area.projects) ?? [])];
      return { title: projects.find((entry) => entry._id === route.id)?.title ?? "Project" };
    }
    case "missing":
      return { title: "Nothing here" };
    default:
      return { title: LIST_META[route.kind].label, icon: LIST_META[route.kind].icon };
  }
};

export const failedScreen = (route: Route, sidebar: SidebarView | undefined) => (onRetry: () => void) => (
  <ListPage {...headerOf(route, sidebar)}>
    <PanelNotice panel="list" variant="screen" onRetry={onRetry} />
  </ListPage>
);

export const Screen = ({ route, sidebar, sidebarFailed }: { route: Route; sidebar: SidebarView | undefined; sidebarFailed: boolean }) => {
  switch (route.kind) {
    case "inbox":
      return <InboxScreen />;
    case "today":
      return <TodayScreen />;
    case "planner":
    case "upcoming":
      return <PlannerScreen tab={route.kind} />;
    case "anytime":
      return <AnytimeScreen />;
    case "someday":
      return <SomedayScreen />;
    case "logbook":
      return <LogbookScreen />;
    case "trash":
      return <TrashScreen />;
    case "settings":
      return (
        <ViewTransition
          key={route.feature ?? "settings"}
          enter={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "none" }}
          exit={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "none" }}
          default="none"
        >
          {route.feature ? <FeatureScreen feature={route.feature} /> : <SettingsScreen />}
        </ViewTransition>
      );
    case "notes":
      return <NotesScreen docId={route.id ?? null} sidebar={sidebar} />;
    case "missing":
      return <Missing />;
    case "area":
    case "project":
      if (!sidebar && sidebarFailed)
        return route.kind === "area" ? <AreaScreen areaId={route.id} /> : <ProjectScreen projectId={route.id} />;
      if (!sidebar)
        return (
          <ListPage>
            <ListSkeleton />
          </ListPage>
        );
      if (!knows(sidebar, route)) return <Missing />;
      return route.kind === "area" ? <AreaScreen areaId={route.id} /> : <ProjectScreen projectId={route.id} />;
  }
};
