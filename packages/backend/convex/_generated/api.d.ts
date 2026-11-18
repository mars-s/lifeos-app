/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as calendar_calendars from "../calendar/calendars.js";
import type * as calendar_capacity from "../calendar/capacity.js";
import type * as calendar_commitments from "../calendar/commitments.js";
import type * as calendar_model from "../calendar/model.js";
import type * as calendar_sync from "../calendar/sync.js";
import type * as calendar_tables from "../calendar/tables.js";
import type * as calendar_workingHours from "../calendar/workingHours.js";
import type * as crons from "../crons.js";
import type * as health_model from "../health/model.js";
import type * as health_oura from "../health/oura.js";
import type * as health_sleep from "../health/sleep.js";
import type * as health_tables from "../health/tables.js";
import type * as http from "../http.js";
import type * as mcp from "../mcp.js";
import type * as planner_areas from "../planner/areas.js";
import type * as planner_checklist from "../planner/checklist.js";
import type * as planner_containers from "../planner/containers.js";
import type * as planner_focus from "../planner/focus.js";
import type * as planner_labels from "../planner/labels.js";
import type * as planner_lists from "../planner/lists.js";
import type * as planner_model from "../planner/model.js";
import type * as planner_plan from "../planner/plan.js";
import type * as planner_projects from "../planner/projects.js";
import type * as planner_rows from "../planner/rows.js";
import type * as planner_selection from "../planner/selection.js";
import type * as planner_sidebar from "../planner/sidebar.js";
import type * as planner_tables from "../planner/tables.js";
import type * as planner_tasks from "../planner/tasks.js";
import type * as planner_things from "../planner/things.js";
import type * as planner_thingsImport from "../planner/thingsImport.js";
import type * as planner_thingsRows from "../planner/thingsRows.js";
import type * as planner_today from "../planner/today.js";
import type * as planner_trash from "../planner/trash.js";
import type * as planner_workBlocks from "../planner/workBlocks.js";
import type * as platform_access from "../platform/access.js";
import type * as platform_activity from "../platform/activity.js";
import type * as platform_change from "../platform/change.js";
import type * as platform_jobs from "../platform/jobs.js";
import type * as platform_links from "../platform/links.js";
import type * as platform_tables from "../platform/tables.js";
import type * as platform_undo from "../platform/undo.js";
import type * as platform_workers from "../platform/workers.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  "calendar/calendars": typeof calendar_calendars;
  "calendar/capacity": typeof calendar_capacity;
  "calendar/commitments": typeof calendar_commitments;
  "calendar/model": typeof calendar_model;
  "calendar/sync": typeof calendar_sync;
  "calendar/tables": typeof calendar_tables;
  "calendar/workingHours": typeof calendar_workingHours;
  crons: typeof crons;
  "health/model": typeof health_model;
  "health/oura": typeof health_oura;
  "health/sleep": typeof health_sleep;
  "health/tables": typeof health_tables;
  http: typeof http;
  mcp: typeof mcp;
  "planner/areas": typeof planner_areas;
  "planner/checklist": typeof planner_checklist;
  "planner/containers": typeof planner_containers;
  "planner/focus": typeof planner_focus;
  "planner/labels": typeof planner_labels;
  "planner/lists": typeof planner_lists;
  "planner/model": typeof planner_model;
  "planner/plan": typeof planner_plan;
  "planner/projects": typeof planner_projects;
  "planner/rows": typeof planner_rows;
  "planner/selection": typeof planner_selection;
  "planner/sidebar": typeof planner_sidebar;
  "planner/tables": typeof planner_tables;
  "planner/tasks": typeof planner_tasks;
  "planner/things": typeof planner_things;
  "planner/thingsImport": typeof planner_thingsImport;
  "planner/thingsRows": typeof planner_thingsRows;
  "planner/today": typeof planner_today;
  "planner/trash": typeof planner_trash;
  "planner/workBlocks": typeof planner_workBlocks;
  "platform/access": typeof platform_access;
  "platform/activity": typeof platform_activity;
  "platform/change": typeof platform_change;
  "platform/jobs": typeof platform_jobs;
  "platform/links": typeof platform_links;
  "platform/tables": typeof platform_tables;
  "platform/undo": typeof platform_undo;
  "platform/workers": typeof platform_workers;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  auth: import("@convex-dev/auth/_generated/component.js").ComponentApi<"auth">;
  authGithub: import("@convex-dev/auth/components/github/_generated/component.js").ComponentApi<"authGithub">;
  mcp: import("@convex-dev/mcp/_generated/component.js").ComponentApi<"mcp">;
};
