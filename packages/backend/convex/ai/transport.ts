import type { LanguageModelV4 } from "@ai-sdk/provider";
import { Context, Effect, Layer, Predicate, Result, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { MODELS, PROVIDERS, USER_AGENT, type ModelId } from "../../shared/ai";
import { AiInvalidResponse, AiNotConfigured, AiRateLimited, AiRefused, AiUnauthorised, AiUnavailable, type AiFailure } from "./errors";
import { languageModelFor } from "./models";

export type Part = { type: "input_text"; text: string } | { type: "input_json"; data: unknown };

export type Question =
  | { type: "choice"; name: string; instructions: string; choices: { value: string; description: string }[] }
  | { type: "predicate"; name: string; instructions: string };

export type ChoiceAsk = { cacheKey: string; instructions: string; parts: Part[]; questions: Question[] };

export type JsonAsk = { cacheKey: string; instructions: string; parts: Part[]; schemaName: string; schema: Record<string, unknown> };

export type Attempt = { model: ModelId; key: string };

export type Answered<T> = { answeredBy: ModelId; value: T };

const CHOICE_RULES =
  "Answer every question in the JSON schema. For a choice question, give each option the probability that it is the right answer, from 0 to 1, adding up to 1. For a yes or no question, give the probability that the answer is yes.";

const partText = (part: Part) => (part.type === "input_text" ? part.text : JSON.stringify(part.data));

const questionText = (question: Question) =>
  question.type === "predicate"
    ? `${question.name} (yes or no): ${question.instructions}`
    : [`${question.name} (choice): ${question.instructions}`, ...question.choices.map(({ value, description }) => `- ${value}: ${description}`)].join("\n");

const strictObject = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const probability = { type: "number", minimum: 0, maximum: 1 };

const choiceSchema = (questions: readonly Question[]) =>
  strictObject(
    Object.fromEntries(
      questions.map((question) => [
        question.name,
        question.type === "predicate" ? probability : strictObject(Object.fromEntries(question.choices.map(({ value }) => [value, probability]))),
      ]),
    ),
  );

export const decisionsBody = (model: string, ask: ChoiceAsk) => ({
  model,
  prompt_cache_key: ask.cacheKey,
  input: [
    { role: "developer", content: ask.instructions },
    { role: "user", content: ask.parts },
  ],
  questions: ask.questions,
});

const chatBody = (model: string, system: string, user: string, schemaName: string, schema: Record<string, unknown>) => ({
  model,
  messages: [
    { role: "system", content: system },
    { role: "user", content: user },
  ],
  response_format: { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } },
});

export const chatChoiceBody = (model: string, ask: ChoiceAsk) =>
  chatBody(
    model,
    `${ask.instructions}\n\n${CHOICE_RULES}`,
    [...ask.parts.map(partText), "Questions:", ...ask.questions.map(questionText)].join("\n\n"),
    "answers",
    choiceSchema(ask.questions),
  );

export const chatJsonBody = (model: string, ask: JsonAsk) => chatBody(model, ask.instructions, ask.parts.map(partText).join("\n\n"), ask.schemaName, ask.schema);

const ChatReply = Schema.Struct({
  choices: Schema.Array(
    Schema.Struct({
      message: Schema.Struct({ content: Schema.optional(Schema.NullOr(Schema.String)), refusal: Schema.optional(Schema.NullOr(Schema.String)) }),
    }),
  ),
});

const Vectors = Schema.Struct({ data: Schema.Array(Schema.Struct({ index: Schema.Number, embedding: Schema.Array(Schema.Number) })) });

const UnknownJson = Schema.fromJsonString(Schema.Unknown);

const decoded = <S extends Schema.Decoder<unknown>>(schema: S, input: unknown) =>
  Result.mapError(Schema.decodeUnknownResult(schema)(input), () => new AiInvalidResponse());

export const chatContentOf = (body: unknown) =>
  Result.flatMap(decoded(ChatReply, body), ({ choices }) => {
    const message = choices[0]?.message;
    if (message?.refusal) return Result.fail<AiFailure>(new AiRefused());
    return Predicate.isString(message?.content) ? Result.succeed(message.content) : Result.fail<AiFailure>(new AiInvalidResponse());
  });

