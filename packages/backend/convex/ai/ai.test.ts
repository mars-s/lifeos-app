import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { costLine, modelChain, PROVIDERS } from "../../shared/ai";
import { DECISIONS_URL, GO_CHAT_URL, newAiBackend, newBackend, OPENAI_CHAT_URL, switchAiOn, unwrap, type Backend } from "../backend.test-utils";
import { resultToWire } from "../../shared/result";
import { decisionsFromChat, type Question } from "./transport";

type Call = { url: string; authorization: string | null; session: string | null; body: Record<string, unknown> };

const server = setupServer();
const SEALING_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));

const chatReply = (content: unknown) =>
  HttpResponse.json({ model: "served-model", choices: [{ message: { role: "assistant", content: JSON.stringify(content), refusal: null } }] });

const estimateJson = { estimate: { "30 minutes": 0.5, "45 minutes": 0.3, "1 hour": 0.2, "a fortnight": 0.9 }, too_vague: 0.05 };

const decisionsAnswer = {
  model: "gpt-6-luna",
  answers: [
    { type: "choice", name: "estimate", choice: "10 minutes", confidence: 0.9, probabilities: [{ value: "10 minutes", probability: 0.9 }] },
    { type: "predicate", name: "too_vague", probability: 0.01 },
  ],
};

const stepsJson = { steps: ["1. Draft the outline", "Collect the sources", "collect the sources", "Write the body", "  "], project: false };

const listening = ({ decisions = 200, go = 200, openaiChat = 200 } = {}) => {
  const calls: Call[] = [];
  const log = async (request: Request) =>
    calls.push({
      url: request.url,
      authorization: request.headers.get("authorization"),
      session: request.headers.get("x-opencode-session"),
      body: (await request.json()) as Record<string, unknown>,
    });
  const chat = (status: number) => async ({ request }: { request: Request }) => {
    await log(request);
    if (status !== 200) return new HttpResponse("{}", { status });
    const body = calls.at(-1)!.body as { response_format: { json_schema: { name: string } } };
    return chatReply(body.response_format.json_schema.name === "steps" ? stepsJson : estimateJson);
  };
  server.resetHandlers(
    http.post(DECISIONS_URL, async ({ request }) => {
      await log(request);
      return decisions === 200 ? HttpResponse.json(decisionsAnswer) : new HttpResponse("{}", { status: decisions });
    }),
    http.post(GO_CHAT_URL, chat(go)),
    http.post(OPENAI_CHAT_URL, chat(openaiChat)),
  );
  return calls;
};

const settle = (t: Backend) => t.finishAllScheduledFunctions(vi.runAllTimers);

const estimateOutcome = (t: Backend) => t.run(async (ctx) => (await ctx.db.query("estimateSuggestions").first())?.outcome);

const route = (t: Backend, capability: "smartEstimates" | "breakIntoSteps" | "tripDetection", fields: { on?: boolean; model?: string }) =>
  t.mutation(api.ai.routing.setRoute, { capability, ...fields });

const essay = async (t: Backend) => unwrap(await t.mutation(api.planner.tasks.create, { title: "Write essay body", notes: "Three sections" })).taskId;

const checklistOf = (t: Backend, taskId: Id<"tasks">) =>
  t.run(async (ctx) =>
    (
      await ctx.db
        .query("checklistItems")
        .withIndex("by_task_order", (q) => q.eq("taskId", taskId))
        .collect()
    ).map(({ title }) => title),
  );

const reply = (content: string) => ({ choices: [{ message: { content } }] });

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("OPENAI_API_KEY", "sk-openai");
  vi.stubEnv("OPENCODE_GO_API_KEY", "go-key");
});

