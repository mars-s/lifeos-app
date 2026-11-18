import { McpServer, tool } from "@convex-dev/mcp";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";

const ownerSubject = process.env.LIFEOS_OWNER_SUBJECT;
const ownerUserId = process.env.LIFEOS_OWNER_USER_ID ?? "owner";
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
        const result = await ctx.runQuery(internal.today.getForAgent, { date });
        if (!result.ok) throw new ConvexError(`Use a real date in YYYY-MM-DD form, not "${result.error.input}".`);
        return result.value;
      },
    }),
  },
});

export const { getAuthRequest, authorize, listConnections, revokeConnection, createApiKey } = mcp.api({
  getUserId: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    return identity && ownerSubject && identity.subject === ownerSubject ? ownerUserId : null;
  },
});

export const { createApiKeyForUser } = mcp.internalApi();
