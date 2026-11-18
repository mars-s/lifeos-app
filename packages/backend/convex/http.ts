import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { mcp } from "./mcp";

const http = httpRouter();
mcp.registerRoutes(http);

http.route({
  path: "/auth/iphone",
  method: "GET",
  handler: httpAction(async (_ctx, request) =>
    Response.redirect(`lifeos://auth${new URL(request.url).search}`, 302),
  ),
});

export default http;