afterEach(() => {
  server.resetHandlers();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("routing a capability to a model", () => {
  test("Smart Estimates goes to the Decisions API by default and records which model answered", async () => {
    const t = await newAiBackend();
    const calls = listening();
    unwrap(await t.mutation(api.planner.tasks.create, { title: "Email supervisor" }));
    await settle(t);
    expect(calls.map(({ url, authorization }) => [url, authorization])).toEqual([[DECISIONS_URL, "Bearer sk-openai"]]);
    expect(await estimateOutcome(t)).toMatchObject({ kind: "suggested", minutes: 10, answeredBy: "openai/decisions/gpt-6-luna" });
  });

  test("on an OpenCode Go model, Smart Estimates asks Chat Completions for odds as JSON and reads them like a Decisions answer", async () => {
    const t = await newAiBackend();
    unwrap(await route(t, "smartEstimates", { model: "opencodeGo/deepseek-v4.1-flash" }));
    const calls = listening();
    const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Write essay body" }));
    await settle(t);

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe(GO_CHAT_URL);
    expect(call?.authorization).toBe("Bearer go-key");
    expect(call?.session).toBe("ses_lifeossmartestimate");
    const body = call?.body as { model: string; response_format: { type: string; json_schema: { strict: boolean; schema: { required: string[] } } } };
    expect(body.model).toBe("deepseek-v4.1-flash");
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.required).toEqual(["estimate", "too_vague"]);

    expect(await t.query(api.planner.smartEstimates.forTask, { taskId })).toMatchObject({
      kind: "guesses",
      guesses: [
        { minutes: 30, probability: 0.5 },
        { minutes: 45, probability: 0.3 },
        { minutes: 60, probability: 0.2 },
      ],
      likely: 30,
    });
    expect(await estimateOutcome(t)).toMatchObject({ answeredBy: "opencodeGo/deepseek-v4.1-flash", model: "deepseek-v4.1-flash", confidence: 0.5 });
  });

  test("when the chosen model fails, the default answers instead, and the cache says which", async () => {
    const t = await newAiBackend();
    unwrap(await route(t, "smartEstimates", { model: "opencodeGo/glm-5.3-flash" }));
    const calls = listening({ go: 503 });
    unwrap(await t.mutation(api.planner.tasks.create, { title: "Email supervisor" }));
    await settle(t);
    expect(calls.map(({ url, body }) => [url, body.model])).toEqual([
      [GO_CHAT_URL, "glm-5.3-flash"],
      [DECISIONS_URL, "gpt-6-luna"],
    ]);
    expect(await estimateOutcome(t)).toMatchObject({ kind: "suggested", answeredBy: "openai/decisions/gpt-6-luna" });
  });

  test("a model whose Provider has no key is skipped for the next one that has a key", async () => {
    vi.stubEnv("OPENAI_API_KEY", undefined);
    const t = await newAiBackend();
    expect((await t.query(api.ai.routing.overview, {})).capabilities[0]).toMatchObject({ model: "openai/decisions/gpt-6-luna", answering: "opencodeGo/deepseek-v4.1-flash" });
    const calls = listening();
    unwrap(await t.mutation(api.planner.tasks.create, { title: "Email supervisor" }));
    await settle(t);
    expect(calls.map(({ url, body }) => [url, body.model])).toEqual([[GO_CHAT_URL, "deepseek-v4.1-flash"]]);
    expect(await estimateOutcome(t)).toMatchObject({ answeredBy: "opencodeGo/deepseek-v4.1-flash" });
  });

  test("the chain is the chosen model, then the default, then the fallback, with only keyed Providers that can answer", () => {
    const both = new Set(["openai", "opencodeGo"] as const);
    expect(modelChain("breakIntoSteps", "openai/gpt-6.1-terra", both)).toEqual(["openai/gpt-6.1-terra", "opencodeGo/deepseek-v4.1-flash", "openai/gpt-6-luna"]);
    expect(modelChain("breakIntoSteps", "openai/gpt-6.1-terra", new Set(["opencodeGo"] as const))).toEqual(["opencodeGo/deepseek-v4.1-flash"]);
    expect(modelChain("smartEstimates", "openai/decisions/gpt-6-luna", new Set())).toEqual([]);
  });

  test("a route only takes a model that can answer what the capability asks, and the change undoes", async () => {
    const t = await newAiBackend();
    const steps = await route(t, "breakIntoSteps", { model: "openai/decisions/gpt-6-luna" });
    expect(steps).toMatchObject({ ok: false, error: { kind: "model_cannot_answer" } });
    expect(await route(t, "smartEstimates", { model: "openai/gpt-9" })).toMatchObject({ ok: false, error: { kind: "unknown_model" } });
    expect(await route(t, "tripDetection", { on: false })).toMatchObject({ ok: false, error: { kind: "switched_elsewhere", feature: "places" } });

    const { activityId } = unwrap(await route(t, "smartEstimates", { model: "opencodeGo/glm-5.3" }));
    const modelOf = async () => (await t.query(api.ai.routing.overview, {})).capabilities.find(({ capability }) => capability === "smartEstimates")?.model;
    expect(await modelOf()).toBe("opencodeGo/glm-5.3");
    unwrap(await t.mutation(api.platform.undo.undo, { activityId: activityId! }));
    expect(await modelOf()).toBe("openai/decisions/gpt-6-luna");
  });

  test("a stored model LifeOS no longer offers falls back to the default", async () => {
    const t = await newBackend();
    await switchAiOn(t, { smartEstimates: { on: true, model: "openai/retired-model" } });
    const calls = listening();
    unwrap(await t.mutation(api.planner.tasks.create, { title: "Email supervisor" }));
    await settle(t);
    expect(calls.map(({ url }) => url)).toEqual([DECISIONS_URL]);
  });

  test("the cost line is worked out from the model price and says when it comes from the Go allowance", () => {
    expect(costLine("smartEstimates", "openai/decisions/gpt-6-luna")).toBe("About US$0.09 per 1,000 Tasks.");
    expect(costLine("breakIntoSteps", "opencodeGo/deepseek-v4.1-flash")).toBe("About US$0.25 per 1,000 breakdowns, from your OpenCode Go allowance.");
  });
});

describe("AI off sends nothing anywhere", () => {
  test("with keys set but AI off, new Tasks, steps and trips make no call at all", async () => {
    const t = await newBackend();
    const calls = listening();
    await t.run(async (ctx) => {
      await ctx.db.insert("features", { feature: "places", enabled: true, settings: { travelMode: "drive" } });
      await ctx.db.insert("savedPlaces", { label: "home", address: "1 Example St", position: { lat: -33.87, lon: 151.21 }, found: "Example St", savedAt: 1 });
    });
    const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Buy stamps at the post office" }));
    expect(await t.mutation(api.planner.smartEstimates.request, { taskId })).toEqual({ requested: false });
    expect(await t.mutation(api.ai.steps.request, { taskId })).toEqual({ requested: false });
    expect(await t.mutation(api.places.trips.request, { taskId })).toEqual({ requested: false });
    await settle(t);
    expect(calls).toEqual([]);
    expect(await t.query(api.ai.steps.forTask, { taskId })).toEqual({ kind: "off" });
    expect(await t.query(api.planner.smartEstimates.forTask, { taskId })).toEqual({ kind: "presets" });
  });

  test("a capability switched off on the AI page makes no call while the others still work", async () => {
    const t = await newAiBackend();
    unwrap(await route(t, "smartEstimates", { on: false }));
    const calls = listening();
    const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Write essay body" }));
    await settle(t);
    expect(calls).toEqual([]);
    expect(await t.mutation(api.ai.steps.request, { taskId })).toEqual({ requested: true });
    await settle(t);
    expect(calls.map(({ url }) => url)).toEqual([GO_CHAT_URL]);
  });

  test("switching AI off mid-wait settles the request without a call", async () => {
    const t = await newAiBackend();
    const calls = listening();
    const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Write essay body" }));
    unwrap(await t.mutation(api.platform.features.setEnabled, { feature: "ai", enabled: false }));
    await settle(t);
    expect(calls).toEqual([]);
    expect(await t.query(api.planner.smartEstimates.forTask, { taskId })).toEqual({ kind: "presets" });
  });
});

describe("Break into steps", () => {


  test("asks the chosen model for steps as strict JSON and shows a clean preview", async () => {
    const t = await newAiBackend();
    const calls = listening();
    const taskId = await essay(t);
    await settle(t);
    calls.length = 0;
    expect(await t.query(api.ai.steps.forTask, { taskId })).toEqual({ kind: "idle" });

    expect(await t.mutation(api.ai.steps.request, { taskId })).toEqual({ requested: true });
    expect(await t.query(api.ai.steps.forTask, { taskId })).toEqual({ kind: "thinking" });
    await settle(t);

    expect(calls).toHaveLength(1);
    const body = calls[0]?.body as { model: string; messages: { role: string; content: string }[]; response_format: { json_schema: { name: string } } };
    expect(calls[0]?.url).toBe(GO_CHAT_URL);
    expect(calls[0]?.session).toBe("ses_lifeosbreakintosteps");
    expect(body.model).toBe("deepseek-v4.1-flash");
    expect(body.response_format.json_schema.name).toBe("steps");
    expect(body.messages[1]?.content).toContain("Task: Write essay body\nDescription: Three sections");
    expect(await t.query(api.ai.steps.forTask, { taskId })).toEqual({
      kind: "steps",
      steps: ["Draft the outline", "Collect the sources", "Write the body"],
      project: false,
      answeredBy: "opencodeGo/deepseek-v4.1-flash",
    });
  });

  test("the same Task asked again with nothing changed makes no second call, unless Avi asks again", async () => {
    const t = await newAiBackend();
    const taskId = await essay(t);
    await settle(t);
    const calls = listening();
    await t.mutation(api.ai.steps.request, { taskId });
    await settle(t);
    await t.mutation(api.ai.steps.request, { taskId });
    await settle(t);
    expect(calls).toHaveLength(1);
    expect(await t.query(api.ai.steps.forTask, { taskId })).toMatchObject({ kind: "steps" });

    await t.mutation(api.ai.steps.request, { taskId, again: true });
    await settle(t);
    expect(calls).toHaveLength(2);
  });

  test("accepting edited and reordered steps adds them as Checklist Items in one change that undoes in one step", async () => {
    const t = await newAiBackend();
    listening();
    const taskId = await essay(t);
    unwrap(await t.mutation(api.planner.checklist.add, { taskId, title: "Pick a topic" }));
    await t.mutation(api.ai.steps.request, { taskId });
    await settle(t);

    const { activityId, itemIds } = unwrap(await t.mutation(api.ai.steps.accept, { taskId, titles: ["Write the body", "Draft the outline, with headings"] }));
    expect(itemIds).toHaveLength(2);
    expect(await checklistOf(t, taskId)).toEqual(["Pick a topic", "Write the body", "Draft the outline, with headings"]);
    expect(await t.query(api.ai.steps.forTask, { taskId })).toEqual({ kind: "idle" });
    const changes = await t.run((ctx) => ctx.db.query("activityChanges").withIndex("by_activity_seq", (q) => q.eq("activityId", activityId!)).collect());
    expect(changes.map(({ change }) => change.kind)).toEqual(["insert", "insert"]);

    unwrap(await t.mutation(api.platform.undo.undo, { activityId: activityId! }));
    expect(await checklistOf(t, taskId)).toEqual(["Pick a topic"]);
  });

  test("an empty step is refused and nothing is added", async () => {
    const t = await newAiBackend();
    const taskId = await essay(t);
    await settle(t);
    expect(await t.mutation(api.ai.steps.accept, { taskId, titles: ["Draft", "  "] })).toMatchObject({ ok: false, error: { kind: "empty_title" } });
    expect(await checklistOf(t, taskId)).toEqual([]);
  });

  test("a failed call says why, and dismissing clears it", async () => {
    vi.stubEnv("OPENAI_API_KEY", undefined);
    const t = await newAiBackend();
    listening({ go: 429 });
    const taskId = await essay(t);
    await t.mutation(api.ai.steps.request, { taskId });
    await settle(t);
    expect(await t.query(api.ai.steps.forTask, { taskId })).toEqual({ kind: "failed", error: "rate_limited" });
    await t.mutation(api.ai.steps.dismiss, { taskId });
    expect(await t.query(api.ai.steps.forTask, { taskId })).toEqual({ kind: "idle" });
  });

  test("only Avi can ask for or accept steps", async () => {
    const t = await newAiBackend();
    const taskId = await essay(t);
    const signedOut = t.withIdentity({});
    await expect(signedOut.mutation(api.ai.steps.request, { taskId })).rejects.toThrow();
    await expect(signedOut.mutation(api.ai.steps.accept, { taskId, titles: ["Draft"] })).rejects.toThrow();
  });
});

describe("keys for each Provider", () => {
  test("an OpenCode Go key is checked with OpenCode before it is kept, and a refused one is not", async () => {
    vi.stubEnv("LIFEOS_SECRETS_KEY", SEALING_KEY);
    vi.stubEnv("OPENCODE_GO_API_KEY", undefined);
    const checked: (string | null)[] = [];
    server.resetHandlers(
      http.get(PROVIDERS.opencodeGo.keyCheckUrl, ({ request }) => {
        checked.push(request.headers.get("authorization"));
        return request.headers.get("authorization") === "Bearer go-good"
          ? HttpResponse.json({ object: "list", data: [] })
          : HttpResponse.json({ error: { type: "authentication_error" } }, { status: 401 });
      }),
    );
    const t = await newBackend();
    expect(await t.action(api.platform.secrets.save, { name: "opencodeGo", value: "go-bad" })).toEqual({ ok: false, error: { kind: "refused" } });
    expect(await t.query(api.platform.secrets.status, { name: "opencodeGo" })).toBeNull();
    expect(await t.action(api.platform.secrets.save, { name: "opencodeGo", value: " go-good " })).toMatchObject({ ok: true, value: { last4: "good" } });
    expect(checked).toEqual(["Bearer go-bad", "Bearer go-good"]);
    expect((await t.query(api.ai.routing.overview, {})).keyed).toEqual(["openai", "opencodeGo"]);
  });
});

describe("moving Smart Estimates under AI", () => {
  test("Avi's Smart Estimates, which were on, turn AI on with every capability at its default, once", async () => {
    const t = await newBackend();
    await t.run(async (ctx) => {
      await ctx.db.insert("features", { feature: "places", enabled: true, settings: { travelMode: "walk" } });
    });
    expect(await t.mutation(internal.ai.migrations.fromSmartEstimates, {})).toEqual({ migrated: true });
    expect(await t.mutation(internal.ai.migrations.fromSmartEstimates, {})).toEqual({ migrated: false });
    const states = await t.query(api.platform.features.list, {});
    expect(states.find(({ feature }) => feature === "ai")).toMatchObject({ enabled: true, status: { kind: "ready" } });
    expect(states.find(({ feature }) => feature === "places")).toMatchObject({ enabled: true, settings: { travelMode: "walk" } });
    expect((await t.query(api.ai.routing.overview, {})).capabilities).toEqual([
      { capability: "smartEstimates", on: true, model: "openai/decisions/gpt-6-luna", answering: "openai/decisions/gpt-6-luna" },
      { capability: "breakIntoSteps", on: true, model: "opencodeGo/deepseek-v4.1-flash", answering: "opencodeGo/deepseek-v4.1-flash" },
      { capability: "tripDetection", on: true, model: "openai/decisions/gpt-6-luna", answering: "openai/decisions/gpt-6-luna" },
      { capability: "agent", on: true, model: "openai/gpt-6-luna", answering: "openai/gpt-6-luna" },
      { capability: "searchIndex", on: true, model: "openai/text-embedding-3-small", answering: "openai/text-embedding-3-small" },
    ]);
  });

  test("once AI has a row, even switched off, the migration leaves it alone", async () => {
    const t = await newBackend();
    unwrap(await t.mutation(api.platform.features.setEnabled, { feature: "ai", enabled: false }));
    expect(await t.mutation(internal.ai.migrations.fromSmartEstimates, {})).toEqual({ migrated: false });
    expect((await t.query(api.platform.features.list, {})).find(({ feature }) => feature === "ai")?.enabled).toBe(false);
  });
});

describe("reading a chat model's odds", () => {
  const questions: Question[] = [
    { type: "choice", name: "size", instructions: "How big?", choices: [{ value: "small", description: "" }, { value: "big", description: "" }] },
    { type: "predicate", name: "vague", instructions: "Vague?" },
  ];

  test("drops options it did not offer, renormalises, and picks the most likely", () => {
    expect(resultToWire(decisionsFromChat(questions, "m", reply('```json\n{"size":{"small":1,"big":3,"huge":9},"vague":1.4}\n```')))).toEqual({
      ok: true,
      value: {
        model: "m",
        answers: [
          { type: "choice", name: "size", choice: "big", confidence: 0.75, probabilities: [{ value: "big", probability: 0.75 }, { value: "small", probability: 0.25 }] },
          { type: "predicate", name: "vague", probability: 1 },
        ],
      },
    });
  });

  test("a missing answer, no odds at all or a refusal is not read as an answer", () => {
    expect(resultToWire(decisionsFromChat(questions, "m", reply('{"size":{"small":0,"big":0},"vague":0.1}')))).toEqual({ ok: false, error: { kind: "invalid_response" } });
    expect(resultToWire(decisionsFromChat(questions, "m", reply('{"size":{"small":1}}')))).toEqual({ ok: false, error: { kind: "invalid_response" } });
    expect(resultToWire(decisionsFromChat(questions, "m", reply("not json")))).toEqual({ ok: false, error: { kind: "invalid_response" } });
    expect(resultToWire(decisionsFromChat(questions, "m", { choices: [{ message: { content: null, refusal: "No." } }] }))).toEqual({ ok: false, error: { kind: "refused" } });
  });
});

const stepsRow = (t: Backend, taskId: Id<"tasks">) =>
  t.run((ctx) =>
    ctx.db
      .query("stepSuggestions")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .unique(),
  );

const goAnswers = (answer: () => Response) => {
  const calls: string[] = [];
  server.resetHandlers(
    http.post(GO_CHAT_URL, ({ request }) => {
      calls.push(request.url);
      return answer();
    }),
  );
  return calls;
};

describe("Break into steps when the Provider fails", () => {
  test.each([
    ["refuses the key", () => new HttpResponse("{}", { status: 401 }), "unauthorised"],
    ["forbids the key", () => new HttpResponse("{}", { status: 403 }), "unauthorised"],
    ["rate limits", () => new HttpResponse("{}", { status: 429 }), "rate_limited"],
    ["breaks", () => new HttpResponse("{}", { status: 500 }), "unavailable"],
    ["cannot be reached", () => HttpResponse.error(), "unavailable"],
    ["sends malformed JSON", () => new HttpResponse("{oops", { headers: { "content-type": "application/json" } }), "invalid_response"],
    ["sends no choices", () => HttpResponse.json({ error: "x" }), "invalid_response"],
    ["sends prose instead of JSON", () => HttpResponse.json(reply("Here are some steps: draft, write.")), "invalid_response"],
    ["sends a list instead of an object", () => chatReply(["Draft"]), "invalid_response"],
    ["sends only blank steps", () => chatReply({ steps: ["  ", "- ", 4], project: false }), "invalid_response"],
    ["refuses to answer", () => HttpResponse.json({ choices: [{ message: { content: null, refusal: "I cannot help." } }] }), "refused"],
  ])("a Provider that %s is a typed failure, not a thrown error", async (_, answer, error) => {
    vi.stubEnv("OPENAI_API_KEY", undefined);
    const t = await newAiBackend();
    const calls = goAnswers(answer);
    const taskId = await essay(t);
    await settle(t);
    calls.length = 0;
    await t.mutation(api.ai.steps.request, { taskId });
    await settle(t);
    expect(calls).toHaveLength(1);
    expect(await t.query(api.ai.steps.forTask, { taskId })).toEqual({ kind: "failed", error });
  });

  test("when the chosen model's key is refused, the next model in the chain answers", async () => {
    const t = await newAiBackend();
    const calls = listening({ go: 401 });
    const taskId = await essay(t);
    await t.mutation(api.ai.steps.request, { taskId });
    await settle(t);
    expect(calls.map(({ url }) => url).filter((url) => url !== DECISIONS_URL)).toEqual([GO_CHAT_URL, OPENAI_CHAT_URL]);
    expect(await t.query(api.ai.steps.forTask, { taskId })).toMatchObject({ kind: "steps", answeredBy: "openai/gpt-6-luna" });
  });

  test("a saved key that no longer unseals, with no key in the environment, fails as not configured without a call", async () => {
    vi.stubEnv("OPENAI_API_KEY", undefined);
    vi.stubEnv("OPENCODE_GO_API_KEY", undefined);
    vi.stubEnv("LIFEOS_SECRETS_KEY", SEALING_KEY);
    const t = await newAiBackend();
    await t.run(async (ctx) => {
      await ctx.db.insert("secrets", { name: "opencodeGo", iv: btoa("twelve bytes"), ciphertext: btoa("not a sealed key"), last4: "abcd", savedAt: 1 });
    });
    const calls = listening();
    const taskId = await essay(t);
    expect(await t.mutation(api.ai.steps.request, { taskId })).toEqual({ requested: true });
    await settle(t);
    expect(calls).toEqual([]);
    expect(await t.query(api.ai.steps.forTask, { taskId })).toEqual({ kind: "failed", error: "not_configured" });
  });
});

describe("Break into steps when the Task changes", () => {
  test("a missing, completed or trashed Task asks for nothing", async () => {
    const t = await newAiBackend();
    const calls = listening();
    const done = await essay(t);
    const trashed = await essay(t);
    const gone = await essay(t);
    unwrap(await t.mutation(api.planner.tasks.complete, { taskId: done }));
    unwrap(await t.mutation(api.planner.tasks.trash, { taskId: trashed }));
    await t.run((ctx) => ctx.db.delete("tasks", gone));
    await settle(t);
    calls.length = 0;
    for (const taskId of [done, trashed, gone]) expect(await t.mutation(api.ai.steps.request, { taskId })).toEqual({ requested: false });
    await settle(t);
    expect(calls).toEqual([]);
  });

  test("a Task deleted or trashed while steps are waiting settles back to idle without a call", async () => {
    const t = await newAiBackend();
    const taskId = await essay(t);
    const other = await essay(t);
    await settle(t);
    const calls = listening();
    await t.mutation(api.ai.steps.request, { taskId });
    await t.mutation(api.ai.steps.request, { taskId: other });
    await t.run((ctx) => ctx.db.delete("tasks", taskId));
    unwrap(await t.mutation(api.planner.tasks.trash, { taskId: other }));
    await settle(t);
    expect(calls).toEqual([]);
    expect(await stepsRow(t, taskId)).toBeNull();
    expect(await t.query(api.ai.steps.forTask, { taskId: other })).toEqual({ kind: "idle" });
  });

  test("asking twice before the first answer makes one call, for the latest request", async () => {
    const t = await newAiBackend();
    const taskId = await essay(t);
    await settle(t);
    const calls = listening();
    await t.mutation(api.ai.steps.request, { taskId });
    unwrap(await t.mutation(api.planner.tasks.rename, { taskId, title: "Write essay conclusion" }));
    await t.mutation(api.ai.steps.request, { taskId, again: true });
    await settle(t);
    expect(calls.filter(({ url }) => url === GO_CHAT_URL)).toHaveLength(1);
    const body = calls.find(({ url }) => url === GO_CHAT_URL)?.body as { messages: { content: string }[] };
    expect(body.messages[1]?.content).toContain("Task: Write essay conclusion");
    expect(await t.query(api.ai.steps.forTask, { taskId })).toMatchObject({ kind: "steps" });
  });

  test("a changed Checklist counts as a change, so asking again sends the new Checklist", async () => {
    const t = await newAiBackend();
    const taskId = await essay(t);
    await settle(t);
    const calls = listening();
    await t.mutation(api.ai.steps.request, { taskId });
    await settle(t);
    unwrap(await t.mutation(api.planner.checklist.add, { taskId, title: "Pick a topic" }));
    await t.mutation(api.ai.steps.request, { taskId });
    await settle(t);
    const sent = calls.filter(({ url }) => url === GO_CHAT_URL).map(({ body }) => (body as { messages: { content: string }[] }).messages[1]?.content);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain("Checklist already: Pick a topic");
  });

  test("a Task deleted forever takes its step suggestion with it", async () => {
    const t = await newAiBackend();
    listening();
    const taskId = await essay(t);
    await t.mutation(api.ai.steps.request, { taskId });
    await settle(t);
    expect(await stepsRow(t, taskId)).not.toBeNull();
    unwrap(await t.mutation(api.planner.tasks.trash, { taskId }));
    unwrap(await t.mutation(api.planner.trash.deleteForever, { items: [{ kind: "task", id: taskId }] }));
    expect(await stepsRow(t, taskId)).toBeNull();
  });
});

describe("accepting steps", () => {
  test("for a Task that is gone, nothing is added and the error says so", async () => {
    const t = await newAiBackend();
    const taskId = await essay(t);
    await t.run((ctx) => ctx.db.delete("tasks", taskId));
    expect(await t.mutation(api.ai.steps.accept, { taskId, titles: ["Draft"] })).toMatchObject({ ok: false, error: { kind: "not_found" } });
    expect(await checklistOf(t, taskId)).toEqual([]);
  });

  test("no titles adds nothing and records nothing, and more than twenty keeps the first twenty", async () => {
    const t = await newAiBackend();
    const taskId = await essay(t);
    expect(unwrap(await t.mutation(api.ai.steps.accept, { taskId, titles: [] }))).toEqual({ itemIds: [], activityId: null });
    const titles = Array.from({ length: 25 }, (_, index) => `Step ${index + 1}`);
    const { itemIds, activityId } = unwrap(await t.mutation(api.ai.steps.accept, { taskId, titles }));
    expect(itemIds).toHaveLength(20);
    expect(await checklistOf(t, taskId)).toEqual(titles.slice(0, 20));
    unwrap(await t.mutation(api.platform.undo.undo, { activityId: activityId! }));
    expect(await checklistOf(t, taskId)).toEqual([]);
  });
});

describe("a route change", () => {
  test("switching a capability off keeps its model, undoes back to on, and the same route twice records nothing", async () => {
    const t = await newAiBackend();
    unwrap(await route(t, "breakIntoSteps", { model: "openai/gpt-6.1-terra" }));
    const off = unwrap(await route(t, "breakIntoSteps", { on: false }));
    const steps = async () => (await t.query(api.ai.routing.overview, {})).capabilities.find(({ capability }) => capability === "breakIntoSteps");
    expect(await steps()).toMatchObject({ on: false, model: "openai/gpt-6.1-terra" });
    expect(unwrap(await route(t, "breakIntoSteps", { on: false }))).toEqual({ changed: false, activityId: null });
    const taskId = await essay(t);
    expect(await t.mutation(api.ai.steps.request, { taskId })).toEqual({ requested: false });

    unwrap(await t.mutation(api.platform.undo.undo, { activityId: off.activityId! }));
    expect(await steps()).toMatchObject({ on: true, model: "openai/gpt-6.1-terra", answering: "openai/gpt-6.1-terra" });
  });

  test("a route set before AI is ever switched on undoes back to no AI row at all", async () => {
    const t = await newBackend();
    const { activityId } = unwrap(await route(t, "smartEstimates", { model: "opencodeGo/glm-5.3" }));
    expect((await t.query(api.platform.features.list, {})).find(({ feature }) => feature === "ai")).toMatchObject({ enabled: false });
    unwrap(await t.mutation(api.platform.undo.undo, { activityId: activityId! }));
    expect(await t.run((ctx) => ctx.db.query("features").collect())).toEqual([]);
  });

  test("Trip detection shows as on exactly when Places is switched on", async () => {
    const t = await newAiBackend();
    const trips = async () => (await t.query(api.ai.routing.overview, {})).capabilities.find(({ capability }) => capability === "tripDetection")?.on;
    expect(await trips()).toBe(false);
    unwrap(await t.mutation(api.platform.features.setEnabled, { feature: "places", enabled: true }));
    expect(await trips()).toBe(true);
  });
});

describe("reading a chat model's odds, malformed", () => {
  const questions: Question[] = [
    { type: "choice", name: "size", instructions: "How big?", choices: [{ value: "small", description: "" }] },
    { type: "predicate", name: "vague", instructions: "Vague?" },
  ];

  test("a list, a choice given as a word, odds given as text or no message at all is not an answer", () => {
    expect(resultToWire(decisionsFromChat(questions, "m", reply("[1, 2]")))).toEqual({ ok: false, error: { kind: "invalid_response" } });
    expect(resultToWire(decisionsFromChat(questions, "m", reply('{"size":"small","vague":0.1}')))).toEqual({ ok: false, error: { kind: "invalid_response" } });
    expect(resultToWire(decisionsFromChat(questions, "m", reply('{"size":{"small":1},"vague":"no"}')))).toEqual({ ok: false, error: { kind: "invalid_response" } });
    expect(resultToWire(decisionsFromChat(questions, "m", { choices: [] }))).toEqual({ ok: false, error: { kind: "invalid_response" } });
    expect(resultToWire(decisionsFromChat(questions, "m", null))).toEqual({ ok: false, error: { kind: "invalid_response" } });
  });
});
