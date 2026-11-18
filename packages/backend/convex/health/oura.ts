import { v } from "convex/values";
import { err, errAsync, ok, okAsync, ResultAsync, type Result } from "neverthrow";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { env, internalAction, internalMutation, internalQuery, type ActionCtx } from "../_generated/server";
import { ownerMutation } from "../platform/access";
import { addDays, type IsoDate } from "../../shared/date";
import { serialise } from "../../shared/result";
import { healthDaysFrom, parseCollection, type OuraCollections } from "./model";
import { vHealthDay, vOuraError, type HealthDay, type OuraError } from "./tables";

export const OURA_SCOPES = "daily";
export const OURA_AUTHORIZE_URL = "https://cloud.ouraring.com/oauth/authorize";
export const OURA_TOKEN_URL = "https://api.ouraring.com/oauth/token";
export const OURA_API = "https://api.ouraring.com/v2/usercollection";
export const CALLBACK_PATH = "/oura/callback";
const USER_AGENT = "LifeOS/1.0";
const STATE_TTL_MS = 10 * 60_000;
const REFRESH_MARGIN_MS = 5 * 60_000;
const SYNC_DAYS_BACK = 16;
const MAX_PAGES = 10;

export const redirectUri = () => `${env.CONVEX_SITE_URL}${CALLBACK_PATH}`;

const clientCredentials = () => {
  const id = env.OURA_CLIENT_ID;
  const secret = env.OURA_CLIENT_SECRET;
  return id && secret ? ok<{ id: string; secret: string }, OuraError>({ id, secret }) : err<{ id: string; secret: string }, OuraError>({ kind: "not_configured" });
};

export const ouraConfigured = () => clientCredentials().isOk();

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const randomBytes = (length: number) => crypto.getRandomValues(new Uint8Array(length));

const challengeFor = async (verifier: string) =>
  base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));

export const connect = ownerMutation({
  args: {},
  handler: async (ctx) => {
    const credentials = clientCredentials();
    if (credentials.isErr()) return serialise(err<{ url: string }, OuraError>(credentials.error));
    const now = Date.now();
    for (const stale of await ctx.db.query("ouraAuthStates").take(20)) {
      if (stale.expiresAt < now) await ctx.db.delete("ouraAuthStates", stale._id);
    }
    const state = base64Url(randomBytes(24));
    const verifier = base64Url(randomBytes(48));
    await ctx.db.insert("ouraAuthStates", { state, verifier, expiresAt: now + STATE_TTL_MS });
    const url = new URL(OURA_AUTHORIZE_URL);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: credentials.value.id,
      redirect_uri: redirectUri(),
      scope: OURA_SCOPES,
      state,
      code_challenge: await challengeFor(verifier),
      code_challenge_method: "S256",
    }).toString();
    return serialise(ok<{ url: string }, OuraError>({ url: url.toString() }));
  },
});

export const syncNow = ownerMutation({
  args: {},
  handler: async (ctx) => {
    const connection = await ctx.db.query("ouraConnection").first();
    if (!connection) return serialise(err<{ queued: true }, OuraError>({ kind: "not_connected" }));
    await ctx.scheduler.runAfter(0, internal.health.oura.sync, {});
    return serialise(ok<{ queued: true }, OuraError>({ queued: true }));
  },
});

export const takeState = internalMutation({
  args: { state: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { state }) => {
    const row = await ctx.db
      .query("ouraAuthStates")
      .withIndex("by_state", (q) => q.eq("state", state))
      .unique();
    if (!row) return null;
    await ctx.db.delete("ouraAuthStates", row._id);
    return row.expiresAt >= Date.now() ? row.verifier : null;
  },
});

export const connection = internalQuery({
  args: {},
  handler: (ctx) => ctx.db.query("ouraConnection").first(),
});

const vTokens = { accessToken: v.string(), refreshToken: v.string(), expiresAt: v.number(), scope: v.string() };

export const saveConnection = internalMutation({
  args: vTokens,
  returns: v.null(),
  handler: async (ctx, tokens) => {
    const rows = await ctx.db.query("ouraConnection").take(5);
    for (const row of rows) await ctx.db.delete("ouraConnection", row._id);
    await ctx.db.insert("ouraConnection", { ...tokens, connectedAt: Date.now(), sync: { kind: "never" } });
    return null;
  },
});

