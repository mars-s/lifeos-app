import { describe, expect, it } from "@effect/vitest";
import { MockLanguageModelV4 } from "ai/test";
import { Effect, Layer, Result } from "effect";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";
import { PROVIDERS, USER_AGENT } from "../../shared/ai";
import { asWire } from "../../shared/effect/wire";
import { embedTexts } from "./embeddings";
import { AiRouter } from "./routing";
import { parseSteps, stepsAsk } from "./steps";
import { AiProvider, askChoiceFx, askJson, type Attempt, type ChoiceAsk } from "./transport";

type Asked = { url: string; headers: Record<string, string>; body: unknown };

const answering = (asked: Asked[], reply: (url: string) => Response | "unreachable") =>
  AiProvider.layerNoDeps.pipe(
    Layer.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.gen(function* () {
            const body = request.body._tag === "Uint8Array" ? JSON.parse(new TextDecoder().decode(request.body.body)) : null;
            asked.push({ url: request.url, headers: { ...request.headers }, body });
            const answer = reply(request.url);
            if (answer === "unreachable") return yield* new HttpClientError.HttpClientError({ reason: new HttpClientError.TransportError({ request }) });
            return HttpClientResponse.fromWeb(request, answer);
          }),
        ),
      ),
    ),
  );

const chat = (content: string) => Response.json({ choices: [{ message: { role: "assistant", content, refusal: null } }] });

const openai: Attempt = { model: "openai/gpt-6-luna", key: "sk-test" };
const go: Attempt = { model: "opencodeGo/deepseek-v4.1-flash", key: "go-test" };
const decisions: Attempt = { model: "openai/decisions/gpt-6-luna", key: "sk-test" };
const embedder: Attempt = { model: "openai/text-embedding-3-small", key: "sk-test" };

const signal = { title: "Write essay", notes: "", estimateMinutes: null, checklist: [] };

const choiceAsk: ChoiceAsk = {
  cacheKey: "lifeos-test",
  instructions: "Pick one.",
  parts: [{ type: "input_text", text: "Task: Write essay" }],
  questions: [{ type: "predicate", name: "vague", instructions: "Vague?" }],
};

const ask = (reply: () => Response | "unreachable") => asWire(askJson([openai], stepsAsk(signal), parseSteps)).pipe(Effect.provide(answering([], reply)));

