import { err, ok } from "neverthrow";
import { EMBEDDING_DIMENSIONS, MODELS, PROVIDERS, USER_AGENT } from "../../shared/ai";
import type { AiError } from "./tables";
import type { Attempt } from "./transport";

const isVectors = (body: unknown): body is { data: { index: number; embedding: number[] }[] } =>
  typeof body === "object" && body !== null && "data" in body && Array.isArray(body.data);

export const embedTexts = async (attempt: Attempt, texts: readonly string[]) => {
  const { provider, model } = MODELS[attempt.model];
  const response = await fetch(`${PROVIDERS[provider].baseUrl}/embeddings`, {
    method: "POST",
    headers: { authorization: `Bearer ${attempt.key}`, "content-type": "application/json", "user-agent": USER_AGENT },
    body: JSON.stringify({ model, input: texts, dimensions: EMBEDDING_DIMENSIONS }),
  }).catch(() => null);
  if (!response) return err<number[][], AiError>({ kind: "unavailable" });
  if (response.status === 401 || response.status === 403) return err<number[][], AiError>({ kind: "unauthorised" });
  if (response.status === 429) return err<number[][], AiError>({ kind: "rate_limited" });
  if (!response.ok) return err<number[][], AiError>({ kind: "unavailable", status: response.status });
  const body: unknown = await response.json().catch(() => null);
  if (!isVectors(body) || body.data.length !== texts.length) return err<number[][], AiError>({ kind: "invalid_response" });
  return ok<number[][], AiError>(body.data.toSorted((a, b) => a.index - b.index).map((entry) => entry.embedding));
};
