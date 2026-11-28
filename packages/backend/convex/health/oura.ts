import { v } from "convex/values";
import { Clock, Context, Effect, Layer, Predicate, Redacted, Result, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { env, type ActionCtx } from "../_generated/server";
import { addDays, type IsoDate } from "../../shared/date";
import { asWire, wireError } from "../../shared/effect/wire";
import { Acts, acting, internalAction, internalMutation, internalQuery, ownerMutation, reading, runAtEdge, writing } from "../platform/effect";
import {
  OuraForbidden,
  OuraInvalidResponse,
  OuraNotConfigured,
  OuraNotConnected,
  OuraRateLimited,
  OuraUnauthorised,
  OuraUnavailable,
  type OuraFailure,
} from "./errors";
import { healthDaysFrom, OuraPage } from "./model";
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
  const credentials: Result.Result<{ id: string; secret: Redacted.Redacted }, OuraNotConfigured> =
    id && secret ? Result.succeed({ id, secret: Redacted.make(secret) }) : Result.fail(new OuraNotConfigured());
  return credentials;
};

export const ouraConfigured = () => Result.isSuccess(clientCredentials());

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const randomBytes = (length: number) => crypto.getRandomValues(new Uint8Array(length));

const challengeFor = async (verifier: string) =>
  base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));

export type Tokens = { readonly accessToken: string; readonly refreshToken: string; readonly expiresAt: number; readonly scope: string };

type CollectionName = "sleep" | "daily_sleep" | "sleep_time";

const TokenBody = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.String,
  expires_in: Schema.Number,
  scope: Schema.optional(Schema.Unknown),
});

const decodeTokens = Schema.decodeUnknownEffect(TokenBody);
const decodePage = Schema.decodeUnknownEffect(OuraPage);

const failureOf = (status: number, retryAfter: string | undefined, tokenEndpoint: boolean) => {
  if (status === 401 || (tokenEndpoint && status === 400)) return new OuraUnauthorised();
  if (status === 403) return new OuraForbidden();
  if (status === 429) {
    const seconds = Number(retryAfter);
    return new OuraRateLimited(Number.isFinite(seconds) && seconds > 0 ? { retryAfterSeconds: seconds } : {});
  }
  return new OuraUnavailable({ status });
};

export class OuraToken extends Context.Service<OuraToken, Redacted.Redacted>()("lifeos/health/OuraToken") {}

export class Oura extends Context.Service<
  Oura,
  {
    exchange(grant: Readonly<Record<string, string>>): Effect.Effect<Tokens, OuraFailure>;
    collection(name: CollectionName, start: IsoDate, end: IsoDate): Effect.Effect<ReadonlyArray<unknown>, OuraFailure, OuraToken>;
  }
