/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ai_adapter from "../ai/adapter.js";
import type * as ai_agent from "../ai/agent.js";
import type * as ai_aiIndex from "../ai/aiIndex.js";
import type * as ai_capabilities from "../ai/capabilities.js";
import type * as ai_embeddings from "../ai/embeddings.js";
import type * as ai_indexRows from "../ai/indexRows.js";
import type * as ai_memory from "../ai/memory.js";
import type * as ai_migrations from "../ai/migrations.js";
import type * as ai_models from "../ai/models.js";
import type * as ai_policy from "../ai/policy.js";
import type * as ai_proposals from "../ai/proposals.js";
import type * as ai_routing from "../ai/routing.js";
import type * as ai_runs from "../ai/runs.js";
import type * as ai_search from "../ai/search.js";
import type * as ai_steps from "../ai/steps.js";
import type * as ai_tables from "../ai/tables.js";
import type * as ai_transport from "../ai/transport.js";
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
import type * as notes_agentReads from "../notes/agentReads.js";
import type * as notes_notes from "../notes/notes.js";
import type * as notes_relay from "../notes/relay.js";
import type * as notes_tables from "../notes/tables.js";
import type * as places_model from "../places/model.js";
import type * as places_saved from "../places/saved.js";
import type * as places_tables from "../places/tables.js";
import type * as places_trips from "../places/trips.js";
import type * as planner_agentReads from "../planner/agentReads.js";
import type * as planner_agentSmartBlocks from "../planner/agentSmartBlocks.js";
import type * as planner_agentWrites from "../planner/agentWrites.js";
import type * as planner_areas from "../planner/areas.js";
import type * as planner_checklist from "../planner/checklist.js";
import type * as planner_containers from "../planner/containers.js";
import type * as planner_convert from "../planner/convert.js";
import type * as planner_focus from "../planner/focus.js";
import type * as planner_labels from "../planner/labels.js";
import type * as planner_lists from "../planner/lists.js";
import type * as planner_model from "../planner/model.js";
import type * as planner_plan from "../planner/plan.js";
import type * as planner_projects from "../planner/projects.js";
import type * as planner_recurrence from "../planner/recurrence.js";
import type * as planner_rollups from "../planner/rollups.js";
import type * as planner_rows from "../planner/rows.js";
import type * as planner_selection from "../planner/selection.js";
import type * as planner_shape from "../planner/shape.js";
import type * as planner_sidebar from "../planner/sidebar.js";
import type * as planner_smartBlocks from "../planner/smartBlocks.js";
import type * as planner_smartEstimateModel from "../planner/smartEstimateModel.js";
import type * as planner_smartEstimateTrial from "../planner/smartEstimateTrial.js";
import type * as planner_smartEstimates from "../planner/smartEstimates.js";
import type * as planner_tables from "../planner/tables.js";
import type * as planner_tasks from "../planner/tasks.js";
import type * as planner_templates from "../planner/templates.js";
import type * as planner_things from "../planner/things.js";
import type * as planner_thingsImport from "../planner/thingsImport.js";
import type * as planner_thingsRows from "../planner/thingsRows.js";
import type * as planner_timeline from "../planner/timeline.js";
import type * as planner_today from "../planner/today.js";
import type * as planner_trash from "../planner/trash.js";
import type * as planner_widgets from "../planner/widgets.js";
import type * as planner_workBlocks from "../planner/workBlocks.js";
import type * as platform_access from "../platform/access.js";
import type * as platform_activity from "../platform/activity.js";
import type * as platform_agentRuns from "../platform/agentRuns.js";
import type * as platform_agentTools from "../platform/agentTools.js";
import type * as platform_change from "../platform/change.js";
import type * as platform_features from "../platform/features.js";
import type * as platform_jobs from "../platform/jobs.js";
import type * as platform_links from "../platform/links.js";
import type * as platform_secrets from "../platform/secrets.js";
import type * as platform_tables from "../platform/tables.js";
import type * as platform_undo from "../platform/undo.js";
import type * as platform_workers from "../platform/workers.js";
import type * as tools from "../tools.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "ai/adapter": typeof ai_adapter;
  "ai/agent": typeof ai_agent;
  "ai/aiIndex": typeof ai_aiIndex;
  "ai/capabilities": typeof ai_capabilities;
  "ai/embeddings": typeof ai_embeddings;
  "ai/indexRows": typeof ai_indexRows;
  "ai/memory": typeof ai_memory;
  "ai/migrations": typeof ai_migrations;
  "ai/models": typeof ai_models;
  "ai/policy": typeof ai_policy;
  "ai/proposals": typeof ai_proposals;
  "ai/routing": typeof ai_routing;
  "ai/runs": typeof ai_runs;
  "ai/search": typeof ai_search;
  "ai/steps": typeof ai_steps;
  "ai/tables": typeof ai_tables;
  "ai/transport": typeof ai_transport;
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
  "notes/agentReads": typeof notes_agentReads;
  "notes/notes": typeof notes_notes;
  "notes/relay": typeof notes_relay;
  "notes/tables": typeof notes_tables;
  "places/model": typeof places_model;
  "places/saved": typeof places_saved;
  "places/tables": typeof places_tables;
  "places/trips": typeof places_trips;
  "planner/agentReads": typeof planner_agentReads;
  "planner/agentSmartBlocks": typeof planner_agentSmartBlocks;
  "planner/agentWrites": typeof planner_agentWrites;
  "planner/areas": typeof planner_areas;
  "planner/checklist": typeof planner_checklist;
  "planner/containers": typeof planner_containers;
  "planner/convert": typeof planner_convert;
  "planner/focus": typeof planner_focus;
  "planner/labels": typeof planner_labels;
  "planner/lists": typeof planner_lists;
  "planner/model": typeof planner_model;
  "planner/plan": typeof planner_plan;
  "planner/projects": typeof planner_projects;
  "planner/recurrence": typeof planner_recurrence;
  "planner/rollups": typeof planner_rollups;
  "planner/rows": typeof planner_rows;
  "planner/selection": typeof planner_selection;
  "planner/shape": typeof planner_shape;
  "planner/sidebar": typeof planner_sidebar;
  "planner/smartBlocks": typeof planner_smartBlocks;
  "planner/smartEstimateModel": typeof planner_smartEstimateModel;
  "planner/smartEstimateTrial": typeof planner_smartEstimateTrial;
  "planner/smartEstimates": typeof planner_smartEstimates;
  "planner/tables": typeof planner_tables;
  "planner/tasks": typeof planner_tasks;
  "planner/templates": typeof planner_templates;
  "planner/things": typeof planner_things;
  "planner/thingsImport": typeof planner_thingsImport;
  "planner/thingsRows": typeof planner_thingsRows;
  "planner/timeline": typeof planner_timeline;
  "planner/today": typeof planner_today;
  "planner/trash": typeof planner_trash;
  "planner/widgets": typeof planner_widgets;
  "planner/workBlocks": typeof planner_workBlocks;
  "platform/access": typeof platform_access;
  "platform/activity": typeof platform_activity;
  "platform/agentRuns": typeof platform_agentRuns;
  "platform/agentTools": typeof platform_agentTools;
  "platform/change": typeof platform_change;
  "platform/features": typeof platform_features;
  "platform/jobs": typeof platform_jobs;
  "platform/links": typeof platform_links;
  "platform/secrets": typeof platform_secrets;
  "platform/tables": typeof platform_tables;
  "platform/undo": typeof platform_undo;
  "platform/workers": typeof platform_workers;
  tools: typeof tools;
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
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
};
