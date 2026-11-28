import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { IsoDate } from "../../shared/date";
import { newBackend, type Backend } from "../backend.test-utils";
import { OURA_API, OURA_TOKEN_URL } from "./oura";
import { seedSleep } from "./sleepSeed.test-utils";

const SYDNEY = "Australia/Sydney";
const TODAY = "2026-11-19";

const oura = setupServer();

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

const night = (day: string, bed: string, wake: string) => ({
  id: `sleep-${day}`,
  day,
  type: "long_sleep",
  bedtime_start: bed,
  bedtime_end: wake,
  time_in_bed: (Date.parse(wake) - Date.parse(bed)) / 1000,
  total_sleep_duration: (Date.parse(wake) - Date.parse(bed)) / 1000 - 1800,
  readiness: { score: 81 },
});

const connect = (t: Backend, expiresAt = Date.now() + 86_400_000) =>
  t.mutation(internal.health.oura.saveConnection, { accessToken: "access", refreshToken: "refresh", expiresAt, scope: "daily" });

type Answer = () => Response;

const ouraAnswers = (answers: { sleep?: Answer; daily_sleep?: Answer; sleep_time?: Answer; token?: Answer }) =>
  oura.resetHandlers(
    http.post(OURA_TOKEN_URL, () =>
      answers.token
        ? answers.token()
        : HttpResponse.json({ access_token: "fresh-access", refresh_token: "fresh-refresh", expires_in: 86_400, scope: "extapi:daily" }),
    ),
    http.get(`${OURA_API}/:name`, ({ params }) => {
      const name = params.name as "sleep" | "daily_sleep" | "sleep_time";
      return answers[name] ? answers[name]() : HttpResponse.json({ data: [], next_token: null });
    }),
  );

const status = (code: number, headers: Record<string, string> = {}) => () => new HttpResponse("{}", { status: code, headers });

const syncOutcome = async (t: Backend) => (await t.query(api.health.sleep.status, { today: TODAY })).sync;

describe("sleep on the wire", () => {
  test("nights answers with slept and planned nights, and refuses a bad date, count, time zone or today", async () => {
    const t = await newBackend();
    expect(await t.query(api.health.sleep.nights, { from: "2026-11-18", days: 1, today: TODAY, timeZone: SYDNEY })).toStrictEqual({
      ok: true,
      value: [],
    });
    await connect(t);
    ouraAnswers({
      sleep: () =>
        HttpResponse.json({
          data: Array.from({ length: 4 }, (_, index) =>
            night(`2026-11-${18 - index}`, `2026-11-${17 - index}T23:10:00+11:00`, `2026-11-${18 - index}T06:40:00+11:00`),
          ),
          next_token: null,
        }),
      daily_sleep: () => HttpResponse.json({ data: [{ day: "2026-11-18", score: 84 }], next_token: null }),
    });
    await t.action(internal.health.oura.sync, {});
    expect(await t.query(api.health.sleep.nights, { from: "2026-11-18", days: 2, today: TODAY, timeZone: SYDNEY })).toStrictEqual({
      ok: true,
      value: [
        {
          kind: "slept",
          wakeDate: "2026-11-18",
          start: Date.parse("2026-11-17T23:10:00+11:00"),
          end: Date.parse("2026-11-18T06:40:00+11:00"),
          asleepMinutes: 420,
          sleepScore: 84,
          readinessScore: 81,
        },
        {
          kind: "planned",
          wakeDate: "2026-11-19",
          start: Date.parse("2026-11-18T23:10:00+11:00"),
          end: Date.parse("2026-11-19T06:40:00+11:00"),
          bedtime: "usual",
          latestBedtime: null,
        },
        {
          kind: "planned",
          wakeDate: "2026-11-20",
          start: Date.parse("2026-11-19T23:10:00+11:00"),
          end: Date.parse("2026-11-20T06:40:00+11:00"),
          bedtime: "usual",
          latestBedtime: null,
        },
      ],
    });
    const invalid = { ok: false, error: { kind: "invalid_range" } };
    const base = { from: "2026-11-18", days: 1, today: TODAY, timeZone: SYDNEY };
    expect(await t.query(api.health.sleep.nights, { ...base, from: "nope" })).toStrictEqual(invalid);
    expect(await t.query(api.health.sleep.nights, { ...base, days: 0 })).toStrictEqual(invalid);
    expect(await t.query(api.health.sleep.nights, { ...base, days: 63 })).toStrictEqual(invalid);
    expect(await t.query(api.health.sleep.nights, { ...base, today: "nope" })).toStrictEqual(invalid);
    expect(await t.query(api.health.sleep.nights, { ...base, timeZone: "Mars/Olympus" })).toStrictEqual(invalid);
  });

  test("status answers with the setup, the sync outcome and the plan", async () => {
    const t = await newBackend();
    const empty = { sync: null, plan: null, ouraStatus: null, recommendation: null, nightsCounted: 0 };
    expect(await t.query(api.health.sleep.status, { today: TODAY })).toStrictEqual({ setup: "not_connected", ...empty });
    vi.stubEnv("OURA_CLIENT_ID", "");
    expect(await t.query(api.health.sleep.status, { today: TODAY })).toStrictEqual({ setup: "not_configured", ...empty });
    vi.stubEnv("OURA_CLIENT_ID", "lifeos-client");
    await connect(t);
    expect(await t.query(api.health.sleep.status, { today: TODAY })).toStrictEqual({
      setup: "connected",
      ...empty,
      sync: { kind: "never" },
    });
  });
});

