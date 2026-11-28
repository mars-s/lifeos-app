import { Effect } from "effect";
import { EMBEDDING_DIMENSIONS, MODELS } from "../../shared/ai";
import { AiInvalidResponse } from "./errors";
import { AiProvider, type Attempt } from "./transport";

export const embedTexts = Effect.fn("embeddings.embedTexts")(function* (attempt: Attempt, texts: readonly string[]) {
  const provider = yield* AiProvider;
  const vectors = yield* provider.embeddings(attempt, { model: MODELS[attempt.model].model, input: texts, dimensions: EMBEDDING_DIMENSIONS });
  if (vectors.length !== texts.length) return yield* new AiInvalidResponse();
  return vectors.toSorted((a, b) => a.index - b.index).map((entry) => [...entry.embedding]);
});
