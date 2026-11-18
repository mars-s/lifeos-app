import type { FunctionReturnType } from "convex/server";
import type { api } from "../convex/_generated/api";

export type TodayView = Extract<FunctionReturnType<typeof api.planner.today.get>, { ok: true }>["value"];
export type TodayTask = TodayView["tasks"][number];
export type ThingsSyncStatus = FunctionReturnType<typeof api.planner.things.status>;
export type { AccessError } from "../convex/platform/access";

type Ok<T> = Extract<T, { ok: true }> extends { value: infer V } ? V : never;

export type PlannerTask = TodayTask;
export type SidebarView = Ok<FunctionReturnType<typeof api.planner.sidebar.get>>;
export type AnytimeView = Ok<FunctionReturnType<typeof api.planner.lists.anytime>>;
export type TaskGroup = AnytimeView["groups"][number];
export type SomedayView = FunctionReturnType<typeof api.planner.lists.someday>;
export type UpcomingView = Ok<FunctionReturnType<typeof api.planner.lists.upcoming>>;
export type AreaView = NonNullable<FunctionReturnType<typeof api.planner.lists.area>>;
export type ProjectView = NonNullable<FunctionReturnType<typeof api.planner.lists.project>>;
