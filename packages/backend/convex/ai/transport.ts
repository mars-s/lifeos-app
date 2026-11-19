import { err, errAsync, ok, ResultAsync, type Result } from "neverthrow";
import { MODELS, PROVIDERS, USER_AGENT, type ModelId } from "../../shared/ai";
import type { AiError } from "./tables";

export type Part = { type: "input_text"; text: string } | { type: "input_json"; data: unknown };

export type Question =
  | { type: "choice"; name: string; instructions: string; choices: { value: string; description: string }[] }
  | { type: "predicate"; name: string; instructions: string };

export type ChoiceAsk = { cacheKey: string; instructions: string; parts: Part[]; questions: Question[] };

export type JsonAsk = { cacheKey: string; instructions: string; parts: Part[]; schemaName: string; schema: Record<string, unknown> };

export type Attempt = { model: ModelId; key: string };

export type Answered<T> = { answeredBy: ModelId; value: T };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

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

const normalised = (choices: readonly { value: string }[], given: unknown) => {
  if (!isRecord(given)) return null;
  const offered = choices.flatMap(({ value }) => {
    const raw = given[value];
    return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? [{ value, weight: raw }] : [];
  });
  const total = offered.reduce((sum, { weight }) => sum + weight, 0);
  if (total <= 0) return null;
  return offered.map(({ value, weight }) => ({ value, probability: weight / total })).toSorted((a, b) => b.probability - a.probability);
};

const answerOf = (question: Question, given: unknown) => {
  if (question.type === "predicate") {
    return typeof given === "number" && Number.isFinite(given) ? { type: "predicate", name: question.name, probability: Math.min(1, Math.max(0, given)) } : null;
  }
  const probabilities = normalised(question.choices, given);
  const best = probabilities?.[0];
  return probabilities && best ? { type: "choice", name: question.name, choice: best.value, confidence: best.probability, probabilities } : null;
};

const contentOf = (body: unknown) => {
  if (!isRecord(body) || !Array.isArray(body.choices)) return err<string, AiError>({ kind: "invalid_response" });
  const first: unknown = body.choices[0];
  const message = isRecord(first) && isRecord(first.message) ? first.message : null;
  if (typeof message?.refusal === "string" && message.refusal !== "") return err<string, AiError>({ kind: "refused" });
  return typeof message?.content === "string" ? ok<string, AiError>(message.content) : err<string, AiError>({ kind: "invalid_response" });
};

const parsedJson = (text: string) => {
  const unfenced = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return ok<unknown, AiError>(JSON.parse(unfenced));
  } catch {
    return err<unknown, AiError>({ kind: "invalid_response" });
  }
};

export const chatJsonOf = (body: unknown) => contentOf(body).andThen(parsedJson);

export const decisionsFromChat = (questions: readonly Question[], model: string, body: unknown) =>
  chatJsonOf(body).andThen((json) => {
    if (!isRecord(json)) return err<unknown, AiError>({ kind: "invalid_response" });
    const answers = questions.map((question) => answerOf(question, json[question.name]));
    return answers.every((answer) => answer !== null) ? ok<unknown, AiError>({ model, answers }) : err<unknown, AiError>({ kind: "invalid_response" });
  });

const failureOf = (response: Response) => {
  if (response.status === 401 || response.status === 403) return { kind: "unauthorised" } satisfies AiError;
  if (response.status === 429) return { kind: "rate_limited" } satisfies AiError;
  return { kind: "unavailable", status: response.status } satisfies AiError;
};

const UNREACHABLE: AiError = { kind: "unavailable" };
const UNREADABLE: AiError = { kind: "invalid_response" };

const sessionOf = (cacheKey: string) => `ses_${cacheKey.replace(/[^a-z0-9]/gi, "")}`;

const post = (attempt: Attempt, path: string, cacheKey: string, body: unknown) => {
  const { provider } = MODELS[attempt.model];
  const headers: Record<string, string> = { authorization: `Bearer ${attempt.key}`, "content-type": "application/json", "user-agent": USER_AGENT };
  if (provider === "opencodeGo") headers["x-opencode-session"] = sessionOf(cacheKey);
  return ResultAsync.fromPromise(
    fetch(`${PROVIDERS[provider].baseUrl}${path}`, { method: "POST", headers, body: JSON.stringify(body) }),
    () => UNREACHABLE,
  ).andThen((response) =>
    response.ok
      ? ResultAsync.fromPromise(response.json() as Promise<unknown>, () => UNREADABLE)
      : errAsync<unknown, AiError>(failureOf(response)),
  );
};

const choiceOnce = (attempt: Attempt, ask: ChoiceAsk) => {
  const { model, transport } = MODELS[attempt.model];
  return transport === "decisions"
    ? post(attempt, "/decisions", ask.cacheKey, decisionsBody(model, ask))
    : post(attempt, "/chat/completions", ask.cacheKey, chatChoiceBody(model, ask)).andThen((body) => decisionsFromChat(ask.questions, model, body));
};

const jsonOnce = (attempt: Attempt, ask: JsonAsk) =>
  post(attempt, "/chat/completions", ask.cacheKey, chatJsonBody(MODELS[attempt.model].model, ask)).andThen(chatJsonOf);

const firstAnswer = async <T>(
  attempts: readonly Attempt[],
  once: (attempt: Attempt) => ResultAsync<unknown, AiError>,
  parse: (body: unknown) => Result<T, AiError>,
) => {
  let last: Result<Answered<T>, AiError> = err({ kind: "not_configured" });
  for (const attempt of attempts) {
    const answer = await once(attempt).andThen((body) => parse(body));
    if (answer.isOk()) return ok<Answered<T>, AiError>({ answeredBy: attempt.model, value: answer.value });
    last = err(answer.error);
  }
  return last;
};

export const askChoice = <T>(attempts: readonly Attempt[], ask: ChoiceAsk, parse: (body: unknown) => Result<T, AiError>) =>
  firstAnswer(attempts, (attempt) => choiceOnce(attempt, ask), parse);

export const askJson = <T>(attempts: readonly Attempt[], ask: JsonAsk, parse: (body: unknown) => Result<T, AiError>) =>
  firstAnswer(attempts, (attempt) => jsonOnce(attempt, ask), parse);
