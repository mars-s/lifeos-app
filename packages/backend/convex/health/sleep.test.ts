import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { ConvexError } from "convex/values";
import { api, internal } from "../_generated/api";
import { newBackend, newSignedOutBackend, unwrap, type Backend } from "../backend.test-utils";
import { healthDaysFrom, usualSleep } from "./model";
import { OURA_API, OURA_TOKEN_URL } from "./oura";

const SYDNEY = "Australia/Sydney";
const TODAY = "2026-11-19";

const night = (day: string, bed: string, wake: string, extra: Record<string, unknown> = {}) => ({
  id: `sleep-${day}-${bed}`,
  day,
  type: "long_sleep",
  bedtime_start: bed,
  bedtime_end: wake,
  time_in_bed: (Date.parse(wake) - Date.parse(bed)) / 1000,
  total_sleep_duration: (Date.parse(wake) - Date.parse(bed)) / 1000 - 1800,
  readiness: { score: 81 },
  ...extra,
});

const pad = (n: number) => String(n).padStart(2, "0");

const fortnight = (count: number, last: number = 18) =>
  Array.from({ length: count }, (_, index) => {
    const wakeDay = last - index;
    return night(`2026-11-${pad(wakeDay)}`, `2026-11-${pad(wakeDay - 1)}T23:${pad(index % 2 ? 0 : 10)}:00+11:00`, `2026-11-${pad(wakeDay)}T06:${pad(40 + (index % 3) * 5)}:00+11:00`);
  });

type Collections = { sleep: unknown[]; daily_sleep: unknown[]; sleep_time: unknown[] };
type Seen = { url: URL; body: URLSearchParams | null; authorization: string | null };

const oura = setupServer();

const seen = async (request: Request) => ({
  url: new URL(request.url),
  body: request.method === "POST" ? new URLSearchParams(await request.text()) : null,
  authorization: request.headers.get("authorization"),
});

const ouraWith = (collections: Partial<Collections>, status: Partial<Record<keyof Collections | "token", number>> = {}) => {
  const calls: Seen[] = [];
  oura.resetHandlers(
    http.post(OURA_TOKEN_URL, async ({ request }) => {
      calls.push(await seen(request));
      return status.token
        ? new HttpResponse("{}", { status: status.token })
        : HttpResponse.json({ access_token: "fresh-access", refresh_token: "fresh-refresh", expires_in: 86_400, scope: "extapi:daily" });
    }),
    http.get(`${OURA_API}/:name`, async ({ request, params }) => {
      calls.push(await seen(request));
      const name = params.name as keyof Collections;
      return status[name] ? new HttpResponse("{}", { status: status[name] }) : HttpResponse.json({ data: collections[name] ?? [], next_token: null });
    }),
  );
  return calls;
};

const connect = (t: Backend, expiresAt = Date.now() + 86_400_000) =>
  t.mutation(internal.health.oura.saveConnection, { accessToken: "access", refreshToken: "refresh", expiresAt, scope: "daily" });

const nightsFor = async (t: Backend, from: string, days: number) =>
  unwrap(await t.query(api.health.sleep.nights, { from, days, today: TODAY, timeZone: SYDNEY }));

const sydney = (iso: string) => Date.parse(`${iso}+11:00`);

beforeAll(() => oura.listen({ onUnhandledRequest: "error" }));
afterAll(() => oura.close());

beforeEach(() => {
  vi.stubEnv("OURA_CLIENT_ID", "lifeos-client");
  vi.stubEnv("OURA_CLIENT_SECRET", "lifeos-secret");
});

afterEach(() => {
  oura.resetHandlers();
  vi.unstubAllEnvs();
});

