import { defineSchema } from "convex/server";
import { platformTables } from "./platform/tables";
import { plannerTables } from "./planner/tables";

export default defineSchema({
  ...platformTables,
  ...plannerTables,
});
