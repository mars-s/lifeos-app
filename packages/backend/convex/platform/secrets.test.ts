import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import { newBackend, newSignedOutBackend, strangerSession, unwrap, type Backend } from "../backend.test-utils";
import { DECISIONS_URL } from "../planner/smartEstimateModel";
import { OPENAI_MODELS_URL } from "./secrets";

const GOOD_KEY = "sk-proj-goodkey-wxyz";
const ENV_KEY = "sk-env-fallback";
const SEALING_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

const openai = setupServer();

const openAiAnswering = () => {
  const checked: (string | null)[] = [];
  const asked: (string | null)[] = [];
  openai.resetHandlers(
    http.get(OPENAI_MODELS_URL, ({ request }) => {
      const authorization = request.headers.get("authorization");
      checked.push(authorization);
      return authorization === `Bearer ${GOOD_KEY}`
        ? HttpResponse.json({ object: "list", data: [] })
        : HttpResponse.json({ error: { code: "invalid_api_key" } }, { status: 401 });
    }),
    http.post(DECISIONS_URL, ({ request }) => {
      asked.push(request.headers.get("authorization"));
      return HttpResponse.json({
        model: "gpt-6-luna",
        answers: [
          { type: "choice", name: "estimate", choice: "30", confidence: 0.8, probabilities: [{ value: "30", probability: 0.9 }] },
          { type: "predicate", name: "too_vague", probability: 0.02 },
        ],
        usage: { input_tokens: 400, output_tokens: 0 },
      });
    }),
  );
  return { checked, asked };
};

const settle = (t: Backend) => t.finishAllScheduledFunctions(vi.runAllTimers);

const keyStatus = (t: Backend) => t.query(api.platform.secrets.status, { name: "openai" });

const smartStatus = async (t: Backend) => {
  const state = (await t.query(api.platform.features.list, {})).find(({ feature }) => feature === "smartEstimates");
  return { enabled: state?.enabled, configured: state?.status.kind !== "needs_key" };
};

const suggestFor = async (t: Backend, title: string) => {
  unwrap(await t.mutation(api.planner.tasks.create, { title }));
  await settle(t);
};

const everyStoredRow = (t: Backend) =>
  t.run(async (ctx) => JSON.stringify([await ctx.db.query("activity").collect(), await ctx.db.query("activityChanges").collect()]));

beforeAll(() => openai.listen({ onUnhandledRequest: "error" }));
afterAll(() => openai.close());

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("LIFEOS_SECRETS_KEY", SEALING_KEY);
  vi.stubEnv("OPENAI_API_KEY", undefined);
});