describe("energy on the wire", () => {
  test("days answers with none, learning and solid days, and refuses a backwards or too long range", async () => {
    const t = await newBackend();
    expect(await t.query(api.health.energy.days, { from: TODAY, to: TODAY, today: TODAY, timeZone: SYDNEY })).toStrictEqual({
      ok: true,
      value: [{ date: TODAY, kind: "none" }],
    });
    await t.run((ctx) => seedSleep(ctx, TODAY as IsoDate, SYDNEY));
    const solid = await t.query(api.health.energy.days, { from: TODAY, to: TODAY, today: TODAY, timeZone: SYDNEY });
    expect(solid).toStrictEqual({
      ok: true,
      value: [
        {
          date: TODAY,
          kind: "solid",
          points: expect.any(Array),
          wake: expect.any(Number),
          bedtime: expect.any(Number),
          bedtimeFrom: "oura",
          peak: { start: expect.any(Number), end: expect.any(Number) },
          dip: { start: expect.any(Number), end: expect.any(Number) },
          low: expect.any(Boolean),
          reading: { asleepMinutes: expect.any(Number), readiness: expect.any(Number), debtMinutes: expect.any(Number), nights: 10, syncedAt: expect.any(Number) },
        },
      ],
    });
    const invalid = { ok: false, error: { kind: "invalid_range" } };
    expect(await t.query(api.health.energy.days, { from: "2026-11-20", to: "2026-11-19", today: TODAY, timeZone: SYDNEY })).toStrictEqual(invalid);
    expect(await t.query(api.health.energy.days, { from: "2026-11-01", to: "2027-02-01", today: TODAY, timeZone: SYDNEY })).toStrictEqual(invalid);
    expect(await t.query(api.health.energy.days, { from: "nope", to: TODAY, today: TODAY, timeZone: SYDNEY })).toStrictEqual(invalid);
    expect(await t.query(api.health.energy.days, { from: TODAY, to: TODAY, today: TODAY, timeZone: "Mars/Olympus" })).toStrictEqual(invalid);
  });

  test("a connection that has never synced is still learning", async () => {
    const t = await newBackend();
    await connect(t);
    expect(await t.query(api.health.energy.days, { from: TODAY, to: TODAY, today: TODAY, timeZone: SYDNEY })).toStrictEqual({
      ok: true,
      value: [{ date: TODAY, kind: "learning", reading: { nights: 0 } }],
    });
  });
});

describe("connecting Oura on the wire", () => {
  test("connect answers with the sign-in URL, or says Oura is not set up", async () => {
    const t = await newBackend();
    expect(await t.mutation(api.health.oura.connect, {})).toStrictEqual({
      ok: true,
      value: { url: expect.stringMatching(/^https:\/\/cloud\.ouraring\.com\/oauth\/authorize\?response_type=code&client_id=lifeos-client&/) },
    });
    vi.stubEnv("OURA_CLIENT_SECRET", "");
    expect(await t.mutation(api.health.oura.connect, {})).toStrictEqual({ ok: false, error: { kind: "not_configured" } });
  });

  test("syncNow says not connected, then queues a sync", async () => {
    vi.useFakeTimers();
    try {
      const t = await newBackend();
      expect(await t.mutation(api.health.oura.syncNow, {})).toStrictEqual({ ok: false, error: { kind: "not_connected" } });
      await connect(t);
      expect(await t.mutation(api.health.oura.syncNow, {})).toStrictEqual({ ok: true, value: { queued: true } });
    } finally {
      vi.useRealTimers();
    }
  });

  test("the stored token pair rotates once, and a second run gets the access token already stored", async () => {
    const t = await newBackend();
    expect(
      await t.mutation(internal.health.oura.rotateTokens, {
        accessToken: "a1",
        refreshToken: "r1",
        expiresAt: 5,
        scope: "daily",
        previousRefreshToken: "refresh",
      }),
    ).toBeNull();
    await connect(t);
    const rotate = (previousRefreshToken: string, accessToken: string, refreshToken: string) =>
      t.mutation(internal.health.oura.rotateTokens, { accessToken, refreshToken, expiresAt: 5, scope: "daily", previousRefreshToken });
    expect(await rotate("refresh", "a1", "r1")).toBe("a1");
    expect(await rotate("refresh", "a2", "r2")).toBe("a1");
    expect(await t.query(internal.health.oura.connection, {})).toMatchObject({ accessToken: "a1", refreshToken: "r1" });
  });
});