>()("lifeos/health/Oura") {
  static readonly layerNoDeps = Layer.effect(
    Oura,
    Effect.gen(function* () {
      const credentials = clientCredentials();
      const http = yield* HttpClient.HttpClient;

      const send = Effect.fn("Oura.send")(function* (request: HttpClientRequest.HttpClientRequest, tokenEndpoint: boolean) {
        const response = yield* http.execute(request).pipe(Effect.mapError(() => new OuraUnavailable({})));
        if (response.status < 200 || response.status >= 300) {
          return yield* failureOf(response.status, response.headers["retry-after"], tokenEndpoint);
        }
        return yield* response.json.pipe(Effect.mapError(() => new OuraInvalidResponse()));
      });

      const exchange = Effect.fn("Oura.exchange")(function* (grant: Readonly<Record<string, string>>) {
        const { id, secret } = yield* Effect.fromResult(credentials);
        const now = yield* Clock.currentTimeMillis;
        const request = HttpClientRequest.post(OURA_TOKEN_URL).pipe(
          HttpClientRequest.setHeader("user-agent", USER_AGENT),
          HttpClientRequest.bodyUrlParams({ ...grant, client_id: id, client_secret: secret }),
        );
        const body = yield* send(request, true);
        const decoded = yield* decodeTokens(body).pipe(Effect.mapError(() => new OuraInvalidResponse()));
        return {
          accessToken: decoded.access_token,
          refreshToken: decoded.refresh_token,
          expiresAt: now + decoded.expires_in * 1000,
          scope: Predicate.isString(decoded.scope) ? decoded.scope : OURA_SCOPES,
        } satisfies Tokens;
      });

      const collection = Effect.fn("Oura.collection")(function* (name: CollectionName, start: IsoDate, end: IsoDate) {
        const token = yield* OuraToken;
        const collected: unknown[] = [];
        let next: string | undefined;
        for (let pages = 0; pages < MAX_PAGES; pages += 1) {
          const request = HttpClientRequest.get(`${OURA_API}/${name}`).pipe(
            HttpClientRequest.setUrlParams({ start_date: start, end_date: end, ...(next ? { next_token: next } : {}) }),
            HttpClientRequest.setHeader("user-agent", USER_AGENT),
            HttpClientRequest.bearerToken(Redacted.value(token)),
          );
          const body = yield* send(request, false);
          const page = yield* decodePage(body).pipe(Effect.mapError(() => new OuraInvalidResponse()));
          collected.push(...page.data);
          next = page.next_token;
          if (!next) break;
        }
        return collected;
      });

      return Oura.of({ exchange, collection });
    }),
  );

  static readonly layer = Oura.layerNoDeps.pipe(Layer.provide(FetchHttpClient.layer));

  static readonly layerTest = (canned: {
    tokens?: Tokens;
    collections?: Partial<Record<CollectionName, ReadonlyArray<unknown>>>;
    failure?: OuraFailure;
  }) =>
    Layer.succeed(
      Oura,
      Oura.of({
        exchange: () =>
          canned.failure
            ? Effect.fail(canned.failure)
            : Effect.succeed(canned.tokens ?? { accessToken: "test-access", refreshToken: "test-refresh", expiresAt: 0, scope: OURA_SCOPES }),
        collection: (name) => (canned.failure ? Effect.fail(canned.failure) : Effect.succeed(canned.collections?.[name] ?? [])),
      }),
    );
}

const storedConnection = () =>
  acting((ctx) => {
    const row: Promise<Doc<"ouraConnection"> | null> = ctx.runQuery(internal.health.oura.connection, {});
    return row;
  });

const scheduleSync = () =>
  acting((ctx) => {
    const scheduled: Promise<unknown> = ctx.scheduler.runAfter(0, internal.health.oura.sync, {});
    return scheduled;
  });

const queueSync = () =>
  writing((ctx) => {
    const scheduled: Promise<unknown> = ctx.scheduler.runAfter(0, internal.health.oura.sync, {});
    return scheduled;
  });

const takeStateFor = (state: string) =>
  acting((ctx) => {
    const verifier: Promise<string | null> = ctx.runMutation(internal.health.oura.takeState, { state });
    return verifier;
  });

const saveTokens = (tokens: Tokens) =>
  acting((ctx) => {
    const saved: Promise<null> = ctx.runMutation(internal.health.oura.saveConnection, tokens);
    return saved;
  });

const storeSync = (at: number, days: HealthDay[]) =>
  acting((ctx) => {
    const stored: Promise<null> = ctx.runMutation(internal.health.oura.recordSync, { at, days });
    return stored;
  });

const storeFailure = (at: number, error: OuraError) =>
  acting((ctx) => {
    const stored: Promise<null> = ctx.runMutation(internal.health.oura.recordFailure, { at, error });
    return stored;
  });

const storeRotation = (tokens: Tokens, previousRefreshToken: string) =>
  acting((ctx) => {
    const rotated: Promise<string | null> = ctx.runMutation(internal.health.oura.rotateTokens, { ...tokens, previousRefreshToken });
    return rotated;
  });

export const connect = ownerMutation({
  args: {},
  handler: Effect.fn("oura.connect")(function* () {
    const credentials = yield* Effect.fromResult(clientCredentials());
    const now = yield* Clock.currentTimeMillis;
    const stale = yield* reading((ctx) => ctx.db.query("ouraAuthStates").take(20));
    for (const row of stale) {
      if (row.expiresAt < now) yield* writing((ctx) => ctx.db.delete("ouraAuthStates", row._id));
    }
    const state = base64Url(randomBytes(24));
    const verifier = base64Url(randomBytes(48));
    yield* writing((ctx) => ctx.db.insert("ouraAuthStates", { state, verifier, expiresAt: now + STATE_TTL_MS }));
    const challenge = yield* Effect.promise(() => challengeFor(verifier));
    const url = new URL(OURA_AUTHORIZE_URL);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: credentials.id,
      redirect_uri: redirectUri(),
      scope: OURA_SCOPES,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    return { url: url.toString() };
  }, asWire),
});