describe("reading Oura's collections", () => {
  test("keeps the longest long_sleep of each day, ignores naps, and joins scores and the bedtime window", () => {
    const days = healthDaysFrom({
      sleep: [
        night("2026-11-18", "2026-11-17T23:05:00+11:00", "2026-11-18T06:50:00+11:00"),
        night("2026-11-18", "2026-11-18T03:00:00+11:00", "2026-11-18T04:00:00+11:00"),
        { ...night("2026-11-18", "2026-11-18T14:00:00+11:00", "2026-11-18T14:40:00+11:00"), type: "sleep" },
        { day: "2026-11-17", type: "long_sleep" },
      ],
      dailySleep: [{ id: "d", day: "2026-11-18", score: 84 }],
      sleepTime: [
        {
          id: "t",
          day: "2026-11-18",
          optimal_bedtime: { day_tz: 39_600, start_offset: -4500, end_offset: -900 },
          recommendation: "follow_optimal_bedtime",
          status: "optimal_found",
        },
      ],
    });
    expect(days).toEqual([
      {
        day: "2026-11-18",
        sleep: { start: sydney("2026-11-17T23:05:00"), end: sydney("2026-11-18T06:50:00"), offsetMinutes: 660, asleepMinutes: 435 },
        readinessScore: 81,
        sleepScore: 84,
        sleepTime: {
          status: "optimal_found",
          recommendation: "follow_optimal_bedtime",
          window: { startOffset: -4500, endOffset: -900, dayTz: 39_600 },
        },
      },
    ]);
  });

  test("the usual night is the median of the last 14, and needs at least 3 nights", () => {
    const periods = healthDaysFrom({ sleep: fortnight(16), dailySleep: [], sleepTime: [] })
      .toReversed()
      .flatMap((day) => (day.sleep ? [day.sleep] : []));
    expect(usualSleep(periods)).toEqual({ bedMinute: -55, wakeMinute: 405, nights: 14 });
    expect(usualSleep(periods.slice(0, 2))).toBeNull();
  });
});

describe("the Sleep Window on the Timebox", () => {
  test("past nights show what Avi slept, tonight and later use Oura's bedtime and his usual wake", async () => {
    const t = await newBackend();
    await connect(t);
    ouraWith({
      sleep: fortnight(14),
      daily_sleep: [{ id: "d", day: "2026-11-18", score: 77 }],
      sleep_time: [{ id: "t", day: "2026-11-19", optimal_bedtime: { day_tz: 39_600, start_offset: -5400, end_offset: -1800 }, status: "optimal_found" }],
    });
    await t.action(internal.health.oura.sync, {});

    const nights = await nightsFor(t, "2026-11-18", 3);
    expect(nights.map(({ kind, wakeDate }) => [kind, wakeDate])).toEqual([
      ["slept", "2026-11-18"],
      ["planned", "2026-11-19"],
      ["planned", "2026-11-20"],
      ["planned", "2026-11-21"],
    ]);
    expect(nights[0]).toMatchObject({ start: sydney("2026-11-17T23:10:00"), end: sydney("2026-11-18T06:40:00"), sleepScore: 77, readinessScore: 81 });
    expect(nights[2]).toEqual({
      kind: "planned",
      wakeDate: "2026-11-20",
      start: sydney("2026-11-19T22:30:00"),
      end: sydney("2026-11-20T06:45:00"),
      bedtime: "oura",
      latestBedtime: sydney("2026-11-19T23:30:00"),
    });
  });

  test("a past night without a record shows nothing", async () => {
    const t = await newBackend();
    await connect(t);
    ouraWith({ sleep: fortnight(5, 14) });
    await t.action(internal.health.oura.sync, {});
    const nights = await nightsFor(t, "2026-11-15", 2);
    expect(nights).toEqual([]);
  });

  test("when Oura has not found a bedtime yet, his usual bedtime stands in", async () => {
    const t = await newBackend();
    await connect(t);
    ouraWith({ sleep: fortnight(4), sleep_time: [{ id: "t", day: "2026-11-19", status: "not_enough_nights" }] });
    await t.action(internal.health.oura.sync, {});
    const [tonight] = await nightsFor(t, "2026-11-20", 1);
    expect(tonight).toMatchObject({ kind: "planned", bedtime: "usual", start: sydney("2026-11-19T23:05:00"), latestBedtime: null });
    const status = await t.query(api.health.sleep.status, { today: TODAY });
    expect(status).toMatchObject({ setup: "connected", ouraStatus: "not_enough_nights", nightsCounted: 4 });
  });

  test("with fewer than 3 nights there is nothing to plan, and the status says so", async () => {
    const t = await newBackend();
    await connect(t);
    ouraWith({ sleep: fortnight(2), sleep_time: [{ id: "t", day: "2026-11-19", status: "not_enough_nights" }] });
    await t.action(internal.health.oura.sync, {});
    expect(await nightsFor(t, "2026-11-20", 2)).toEqual([]);
    expect(await t.query(api.health.sleep.status, { today: TODAY })).toMatchObject({ plan: null, ouraStatus: "not_enough_nights", nightsCounted: 2 });
  });

  test("a bad range is an error, not a throw", async () => {
    const t = await newBackend();
    expect(await t.query(api.health.sleep.nights, { from: "2026-13-01", days: 7, today: TODAY, timeZone: SYDNEY })).toEqual({
      ok: false,
      error: { kind: "invalid_range" },
    });
  });
});