export const jsonOf = (text: string) => decoded(UnknownJson, text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));

const normalised = (choices: readonly { value: string }[], given: unknown) => {
  if (!Predicate.isObject(given)) return null;
  const offered = choices.flatMap(({ value }) => {
    const raw = given[value];
    return Predicate.isNumber(raw) && Number.isFinite(raw) && raw > 0 ? [{ value, weight: raw }] : [];
  });
  const total = offered.reduce((sum, { weight }) => sum + weight, 0);
  if (total <= 0) return null;
  return offered.map(({ value, weight }) => ({ value, probability: weight / total })).toSorted((a, b) => b.probability - a.probability);
};

const answerOf = (question: Question, given: unknown) => {
  if (question.type === "predicate") {
    return Predicate.isNumber(given) && Number.isFinite(given) ? { type: "predicate", name: question.name, probability: Math.min(1, Math.max(0, given)) } : null;
  }
  const probabilities = normalised(question.choices, given);
  const best = probabilities?.[0];
  return probabilities && best ? { type: "choice", name: question.name, choice: best.value, confidence: best.probability, probabilities } : null;
};

const decisionsFromContent = (questions: readonly Question[], model: string, content: string) =>
  Result.flatMap(jsonOf(content), (json) => {
    if (!Predicate.isObject(json)) return Result.fail(new AiInvalidResponse());
    const answers = questions.map((question) => answerOf(question, json[question.name]));
    const read: unknown = { model, answers };
    return answers.every((answer) => answer !== null) ? Result.succeed(read) : Result.fail(new AiInvalidResponse());
  });

export const decisionsFromChat = (questions: readonly Question[], model: string, body: unknown) =>
  Result.flatMap(chatContentOf(body), (content) => decisionsFromContent(questions, model, content));

const refusalFor = (status: number) => {
  if (status === 401 || status === 403) return new AiUnauthorised();
  if (status === 429) return new AiRateLimited();
  return new AiUnavailable({ status });
};

const sessionOf = (cacheKey: string) => `ses_${cacheKey.replace(/[^a-z0-9]/gi, "")}`;

type EmbeddingsBody = { readonly model: string; readonly input: readonly string[]; readonly dimensions: number };

type Script = {
  readonly decisions?: (body: unknown) => unknown;
  readonly chat?: (body: unknown) => string;
  readonly embeddings?: (input: readonly string[]) => readonly (readonly number[])[];
  readonly model?: LanguageModelV4;
};

export class AiProvider extends Context.Service<
  AiProvider,
  {
    decisions(attempt: Attempt, body: unknown, session: string): Effect.Effect<unknown, AiFailure>;
    chat(attempt: Attempt, body: unknown, session: string): Effect.Effect<string, AiFailure>;
    embeddings(attempt: Attempt, body: EmbeddingsBody): Effect.Effect<typeof Vectors.Type.data, AiFailure>;
    languageModel(attempt: Attempt, session: string): LanguageModelV4;
  }
