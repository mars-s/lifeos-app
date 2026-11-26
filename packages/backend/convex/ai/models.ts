import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { MODELS, PROVIDERS, USER_AGENT } from "../../shared/ai";
import type { Attempt } from "./transport";

export const languageModelFor = (attempt: Attempt, session: string) => {
  const { provider, model } = MODELS[attempt.model];
  return createOpenAICompatible({
    name: provider,
    baseURL: PROVIDERS[provider].baseUrl,
    apiKey: attempt.key,
    includeUsage: true,
    headers: { "user-agent": USER_AGENT, ...(provider === "opencodeGo" ? { "x-opencode-session": `ses_${session.replace(/[^a-z0-9]/gi, "")}` } : {}) },
  }).chatModel(model);
};
