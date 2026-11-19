import { defineSchema } from "convex/server";
import { calendarTables } from "./calendar/tables";
import { healthTables } from "./health/tables";
import { placesTables } from "./places/tables";
import { platformTables } from "./platform/tables";
import { plannerTables } from "./planner/tables";

export default defineSchema({
  ...platformTables,
  ...plannerTables,
  ...calendarTables,
  ...healthTables,
  ...placesTables,
});
