import type { PlannerTask } from "../types";

export type AreaColour = PlannerTask["labels"][number]["colour"];

export const AREA_COLOURS = ["violet", "green", "orange", "teal", "rose", "olive", "plum", "slate"] as const satisfies readonly AreaColour[];