describe("syncing with Oura", () => {
  test("asks for the last fortnight of sleep, daily sleep and sleep time with the stored token", async () => {
    const t = await newBackend();
    await connect(t);
    const calls = ouraWith({});
    await t.action(internal.health.oura.sync, {});
    expect(calls.map(({ url }) => url.pathname)).toEqual([
      "/v2/usercollection/sleep",
      "/v2/usercollection/daily_sleep",
      "/v2/usercollection/sleep_time",
    ]);
    expect(calls.every(({ authorization }) => authorization === "Bearer access")).toBe(true);
    expect((await t.query(api.health.sleep.status, { today: TODAY })).sync).toMatchObject({ kind: "ok" });
  });

  test("an expiring token is refreshed once and the new pair is stored", async () => {
    const t = await newBackend();
    await connect(t, Date.now() + 60_000);
    const calls = ouraWith({});
    await t.action(internal.health.oura.sync, {});
    const [refresh, ...reads] = calls;
    expect(refresh?.body?.get("grant_type")).toBe("refresh_token");
    expect(refresh?.body?.get("refresh_token")).toBe("refresh");
    expect(reads.every(({ authorization }) => authorization === "Bearer fresh-access")).toBe(true);
    const stored = await t.query(internal.health.oura.connection, {});
    expect(stored).toMatchObject({ accessToken: "fresh-access", refreshToken: "fresh-refresh" });
  });

  test("a revoked token or Oura being down is recorded as a failed sync, keeping what was there", async () => {
    const t = await newBackend();
    await connect(t);
    ouraWith({ sleep: fortnight(3) });
    await t.action(internal.health.oura.sync, {});
    ouraWith({}, { sleep: 401 });
    await t.action(internal.health.oura.sync, {});
    expect((await t.query(api.health.sleep.status, { today: TODAY })).sync).toMatchObject({ kind: "failed", error: { kind: "unauthorised" } });
    ouraWith({}, { sleep_time: 503 });
    await t.action(internal.health.oura.sync, {});
    const status = await t.query(api.health.sleep.status, { today: TODAY });
    expect(status.sync).toMatchObject({ kind: "failed", error: { kind: "unavailable", status: 503 } });
    expect(status.sync?.kind === "failed" && status.sync.lastOkAt).toBeTypeOf("number");
    expect(await nightsFor(t, "2026-11-18", 1)).toHaveLength(2);
  });

  test("without a connection the cron does nothing and Sync now says not connected", async () => {
    const t = await newBackend();
    const calls = ouraWith({});
    await t.action(internal.health.oura.sync, {});
    expect(calls).toEqual([]);
    expect(await t.mutation(api.health.oura.syncNow, {})).toEqual({ ok: false, error: { kind: "not_connected" } });
  });
});