export const rotateTokens = internalMutation({
  args: { ...vTokens, previousRefreshToken: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { previousRefreshToken, ...tokens }) => {
    const row = await ctx.db.query("ouraConnection").first();
    if (!row) return null;
    if (row.refreshToken !== previousRefreshToken) return row.accessToken;
    await ctx.db.patch("ouraConnection", row._id, tokens);
    return tokens.accessToken;
  },
});

export const recordSync = internalMutation({
  args: { at: v.number(), days: v.array(vHealthDay) },
  returns: v.null(),
  handler: async (ctx, { at, days }) => {
    const row = await ctx.db.query("ouraConnection").first();
    if (!row) return null;
    for (const day of days) {
      const existing = await ctx.db
        .query("healthDays")
        .withIndex("by_source_and_day", (q) => q.eq("source", "oura").eq("day", day.day))
        .unique();
      const fields = { source: "oura" as const, ...day, syncedAt: at };
      if (existing) await ctx.db.replace("healthDays", existing._id, fields);
      else await ctx.db.insert("healthDays", fields);
    }
    await ctx.db.patch("ouraConnection", row._id, { sync: { kind: "ok", at } });
    return null;
  },
});

export const recordFailure = internalMutation({
  args: { at: v.number(), error: vOuraError },
  returns: v.null(),
  handler: async (ctx, { at, error }) => {
    const row = await ctx.db.query("ouraConnection").first();
    if (!row) return null;
    const lastOkAt = row.sync.kind === "ok" ? row.sync.at : row.sync.kind === "failed" ? row.sync.lastOkAt : undefined;
    await ctx.db.patch("ouraConnection", row._id, {
      sync: { kind: "failed", at, error, ...(lastOkAt === undefined ? {} : { lastOkAt }) },
    });
    return null;
  },
});

const unauthorised: OuraError = { kind: "unauthorised" };
const forbidden: OuraError = { kind: "forbidden" };
const unreachable: OuraError = { kind: "unavailable" };
const invalidResponse: OuraError = { kind: "invalid_response" };

const failureOf = (response: Response, tokenEndpoint: boolean) => {
  if (response.status === 401 || (tokenEndpoint && response.status === 400)) return unauthorised;
  if (response.status === 403) return forbidden;
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after"));
    const limited: OuraError = { kind: "rate_limited", ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSeconds: retryAfter } : {}) };
    return limited;
  }
  const down: OuraError = { kind: "unavailable", status: response.status };
  return down;
};

const fetchJson = (url: string, init: RequestInit, tokenEndpoint = false) =>
  ResultAsync.fromPromise(fetch(url, init), () => unreachable).andThen((response) =>
    response.ok
      ? ResultAsync.fromPromise(response.json() as Promise<unknown>, () => invalidResponse)
      : errAsync(failureOf(response, tokenEndpoint)),
  );

type Tokens = { accessToken: string; refreshToken: string; expiresAt: number; scope: string };

const parseTokens = (body: unknown, now: number) => {
  if (typeof body !== "object" || body === null) return err<Tokens, OuraError>({ kind: "invalid_response" });
  const { access_token, refresh_token, expires_in, scope } = body as Record<string, unknown>;
  return typeof access_token === "string" && typeof refresh_token === "string" && typeof expires_in === "number"
    ? ok<Tokens, OuraError>({
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt: now + expires_in * 1000,
        scope: typeof scope === "string" ? scope : OURA_SCOPES,
      })
    : err<Tokens, OuraError>({ kind: "invalid_response" });
};

const requestTokens = (grant: Record<string, string>, now: number) =>
  clientCredentials()
    .asyncAndThen(({ id, secret }) =>
      fetchJson(
        OURA_TOKEN_URL,
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": USER_AGENT },
          body: new URLSearchParams({ ...grant, client_id: id, client_secret: secret }).toString(),
        },
        true,
      ),
    )
    .andThen((body) => parseTokens(body, now));

