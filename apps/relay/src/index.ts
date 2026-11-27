import { decodeCatchUpRequest, isNoteId, tokenFromProtocols } from "@lifeos/notes/protocol";
import { bearerToken, verifyOwnerToken } from "./auth.ts";
import type { Env } from "./env.ts";

export { Note } from "./note.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

const reply = (body: BodyInit | null, status: number, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { ...cors, ...headers } });

const route = (pathname: string) => {
  const match = /^\/notes\/([^/]+)(\/sync)?$/.exec(pathname);
  if (!match?.[1] || !isNoteId(match[1])) return null;
  return { noteId: match[1], sync: match[2] === "/sync" };
};

const noteFor = (env: Env, noteId: string) => env.NOTE.get(env.NOTE.idFromName(noteId));

const handle = async (request: Request, env: Env) => {
    const { pathname } = new URL(request.url);
    if (request.method === "OPTIONS") return reply(null, 204);
    if (pathname === "/health") return reply("ok", 200);
    const target = route(pathname);
    if (!target) return reply("not found", 404);

    if (!target.sync && request.method === "GET") {
      if (request.headers.get("Upgrade") !== "websocket") return reply("expected a websocket", 426);
      const token = tokenFromProtocols(request.headers.get("Sec-WebSocket-Protocol"));
      if (!token || !(await verifyOwnerToken(token, env.CONVEX_CLOUD_URL))) return reply("signed out", 401);
      return noteFor(env, target.noteId).fetch(request);
    }

    const token = bearerToken(request);
    if (!token || !(await verifyOwnerToken(token, env.CONVEX_CLOUD_URL))) return reply("signed out", 401);

    if (target.sync && request.method === "POST") {
      const body = new Uint8Array(await request.arrayBuffer());
      const parsed = (() => {
        try {
          const decoded = decodeCatchUpRequest(body);
          return decoded.stateVector.byteLength > 0 ? decoded : null;
        } catch {
          return null;
        }
      })();
      if (!parsed) return reply("malformed catch-up", 400);
      const answer = await noteFor(env, target.noteId).catchUp(parsed.stateVector, parsed.update);
      return reply(answer, 200, { "Content-Type": "application/octet-stream" });
    }

    if (!target.sync && request.method === "DELETE") {
      await noteFor(env, target.noteId).erase();
      return reply(null, 204);
    }

    return reply("method not allowed", 405);
};

export default {
  async fetch(request: Request, env: Env) {
    try {
      return await handle(request, env);
    } catch {
      return reply("the relay could not do that", 500);
    }
  },
} satisfies ExportedHandler<Env>;