const failed = (error: object) => ({ kind: "failed", at: expect.any(Number), error });

describe("a failed sync is stored as the error the apps read", () => {
  test.each([
    ["a revoked token", { sleep: status(401) }, { kind: "unauthorised" }],
    ["a forbidden scope", { daily_sleep: status(403) }, { kind: "forbidden" }],
    ["a rate limit with a wait", { sleep_time: status(429, { "retry-after": "30" }) }, { kind: "rate_limited", retryAfterSeconds: 30 }],
    ["a rate limit without a wait", { sleep: status(429) }, { kind: "rate_limited" }],
    ["a server error", { sleep: status(503) }, { kind: "unavailable", status: 503 }],
    ["a dropped connection", { sleep: () => HttpResponse.error() }, { kind: "unavailable" }],
    ["a body that is not JSON", { sleep: () => new HttpResponse("<html>", { headers: { "content-type": "application/json" } }) }, { kind: "invalid_response" }],
    ["a collection without data", { daily_sleep: () => HttpResponse.json({ items: [] }) }, { kind: "invalid_response" }],
    ["the first of two failures", { sleep: status(401), sleep_time: status(503) }, { kind: "unauthorised" }],
  ])("%s", async (_, answers, error) => {
    const t = await newBackend();
    await connect(t);
    ouraAnswers(answers);
    await t.action(internal.health.oura.sync, {});
    expect(await syncOutcome(t)).toStrictEqual(failed(error));
  });

  test("a refresh Oura refuses, a refresh with the app unset and a refresh that answers nonsense", async () => {
    const t = await newBackend();
    await connect(t, Date.now() + 60_000);
    ouraAnswers({ token: status(400) });
    await t.action(internal.health.oura.sync, {});
    expect(await syncOutcome(t)).toStrictEqual(failed({ kind: "unauthorised" }));

    ouraAnswers({ token: status(500) });
    await t.action(internal.health.oura.sync, {});
    expect(await syncOutcome(t)).toStrictEqual({ kind: "failed", at: expect.any(Number), error: { kind: "unavailable", status: 500 } });

    ouraAnswers({ token: () => HttpResponse.json({ access_token: "only" }) });
    await t.action(internal.health.oura.sync, {});
    expect(await syncOutcome(t)).toStrictEqual({ kind: "failed", at: expect.any(Number), error: { kind: "invalid_response" } });

    vi.stubEnv("OURA_CLIENT_SECRET", "");
    await t.action(internal.health.oura.sync, {});
    expect(await syncOutcome(t)).toStrictEqual({ kind: "failed", at: expect.any(Number), error: { kind: "not_configured" } });
  });

  test("a sync that works after a failure is stored as ok, and a later failure remembers when it last worked", async () => {
    const t = await newBackend();
    await connect(t);
    ouraAnswers({});
    await t.action(internal.health.oura.sync, {});
    expect(await syncOutcome(t)).toStrictEqual({ kind: "ok", at: expect.any(Number) });
    ouraAnswers({ sleep: status(503) });
    await t.action(internal.health.oura.sync, {});
    expect(await syncOutcome(t)).toStrictEqual({
      kind: "failed",
      at: expect.any(Number),
      error: { kind: "unavailable", status: 503 },
      lastOkAt: expect.any(Number),
    });
  });
});

describe("the Oura callback on the wire", () => {
  test("answers with a page and a status, and never shows a token", async () => {
    const t = await newBackend();
    const begin = async () => new URL(((await t.mutation(api.health.oura.connect, {})) as { value: { url: string } }).value.url);
    ouraAnswers({});
    const state = (await begin()).searchParams.get("state");
    const done = await t.fetch(`/oura/callback?code=one-time&state=${state}`);
    expect(done.status).toBe(200);
    expect(await done.text()).toContain("Oura is connected");
    expect((await t.fetch(`/oura/callback?code=one-time&state=${state}`)).status).toBe(400);
    const second = (await begin()).searchParams.get("state");
    expect((await t.fetch(`/oura/callback?state=${second}`)).status).toBe(400);
    const third = (await begin()).searchParams.get("state");
    ouraAnswers({ token: status(500) });
    expect((await t.fetch(`/oura/callback?code=x&state=${third}`)).status).toBe(502);
  });
});