afterEach(() => {
  openai.resetHandlers();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("saving the OpenAI key", () => {
  test("a key OpenAI accepts is stored sealed, shown only by its last four characters, and used for Smart Estimates", async () => {
    const t = await newBackend();
    const { checked, asked } = openAiAnswering();
    expect(await smartStatus(t)).toEqual({ enabled: true, configured: false });

    const saved = unwrap(await t.action(api.platform.secrets.save, { name: "openai", value: `  ${GOOD_KEY}\n` }));
    expect(saved).toEqual({ last4: "wxyz", savedAt: expect.any(Number) });
    expect(checked).toEqual([`Bearer ${GOOD_KEY}`]);
    expect(await keyStatus(t)).toEqual({ last4: "wxyz", savedAt: saved.savedAt });
    expect(await smartStatus(t)).toEqual({ enabled: true, configured: true });

    const row = await t.run(async (ctx) => ctx.db.query("secrets").unique());
    expect(JSON.stringify(row)).not.toContain(GOOD_KEY);
    expect(JSON.stringify(row)).not.toContain("goodkey");

    await suggestFor(t, "Write essay");
    expect(asked).toEqual([`Bearer ${GOOD_KEY}`]);
  });

  test("a key OpenAI refuses is not stored", async () => {
    const t = await newBackend();
    const { checked } = openAiAnswering();
    const result = await t.action(api.platform.secrets.save, { name: "openai", value: "sk-wrong" });
    expect(result).toEqual({ ok: false, error: { kind: "refused" } });
    expect(checked).toEqual(["Bearer sk-wrong"]);
    expect(await keyStatus(t)).toBeNull();
    expect(await t.run(async (ctx) => ctx.db.query("secrets").collect())).toEqual([]);
  });

  test("without LIFEOS_SECRETS_KEY nothing is checked or stored", async () => {
    vi.stubEnv("LIFEOS_SECRETS_KEY", undefined);
    const t = await newBackend();
    const { checked } = openAiAnswering();
    expect(await t.action(api.platform.secrets.save, { name: "openai", value: GOOD_KEY })).toEqual({
      ok: false,
      error: { kind: "not_set_up" },
    });
    expect(checked).toEqual([]);
    expect(await keyStatus(t)).toBeNull();
  });

  test("an empty paste is refused before OpenAI is asked", async () => {
    const t = await newBackend();
    const { checked } = openAiAnswering();
    expect(await t.action(api.platform.secrets.save, { name: "openai", value: "   " })).toEqual({ ok: false, error: { kind: "empty" } });
    expect(checked).toEqual([]);
  });

  test("no query, result or Activity row ever holds the key or its ciphertext", async () => {
    const t = await newBackend();
    openAiAnswering();
    const saved = await t.action(api.platform.secrets.save, { name: "openai", value: GOOD_KEY });
    const row = await t.run(async (ctx) => ctx.db.query("secrets").unique());
    const replies = JSON.stringify([saved, await keyStatus(t), await smartStatus(t), await t.query(api.platform.features.list, {})]);
    for (const secret of [GOOD_KEY, row!.ciphertext, row!.iv]) expect(replies).not.toContain(secret);

    await t.action(api.platform.secrets.remove, { name: "openai" });
    expect(await everyStoredRow(t)).toBe("[[],[]]");
  });

  test("only the owner can save, read or remove a key", async () => {
    const signedOut = newSignedOutBackend();
    openAiAnswering();
    await expect(signedOut.action(api.platform.secrets.save, { name: "openai", value: GOOD_KEY })).rejects.toThrow(/Sign in/);
    const stranger = await strangerSession(signedOut);
    await expect(stranger.action(api.platform.secrets.save, { name: "openai", value: GOOD_KEY })).rejects.toThrow(/not your LifeOS/);
    await expect(stranger.action(api.platform.secrets.remove, { name: "openai" })).rejects.toThrow(/not your LifeOS/);
    await expect(stranger.query(api.platform.secrets.status, { name: "openai" })).rejects.toThrow(/not your LifeOS/);
  });
});

describe("which key Smart Estimates uses", () => {
  test("with no saved key it falls back to OPENAI_API_KEY", async () => {
    vi.stubEnv("OPENAI_API_KEY", ENV_KEY);
    const t = await newBackend();
    const { asked } = openAiAnswering();
    expect(await smartStatus(t)).toEqual({ enabled: true, configured: true });
    await suggestFor(t, "Write essay");
    expect(asked).toEqual([`Bearer ${ENV_KEY}`]);
  });

  test("a saved key wins over OPENAI_API_KEY, and removing it falls back again", async () => {
    vi.stubEnv("OPENAI_API_KEY", ENV_KEY);
    const t = await newBackend();
    const { asked } = openAiAnswering();
    unwrap(await t.action(api.platform.secrets.save, { name: "openai", value: GOOD_KEY }));
    await suggestFor(t, "Write essay");
    expect(asked).toEqual([`Bearer ${GOOD_KEY}`]);

    await t.action(api.platform.secrets.remove, { name: "openai" });
    expect(await keyStatus(t)).toBeNull();
    await suggestFor(t, "Read papers");
    expect(asked).toEqual([`Bearer ${GOOD_KEY}`, `Bearer ${ENV_KEY}`]);
  });

  test("removing the only key turns Smart Estimates back to not set up", async () => {
    const t = await newBackend();
    const { asked } = openAiAnswering();
    unwrap(await t.action(api.platform.secrets.save, { name: "openai", value: GOOD_KEY }));
    await t.action(api.platform.secrets.remove, { name: "openai" });
    expect(await smartStatus(t)).toEqual({ enabled: true, configured: false });
    await suggestFor(t, "Write essay");
    expect(asked).toEqual([]);
  });
});