>()("lifeos/ai/AiProvider") {
  static readonly layerNoDeps = Layer.effect(
    AiProvider,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;

      const post = Effect.fn("AiProvider.post")(function* (attempt: Attempt, path: string, body: unknown, session?: string) {
        const { provider } = MODELS[attempt.model];
        const request = HttpClientRequest.post(`${PROVIDERS[provider].baseUrl}${path}`).pipe(
          HttpClientRequest.bearerToken(attempt.key),
          HttpClientRequest.setHeader("user-agent", USER_AGENT),
          HttpClientRequest.setHeaders(provider === "opencodeGo" && session ? { "x-opencode-session": session } : {}),
          HttpClientRequest.bodyJsonUnsafe(body),
        );
        const response = yield* client.execute(request).pipe(Effect.mapError(() => new AiUnavailable({})));
        if (response.status < 200 || response.status > 299) return yield* refusalFor(response.status);
        return yield* response.json.pipe(Effect.mapError(() => new AiInvalidResponse()));
      });

      return AiProvider.of({
        decisions: (attempt, body, session) => post(attempt, "/decisions", body, session),
        chat: (attempt, body, session) => Effect.flatMap(post(attempt, "/chat/completions", body, session), (reply) => Effect.fromResult(chatContentOf(reply))),
        embeddings: Effect.fn("AiProvider.embeddings")(function* (attempt: Attempt, body: EmbeddingsBody) {
          const reply = yield* post(attempt, "/embeddings", body).pipe(
            Effect.tapError((error) => (error._tag === "AiUnavailable" && error.status ? Effect.logWarning("Embeddings refused", error.status) : Effect.void)),
          );
          return (yield* Effect.fromResult(decoded(Vectors, reply))).data;
        }),
        languageModel: languageModelFor,
      });
    }),
  );

  static readonly layer = AiProvider.layerNoDeps.pipe(Layer.provide(FetchHttpClient.layer));

  static readonly layerTest = (script: Script) =>
    Layer.succeed(
      AiProvider,
      AiProvider.of({
        decisions: (_attempt, body) => (script.decisions ? Effect.sync(() => script.decisions?.(body)) : Effect.fail(new AiUnavailable({}))),
        chat: (_attempt, body) => (script.chat ? Effect.sync(() => script.chat?.(body) ?? "") : Effect.fail(new AiUnavailable({}))),
        embeddings: (_attempt, { input }) =>
          script.embeddings
            ? Effect.sync(() => (script.embeddings?.(input) ?? []).map((embedding, index) => ({ index, embedding: [...embedding] })))
            : Effect.fail(new AiUnavailable({})),
        languageModel: () => {
          if (!script.model) throw new Error("This test Layer has no scripted model.");
          return script.model;
        },
      }),
    );
}

const choiceOnce = Effect.fn("transport.choiceOnce")(function* (attempt: Attempt, ask: ChoiceAsk) {
  const provider = yield* AiProvider;
  const { model, transport } = MODELS[attempt.model];
  if (transport === "decisions") return yield* provider.decisions(attempt, decisionsBody(model, ask), sessionOf(ask.cacheKey));
  const content = yield* provider.chat(attempt, chatChoiceBody(model, ask), sessionOf(ask.cacheKey));
  return yield* Effect.fromResult(decisionsFromContent(ask.questions, model, content));
});

const jsonOnce = Effect.fn("transport.jsonOnce")(function* (attempt: Attempt, ask: JsonAsk) {
  const provider = yield* AiProvider;
  const content = yield* provider.chat(attempt, chatJsonBody(MODELS[attempt.model].model, ask), sessionOf(ask.cacheKey));
  return yield* Effect.fromResult(jsonOf(content));
});

const firstAnswer = Effect.fn("transport.firstAnswer")(function* <T, E>(
  attempts: readonly Attempt[],
  once: (attempt: Attempt) => Effect.Effect<unknown, AiFailure, AiProvider>,
  parse: (body: unknown) => Result.Result<T, E>,
) {
  let last: AiFailure | E = new AiNotConfigured();
  for (const attempt of attempts) {
    const answer = yield* Effect.result(Effect.flatMap(once(attempt), (body) => Effect.fromResult(parse(body))));
    if (Result.isSuccess(answer)) {
      const answered: Answered<T> = { answeredBy: attempt.model, value: answer.success };
      return answered;
    }
    last = answer.failure;
  }
  return yield* Effect.fail(last);
});

export const askChoice = <T, E>(attempts: readonly Attempt[], ask: ChoiceAsk, parse: (body: unknown) => Result.Result<T, E>) =>
  firstAnswer(attempts, (attempt) => choiceOnce(attempt, ask), parse);

export const askJson = <T, E>(attempts: readonly Attempt[], ask: JsonAsk, parse: (body: unknown) => Result.Result<T, E>) =>
  firstAnswer(attempts, (attempt) => jsonOnce(attempt, ask), parse);