describe("the live AiProvider on a canned HttpClient", () => {
  it.effect("posts the same JSON body and headers, with the session header only for OpenCode Go", () =>
    Effect.gen(function* () {
      const asked: Asked[] = [];
      const layer = answering(asked, () => chat('{"steps":["Draft"],"project":false}'));
      yield* askJson([go], stepsAsk(signal), parseSteps).pipe(Effect.provide(layer));
      yield* askJson([openai], stepsAsk(signal), parseSteps).pipe(Effect.provide(layer));
      expect(asked.map(({ url, headers }) => [url, headers.authorization, headers["user-agent"], headers["content-type"], headers["x-opencode-session"]])).toStrictEqual([
        [`${PROVIDERS.opencodeGo.baseUrl}/chat/completions`, "Bearer go-test", USER_AGENT, "application/json", "ses_lifeosbreakintosteps"],
        [`${PROVIDERS.openai.baseUrl}/chat/completions`, "Bearer sk-test", USER_AGENT, "application/json", undefined],
      ]);
      expect(asked[0]?.body).toMatchObject({ model: "deepseek-v4.1-flash", response_format: { type: "json_schema", json_schema: { name: "steps", strict: true } } });
    }),
  );

  it.effect("hands a Decisions answer to the caller's parser untouched", () =>
    Effect.gen(function* () {
      const asked: Asked[] = [];
      const answer = { model: "gpt-6-luna", answers: [{ type: "predicate", name: "vague", probability: 0.1 }] };
      const read = yield* askChoiceFx([decisions], choiceAsk, (body) => Result.succeed(body)).pipe(Effect.provide(answering(asked, () => Response.json(answer))));
      expect(read).toStrictEqual({ answeredBy: "openai/decisions/gpt-6-luna", value: answer });
      expect(asked[0]?.body).toStrictEqual({
        model: "gpt-6-luna",
        prompt_cache_key: "lifeos-test",
        input: [
          { role: "developer", content: "Pick one." },
          { role: "user", content: [{ type: "input_text", text: "Task: Write essay" }] },
        ],
        questions: choiceAsk.questions,
      });
    }),
  );

  it.effect("turns each refusal into the stored AI error", () =>
    Effect.gen(function* () {
      expect(yield* ask(() => new Response("{}", { status: 401 }))).toStrictEqual({ ok: false, error: { kind: "unauthorised" } });
      expect(yield* ask(() => new Response("{}", { status: 403 }))).toStrictEqual({ ok: false, error: { kind: "unauthorised" } });
      expect(yield* ask(() => new Response("{}", { status: 429 }))).toStrictEqual({ ok: false, error: { kind: "rate_limited" } });
      expect(yield* ask(() => new Response("{}", { status: 502 }))).toStrictEqual({ ok: false, error: { kind: "unavailable", status: 502 } });
      expect(yield* ask(() => "unreachable")).toStrictEqual({ ok: false, error: { kind: "unavailable" } });
      expect(yield* ask(() => new Response("{oops", { status: 200 }))).toStrictEqual({ ok: false, error: { kind: "invalid_response" } });
      expect(yield* ask(() => Response.json({ choices: [{ message: { content: null, refusal: "No." } }] }))).toStrictEqual({ ok: false, error: { kind: "refused" } });
    }),
  );

  it.effect("decodes embeddings in their order and refuses a count that does not match", () =>
    Effect.gen(function* () {
      const vectors = Response.json({ data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }] });
      const asked: Asked[] = [];
      expect(yield* embedTexts(embedder, ["teeth", "essay"]).pipe(Effect.provide(answering(asked, () => vectors.clone())))).toStrictEqual([
        [1, 0],
        [0, 1],
      ]);
      expect(asked[0]?.body).toStrictEqual({ model: "text-embedding-3-small", input: ["teeth", "essay"], dimensions: 512 });
      expect(yield* asWire(embedTexts(embedder, ["one"])).pipe(Effect.provide(answering([], () => vectors.clone())))).toStrictEqual({
        ok: false,
        error: { kind: "invalid_response" },
      });
    }),
  );
});

describe("the test Layers", () => {
  it.effect("the router gives an attempt for each model whose Provider has a key", () =>
    Effect.gen(function* () {
      const router = yield* AiRouter;
      expect(yield* router.attemptsFor(["opencodeGo/deepseek-v4.1-flash", "openai/gpt-6-luna", "openai/decisions/gpt-6-luna"])).toStrictEqual([
        { model: "openai/gpt-6-luna", key: "sk-fixed" },
        { model: "openai/decisions/gpt-6-luna", key: "sk-fixed" },
      ]);
    }).pipe(Effect.provide(AiRouter.layerTest({ openai: "sk-fixed" }))),
  );

  it.effect("a scripted chat that cannot answer hands over to the next model in the chain", () =>
    Effect.gen(function* () {
      const replies = ["not json", '{"steps":["Draft the outline","Draft the outline"],"project":true}'];
      const answered = yield* askJson([go, openai], stepsAsk(signal), parseSteps).pipe(
        Effect.provide(AiProvider.layerTest({ chat: () => replies.shift() ?? "" })),
      );
      expect(answered).toStrictEqual({ answeredBy: "openai/gpt-6-luna", value: { steps: ["Draft the outline"], project: true } });
    }),
  );

  it.effect("with no attempts at all, nothing is asked and AI is not configured", () =>
    Effect.gen(function* () {
      expect(yield* asWire(askJson([], stepsAsk(signal), parseSteps))).toStrictEqual({ ok: false, error: { kind: "not_configured" } });
    }).pipe(Effect.provide(AiProvider.layerTest({}))),
  );

  it.effect("hands out the scripted language model", () =>
    Effect.gen(function* () {
      const model = new MockLanguageModelV4();
      const provider = yield* AiProvider.pipe(Effect.provide(AiProvider.layerTest({ model })));
      expect(provider.languageModel(openai, "thread")).toBe(model);
    }),
  );
});