const begin = async (t: Backend) => new URL(unwrap(await t.mutation(api.health.oura.connect, {})).url);

describe("connecting Oura", () => {
  test("without the Oura app's id and secret, Connect says it is not set up", async () => {
    vi.stubEnv("OURA_CLIENT_ID", "");
    const t = await newBackend();
    expect(await t.mutation(api.health.oura.connect, {})).toEqual({ ok: false, error: { kind: "not_configured" } });
    expect((await t.query(api.health.sleep.status, { today: TODAY })).setup).toBe("not_configured");
  });

  test("Connect sends Avi to Oura with the daily scope, a one-use state and PKCE", async () => {
    const t = await newBackend();
    const url = await begin(t);
    expect(url.origin + url.pathname).toBe("https://cloud.ouraring.com/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: "code",
      client_id: "lifeos-client",
      redirect_uri: "https://lifeos-test.convex.site/oura/callback",
      scope: "daily",
      code_challenge_method: "S256",
    });
    expect(url.searchParams.get("state")).toMatch(/^[\w-]{32}$/);
    expect(url.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
  });

  test("the callback trades the code with the PKCE verifier, stores the tokens and never shows them", async () => {
    const t = await newBackend();
    const state = (await begin(t)).searchParams.get("state");
    const calls = ouraWith({});
    const response = await t.fetch(`/oura/callback?code=one-time&state=${state}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Oura is connected");
    const exchange = calls[0]?.body;
    expect(exchange?.get("grant_type")).toBe("authorization_code");
    expect(exchange?.get("code")).toBe("one-time");
    expect(exchange?.get("code_verifier")).toMatch(/^[\w-]{64}$/);
    expect(exchange?.get("redirect_uri")).toBe("https://lifeos-test.convex.site/oura/callback");
    const status = await t.query(api.health.sleep.status, { today: TODAY });
    expect(status.setup).toBe("connected");
    expect(JSON.stringify(status)).not.toContain("fresh-");

    const replay = await t.fetch(`/oura/callback?code=one-time&state=${state}`);
    expect(replay.status).toBe(400);
  });

  test("a forged state or a refused consent does not connect", async () => {
    const t = await newBackend();
    const calls = ouraWith({});
    expect((await t.fetch("/oura/callback?code=x&state=forged")).status).toBe(400);
    const state = (await begin(t)).searchParams.get("state");
    expect((await t.fetch(`/oura/callback?error=access_denied&state=${state}`)).status).toBe(400);
    expect(calls).toEqual([]);
    expect((await t.query(api.health.sleep.status, { today: TODAY })).setup).toBe("not_connected");
  });

  test("Oura refusing the code leaves Oura disconnected", async () => {
    const t = await newBackend();
    const state = (await begin(t)).searchParams.get("state");
    ouraWith({}, { token: 400 });
    expect((await t.fetch(`/oura/callback?code=stale&state=${state}`)).status).toBe(502);
    expect((await t.query(api.health.sleep.status, { today: TODAY })).setup).toBe("not_connected");
  });
});

const refused = async (call: Promise<unknown>) => {
  const error = await call.then(
    () => null,
    (thrown: unknown) => thrown,
  );
  return error instanceof ConvexError ? (error.data as { kind: string }).kind : error;
};

test("signed out, sleep, status, Connect and Sync now are refused", async () => {
  const t = newSignedOutBackend();
  expect(await refused(t.query(api.health.sleep.nights, { from: TODAY, days: 1, today: TODAY, timeZone: SYDNEY }))).toBe("signed_out");
  expect(await refused(t.query(api.health.sleep.status, { today: TODAY }))).toBe("signed_out");
  expect(await refused(t.mutation(api.health.oura.connect, {}))).toBe("signed_out");
  expect(await refused(t.mutation(api.health.oura.syncNow, {}))).toBe("signed_out");
});

