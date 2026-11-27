import { defineSchema } from "convex/server";
import { aiTables } from "./ai/tables";
import { calendarTables } from "./calendar/tables";
import { healthTables } from "./health/tables";
import { noteTables } from "./notes/tables";
import { placesTables } from "./places/tables";
import { platformTables } from "./platform/tables";
import { plannerTables } from "./planner/tables";

export default defineSchema({
  ...platformTables,
  ...plannerTables,
  ...calendarTables,
  ...healthTables,
  ...placesTables,
  ...aiTables,
  ...noteTables,
});
