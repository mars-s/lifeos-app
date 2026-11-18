import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { mcp } from "./mcp";

const http = httpRouter();
mcp.registerRoutes(http);

const bounceToApp = httpAction(async (_ctx, request) =>
  Response.redirect(`lifeos://auth${new URL(request.url).search}`, 302),
);

for (const path of ["/auth/iphone", "/auth/mac"]) http.route({ path, method: "GET", handler: bounceToApp });

export default http;
