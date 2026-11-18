import type { FunctionReturnType } from "convex/server";
import type { api } from "../convex/_generated/api";

export type TodayView = Extract<FunctionReturnType<typeof api.planner.today.get>, { ok: true }>["value"];
export type TodayTask = TodayView["tasks"][number];
export type ThingsSyncStatus = FunctionReturnType<typeof api.planner.things.status>;
export type { AccessError } from "../convex/platform/access";
