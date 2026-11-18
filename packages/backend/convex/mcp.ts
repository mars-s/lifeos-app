import { McpServer, tool } from "@convex-dev/mcp";
import type { Auth, FunctionReference, FunctionReturnType } from "convex/server";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";

const ownerUserId = process.env.LIFEOS_OWNER_USER_ID ?? "owner";

type RunsQueries = {
  auth: Auth;
  runQuery: <Query extends FunctionReference<"query", "internal">>(query: Query) => Promise<FunctionReturnType<Query>>;
};

const runsQueries = (ctx: { auth: Auth }): ctx is RunsQueries => "runQuery" in ctx && typeof ctx.runQuery === "function";
const siteUrl = process.env.SITE_URL ?? "http://localhost:3000";

export const mcp: McpServer = new McpServer(components.mcp, {
  name: "lifeos",
  title: "LifeOS",
  version: "0.1.0",
  instructions:
    "LifeOS is Avi's personal planner. Things 3 owns tasks and Apple Calendar owns time. Read before you suggest changes.",
  consentUrl: process.env.MCP_CONSENT_URL ?? `${siteUrl}/connect`,
  scopes: {
    "lifeos:read": "See your LifeOS tasks and plans",
  },
  tools: {
    today: tool({
      title: "Today",
      description:
        "List Avi's Today tasks from Things 3 for one local date (YYYY-MM-DD): the Today list, anything starting on or before that date, and anything due by then. Each task has its project or area as context.",
      args: { date: v.string() },
      annotations: { readOnlyHint: true },
      scope: "lifeos:read",
      handler: async (ctx, { date }, user) => {
        if (user.userId !== ownerUserId) throw new ConvexError("This LifeOS belongs to someone else.");
        const result = await ctx.runQuery(internal.planner.today.getForAgent, { date });
        if (!result.ok) throw new ConvexError(`Use a real date in YYYY-MM-DD form, not "${result.error.input}".`);
        return result.value;
      },
    }),
  },
});

export const { getAuthRequest, authorize, listConnections, revokeConnection, createApiKey } = mcp.api({
  getUserId: async (ctx) =>
    runsQueries(ctx) && (await ctx.runQuery(internal.platform.access.isOwner)) ? ownerUserId : null,
});

export const { createApiKeyForUser } = mcp.internalApi();
