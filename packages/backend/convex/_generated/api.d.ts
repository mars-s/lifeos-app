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
import type * as http from "../http.js";
import type * as mcp from "../mcp.js";
import type * as planner_areas from "../planner/areas.js";
import type * as planner_checklist from "../planner/checklist.js";
import type * as planner_containers from "../planner/containers.js";
import type * as planner_labels from "../planner/labels.js";
import type * as planner_lists from "../planner/lists.js";
import type * as planner_model from "../planner/model.js";
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
  http: typeof http;
  mcp: typeof mcp;
  "planner/areas": typeof planner_areas;
  "planner/checklist": typeof planner_checklist;
  "planner/containers": typeof planner_containers;
  "planner/labels": typeof planner_labels;
  "planner/lists": typeof planner_lists;
  "planner/model": typeof planner_model;
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