const freshAccessToken = (ctx: ActionCtx, current: Doc<"ouraConnection">, now: number) => {
  if (current.expiresAt - now > REFRESH_MARGIN_MS) return okAsync<string, OuraError>(current.accessToken);
  return requestTokens({ grant_type: "refresh_token", refresh_token: current.refreshToken }, now)
    .andThen((tokens) => {
      const rotated: Promise<string | null> = ctx.runMutation(internal.health.oura.rotateTokens, {
        ...tokens,
        previousRefreshToken: current.refreshToken,
      });
      return ResultAsync.fromSafePromise<string | null, OuraError>(rotated);
    })
    .orElse((error: OuraError) => {
      if (error.kind !== "unauthorised") return errAsync<string | null, OuraError>(error);
      const latest: Promise<Doc<"ouraConnection"> | null> = ctx.runQuery(internal.health.oura.connection, {});
      return ResultAsync.fromSafePromise<Doc<"ouraConnection"> | null, OuraError>(latest).map((row) =>
        row && row.refreshToken !== current.refreshToken ? row.accessToken : null,
      );
    })
    .andThen((token) => (token ? okAsync<string, OuraError>(token) : errAsync<string, OuraError>(unauthorised)));
};

const fetchCollection = (token: string, name: string, start: IsoDate, end: IsoDate) => {
  const page: (collected: readonly unknown[], next: string | undefined, pages: number) => ResultAsync<readonly unknown[], OuraError> = (
    collected,
    next,
    pages,
  ) => {
    const url = new URL(`${OURA_API}/${name}`);
    url.searchParams.set("start_date", start);
    url.searchParams.set("end_date", end);
    if (next) url.searchParams.set("next_token", next);
    return fetchJson(url.toString(), { headers: { authorization: `Bearer ${token}`, "user-agent": USER_AGENT } })
      .andThen(parseCollection)
      .andThen(({ data, nextToken }) =>
        nextToken && pages + 1 < MAX_PAGES ? page([...collected, ...data], nextToken, pages + 1) : okAsync([...collected, ...data]),
      );
  };
  return page([], undefined, 0);
};

const fetchDays = (token: string, today: IsoDate) => {
  const start = addDays(today, -SYNC_DAYS_BACK);
  const end = addDays(today, 1);
  return ResultAsync.combine([
    fetchCollection(token, "sleep", start, end),
    fetchCollection(token, "daily_sleep", start, end),
    fetchCollection(token, "sleep_time", start, end),
  ]).map(([sleep, dailySleep, sleepTime]) => healthDaysFrom({ sleep, dailySleep, sleepTime } satisfies OuraCollections));
};

export const sync = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const current: Doc<"ouraConnection"> | null = await ctx.runQuery(internal.health.oura.connection, {});
    if (!current) return null;
    const today = new Date(now).toISOString().slice(0, 10) as IsoDate;
    const result: Result<HealthDay[], OuraError> = await freshAccessToken(ctx, current, now).andThen((token: string) => fetchDays(token, today));
    const write: Promise<null> = result.match(
      (days) => ctx.runMutation(internal.health.oura.recordSync, { at: now, days }),
      (error) => ctx.runMutation(internal.health.oura.recordFailure, { at: now, error }),
    );
    await write;
    return null;
  },
});

const page = (status: number, heading: string, body: string) =>
  new Response(
    `<!doctype html><html lang="en-AU"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${heading}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;background:light-dark(#f6f5f2,#141416);color:light-dark(#1c1c1e,#ececee)}main{max-width:22rem;padding:2rem}h1{font-size:1.25rem;margin:0 0 .5rem}p{margin:0;opacity:.7}</style><main><h1>${heading}</h1><p>${body}</p></main></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } },
  );

export const finishConnect = async (ctx: ActionCtx, request: Request) => {
  const params = new URL(request.url).searchParams;
  const state = params.get("state");
  const verifier = state ? await ctx.runMutation(internal.health.oura.takeState, { state }) : null;
  if (!verifier) return page(400, "This link has expired", "Start again from Connect Oura in LifeOS.");
  const code = params.get("code");
  if (!code) return page(400, "Oura was not connected", "Oura did not share your sleep. Start again from LifeOS if you change your mind.");
  const now = Date.now();
  const tokens = await requestTokens({ grant_type: "authorization_code", code, redirect_uri: redirectUri(), code_verifier: verifier }, now);
  if (tokens.isErr()) return page(502, "Oura did not connect", "Oura refused the sign-in. Try Connect Oura again in a minute.");
  await ctx.runMutation(internal.health.oura.saveConnection, tokens.value);
  await ctx.scheduler.runAfter(0, internal.health.oura.sync, {});
  return page(200, "Oura is connected", "LifeOS is pulling your sleep now. You can close this tab.");
};
