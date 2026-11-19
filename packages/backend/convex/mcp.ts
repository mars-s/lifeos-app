import { McpServer } from "@convex-dev/mcp";
import type { Auth, FunctionReference, FunctionReturnType } from "convex/server";
import { components, internal } from "./_generated/api";
import { MCP_SCOPES, mcpOwnerUserId } from "./platform/access";
import { platformTools } from "./platform/agentTools";
import { plannerReadTools } from "./planner/agentReads";
import { smartBlockTools } from "./planner/agentSmartBlocks";
import { plannerWriteTools } from "./planner/agentWrites";

type RunsQueries = {
  auth: Auth;
  runQuery: <Query extends FunctionReference<"query", "internal">>(query: Query) => Promise<FunctionReturnType<Query>>;
};

const runsQueries = (ctx: { auth: Auth }): ctx is RunsQueries => "runQuery" in ctx && typeof ctx.runQuery === "function";
const siteUrl = process.env.SITE_URL ?? "http://localhost:3000";

export const mcp: McpServer = new McpServer(components.mcp, {
  name: "lifeos",
  title: "LifeOS",
  version: "0.2.0",
  instructions: [
    "LifeOS is Avi's personal planner and the home of his Tasks, Areas, Projects and plans.",
    "Use search, list_tasks or list_areas to find ids before you change anything. Dates are YYYY-MM-DD and times are in Avi's time zone unless you pass timeZone.",
    "Every write is recorded as one Agent Run per connection (it ends after 10 idle minutes) and returns its runId and activityIds, so Avi can undo one change or the whole run. The undo tool does the same.",
    "Apple Calendar owns External Commitments and Oura owns sleep: read them, never plan over them without asking.",
  ].join(" "),
  consentUrl: process.env.MCP_CONSENT_URL ?? `${siteUrl}/connect`,
  scopes: {
    [MCP_SCOPES.read]: "See your Tasks, Projects, Areas, plans, calendar and sleep",
    [MCP_SCOPES.write]: "Create and change Tasks and plans, and undo those changes",
  },
  tools: { ...plannerReadTools, ...plannerWriteTools, ...smartBlockTools, ...platformTools },
});

export const { getAuthRequest, findAuthRequest, authorize, listConnections, revokeConnection, createApiKey } = mcp.api({
  getUserId: async (ctx) =>
    runsQueries(ctx) && (await ctx.runQuery(internal.platform.access.isOwner)) ? mcpOwnerUserId() : null,
});

export const { createApiKeyForUser } = mcp.internalApi();
