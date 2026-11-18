"use client";

import type { SidebarView } from "@lifeos/backend/types";
import { ListSkeleton, Missing, ListPage } from "../list-page";
import type { Route } from "../route";
import { AnytimeScreen, SomedayScreen } from "./grouped";
import { AreaScreen, ProjectScreen } from "./containers";
import { LogbookScreen } from "./logbook";
import { PlannerScreen } from "./planner";
import { InboxScreen, TodayScreen } from "./today";
import { TrashScreen } from "./trash";
import { UpcomingScreen } from "./upcoming";

export { UPCOMING_DAYS } from "./upcoming";

const knows = (sidebar: SidebarView, route: Extract<Route, { kind: "area" | "project" }>) =>
  route.kind === "area"
    ? sidebar.areas.some((area) => area._id === route.id)
    : [...sidebar.projects, ...sidebar.areas.flatMap((area) => area.projects)].some((project) => project._id === route.id);

export const Screen = ({ route, sidebar, sidebarFailed }: { route: Route; sidebar: SidebarView | undefined; sidebarFailed: boolean }) => {
  switch (route.kind) {
    case "inbox":
      return <InboxScreen />;
    case "today":
      return <TodayScreen />;
    case "planner":
      return <PlannerScreen />;
    case "upcoming":
      return <UpcomingScreen />;
    case "anytime":
      return <AnytimeScreen />;
    case "someday":
      return <SomedayScreen />;
    case "logbook":
      return <LogbookScreen />;
    case "trash":
      return <TrashScreen />;
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
