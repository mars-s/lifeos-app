import { defineApp } from "convex/server";
import { v } from "convex/values";
import auth from "@convex-dev/auth/convex.config.js";
import authGithub from "@convex-dev/auth/components/github/convex.config.js";
import mcp from "@convex-dev/mcp/convex.config.js";

const app = defineApp({
  env: {
    AUTH_GITHUB_CLIENT_ID: v.string(),
    AUTH_GITHUB_CLIENT_SECRET: v.string(),
    LIFEOS_OWNER_GITHUB_ID: v.string(),
    OURA_CLIENT_ID: v.optional(v.string()),
    OURA_CLIENT_SECRET: v.optional(v.string()),
    OPENAI_API_KEY: v.optional(v.string()),
    SITE_URL: v.string(),
  },
});
app.use(auth);
app.use(authGithub, {
  httpPrefix: "/oauth/github",
  env: { CLIENT_ID: app.env.AUTH_GITHUB_CLIENT_ID, CLIENT_SECRET: app.env.AUTH_GITHUB_CLIENT_SECRET },
});
app.use(mcp);
export default app;