export const syncNow = ownerMutation({
  args: {},
  handler: Effect.fn("oura.syncNow")(function* () {
    const connection = yield* reading((ctx) => ctx.db.query("ouraConnection").first());
    if (!connection) return yield* new OuraNotConnected();
    yield* queueSync();
    return { queued: true as const };
  }, asWire),
});

export const takeState = internalMutation({
  args: { state: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: Effect.fn("oura.takeState")(function* ({ state }) {
    const row = yield* reading((ctx) =>
      ctx.db
        .query("ouraAuthStates")
        .withIndex("by_state", (q) => q.eq("state", state))
        .unique(),
    );
    if (!row) return null;
    yield* writing((ctx) => ctx.db.delete("ouraAuthStates", row._id));
    const now = yield* Clock.currentTimeMillis;
    return row.expiresAt >= now ? row.verifier : null;
  }),
});

export const connection = internalQuery({
  args: {},
  handler: () => reading((ctx) => ctx.db.query("ouraConnection").first()),
});

const vTokens = { accessToken: v.string(), refreshToken: v.string(), expiresAt: v.number(), scope: v.string() };

export const saveConnection = internalMutation({
  args: vTokens,
  returns: v.null(),
  handler: Effect.fn("oura.saveConnection")(function* (tokens) {
    const rows = yield* reading((ctx) => ctx.db.query("ouraConnection").take(5));
    for (const row of rows) yield* writing((ctx) => ctx.db.delete("ouraConnection", row._id));
    const connectedAt = yield* Clock.currentTimeMillis;
    yield* writing((ctx) => ctx.db.insert("ouraConnection", { ...tokens, connectedAt, sync: { kind: "never" } }));
    return null;
  }),
});

export const rotateTokens = internalMutation({
  args: { ...vTokens, previousRefreshToken: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: Effect.fn("oura.rotateTokens")(function* ({ previousRefreshToken, ...tokens }) {
    const row = yield* reading((ctx) => ctx.db.query("ouraConnection").first());
    if (!row) return null;
    if (row.refreshToken !== previousRefreshToken) return row.accessToken;
    yield* writing((ctx) => ctx.db.patch("ouraConnection", row._id, tokens));
    return tokens.accessToken;
  }),
});

export const recordSync = internalMutation({
  args: { at: v.number(), days: v.array(vHealthDay) },
  returns: v.null(),
  handler: Effect.fn("oura.recordSync")(function* ({ at, days }) {
    const row = yield* reading((ctx) => ctx.db.query("ouraConnection").first());
    if (!row) return null;
    for (const day of days) {
      const existing = yield* reading((ctx) =>
        ctx.db
          .query("healthDays")
          .withIndex("by_source_and_day", (q) => q.eq("source", "oura").eq("day", day.day))
          .unique(),
      );
      const fields = { source: "oura" as const, ...day, syncedAt: at };
      if (existing) yield* writing((ctx) => ctx.db.replace("healthDays", existing._id, fields));
      else yield* writing((ctx) => ctx.db.insert("healthDays", fields));
    }
    yield* writing((ctx) => ctx.db.patch("ouraConnection", row._id, { sync: { kind: "ok", at } }));
    return null;
  }),
});

export const recordFailure = internalMutation({
  args: { at: v.number(), error: vOuraError },
  returns: v.null(),
  handler: Effect.fn("oura.recordFailure")(function* ({ at, error }) {
    const row = yield* reading((ctx) => ctx.db.query("ouraConnection").first());
    if (!row) return null;
    const lastOkAt = row.sync.kind === "ok" ? row.sync.at : row.sync.kind === "failed" ? row.sync.lastOkAt : undefined;
    yield* writing((ctx) =>
      ctx.db.patch("ouraConnection", row._id, {
        sync: { kind: "failed", at, error, ...(lastOkAt === undefined ? {} : { lastOkAt }) },
      }),
    );
    return null;
  }),
});

const latestAccessToken = Effect.fn("oura.latestAccessToken")(function* (current: Doc<"ouraConnection">) {
  const latest = yield* storedConnection();
  return latest && latest.refreshToken !== current.refreshToken ? latest.accessToken : null;
});

const freshAccessToken = Effect.fn("oura.freshAccessToken")(function* (current: Doc<"ouraConnection">, now: number) {
  if (current.expiresAt - now > REFRESH_MARGIN_MS) return current.accessToken;
  const oura = yield* Oura;
  const rotated = yield* oura.exchange({ grant_type: "refresh_token", refresh_token: current.refreshToken }).pipe(
    Effect.flatMap((tokens) => storeRotation(tokens, current.refreshToken)),
    Effect.catchTag("OuraUnauthorised", () => latestAccessToken(current)),
  );
  if (!rotated) return yield* new OuraUnauthorised();
  return rotated;
});

const fetchDays = Effect.fn("oura.fetchDays")(function* (today: IsoDate) {
  const oura = yield* Oura;
  const start = addDays(today, -SYNC_DAYS_BACK);
  const end = addDays(today, 1);
  const sleep = yield* oura.collection("sleep", start, end);
  const dailySleep = yield* oura.collection("daily_sleep", start, end);
  const sleepTime = yield* oura.collection("sleep_time", start, end);
  return healthDaysFrom({ sleep, dailySleep, sleepTime });
});

const daysFor = Effect.fn("oura.daysFor")(function* (current: Doc<"ouraConnection">, now: number) {
  const today = new Date(now).toISOString().slice(0, 10) as IsoDate;
  const token = yield* freshAccessToken(current, now);
  return yield* fetchDays(today).pipe(Effect.provideService(OuraToken, Redacted.make(token)));
});

export const sync = internalAction({
  args: {},
  returns: v.null(),
  handler: Effect.fn("oura.sync")(function* () {
    const now = yield* Clock.currentTimeMillis;
    const current = yield* storedConnection();
    if (!current) return null;
    const outcome = yield* Effect.result(daysFor(current, now));
    if (Result.isSuccess(outcome)) yield* storeSync(now, outcome.success);
    else yield* storeFailure(now, wireError(outcome.failure));
    return null;
  }, Effect.provide(Oura.layer)),
});

const page = (status: number, heading: string, body: string) =>
  new Response(
    `<!doctype html><html lang="en-AU"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${heading}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;background:light-dark(#f6f5f2,#141416);color:light-dark(#1c1c1e,#ececee)}main{max-width:22rem;padding:2rem}h1{font-size:1.25rem;margin:0 0 .5rem}p{margin:0;opacity:.7}</style><main><h1>${heading}</h1><p>${body}</p></main></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } },
  );

const finishing = Effect.fn("oura.finishConnect")(function* (request: Request) {
  const params = new URL(request.url).searchParams;
  const state = params.get("state");
  const verifier = state ? yield* takeStateFor(state) : null;
  if (!verifier) return page(400, "This link has expired", "Start again from Connect Oura in LifeOS.");
  const code = params.get("code");
  if (!code) return page(400, "Oura was not connected", "Oura did not share your sleep. Start again from LifeOS if you change your mind.");
  const oura = yield* Oura;
  const tokens = yield* Effect.result(
    oura.exchange({ grant_type: "authorization_code", code, redirect_uri: redirectUri(), code_verifier: verifier }),
  );
  if (Result.isFailure(tokens)) return page(502, "Oura did not connect", "Oura refused the sign-in. Try Connect Oura again in a minute.");
  yield* saveTokens(tokens.success);
  yield* scheduleSync();
  return page(200, "Oura is connected", "LifeOS is pulling your sleep now. You can close this tab.");
});

export const finishConnect = (ctx: ActionCtx, request: Request) =>
  runAtEdge(finishing(request).pipe(Effect.provide(Oura.layer), Effect.provideService(Acts, ctx)));
