import type { FunctionReturnType } from "convex/server";
import type { api } from "../convex/_generated/api";

export type TodayTask = Extract<FunctionReturnType<typeof api.today.get>, { ok: true }>["value"]["tasks"][number];
export type ThingsSyncStatus = FunctionReturnType<typeof api.things.syncStatus>;
