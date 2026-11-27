import { v, type Infer } from "convex/values";

export const USER_AGENT = "LifeOS/1.0 (personal planner)";

export type ProviderSecret = "openai" | "opencodeGo";

export type Transport = "decisions" | "chat" | "embeddings";

export type Answer = "choice" | "json" | "tools" | "embeddings";

export const EMBEDDING_DIMENSIONS = 512;

type ProviderSpec = {
  readonly title: string;
  readonly secret: ProviderSecret;
  readonly baseUrl: string;
  readonly keyCheckUrl: string;
  readonly allowance: boolean;
};

export const PROVIDERS = {
  openai: {
    title: "OpenAI",
    secret: "openai",
    baseUrl: "https://api.openai.com/v1",
    keyCheckUrl: "https://api.openai.com/v1/models",
    allowance: false,
  },
  opencodeGo: {
    title: "OpenCode Go",
    secret: "opencodeGo",
    baseUrl: "https://opencode.ai/inference/go/openai/v1",
    keyCheckUrl: "https://opencode.ai/inference/go/v1/models",
    allowance: true,
  },
} as const satisfies Record<string, ProviderSpec>;

export type ProviderId = keyof typeof PROVIDERS;
export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

type ModelSpec = {
  readonly provider: ProviderId;
  readonly model: string;
  readonly title: string;
  readonly transport: Transport;
  readonly answers: readonly Answer[];
  readonly price: { readonly input: number; readonly output: number };
};

export const MODELS = {
  "openai/decisions/gpt-6-luna": {
    provider: "openai",
    model: "gpt-6-luna",
    title: "GPT-6 Luna, Decisions API",
    transport: "decisions",
    answers: ["choice"],
    price: { input: 0.1, output: 0 },
  },
  "openai/gpt-6-luna": {
    provider: "openai",
    model: "gpt-6-luna",
    title: "GPT-6 Luna",
    transport: "chat",
    answers: ["choice", "json", "tools"],
    price: { input: 0.1, output: 0.5 },
  },
  "openai/gpt-6.1-terra": {
    provider: "openai",
    model: "gpt-6.1-terra",
    title: "GPT-6.1 Terra",
    transport: "chat",
    answers: ["choice", "json", "tools"],
    price: { input: 1, output: 5 },
  },
  "opencodeGo/deepseek-v4.1-flash": {
    provider: "opencodeGo",
    model: "deepseek-v4.1-flash",
    title: "DeepSeek V4.1 Flash",
    transport: "chat",
    answers: ["choice", "json", "tools"],
    price: { input: 0.15, output: 0.6 },
  },
  "opencodeGo/glm-5.3-flash": {
    provider: "opencodeGo",
    model: "glm-5.3-flash",
    title: "GLM-5.3 Flash",
    transport: "chat",
    answers: ["choice", "json", "tools"],
    price: { input: 0.15, output: 0.5 },
  },
  "opencodeGo/gpt-6-luna": {
    provider: "opencodeGo",
    model: "gpt-6-luna",
    title: "GPT-6 Luna",
    transport: "chat",
    answers: ["choice", "json", "tools"],
    price: { input: 0.1, output: 0.5 },
  },
  "opencodeGo/glm-5.3": {
    provider: "opencodeGo",
    model: "glm-5.3",
    title: "GLM-5.3",
    transport: "chat",
    answers: ["choice", "json", "tools"],
    price: { input: 1.4, output: 4.4 },
  },
  "openai/text-embedding-3-small": {
    provider: "openai",
    model: "text-embedding-3-small",
    title: "Text Embedding 3 Small",
    transport: "embeddings",
    answers: ["embeddings"],
    price: { input: 0.02, output: 0 },
  },
} as const satisfies Record<string, ModelSpec>;

export type ModelId = keyof typeof MODELS;
export const MODEL_IDS = Object.keys(MODELS) as ModelId[];
export const isModelId = (value: string): value is ModelId => MODEL_IDS.some((id) => id === value);

type CapabilitySpec = {
  readonly title: string;
  readonly summary: string;
  readonly asks: Answer;
  readonly defaultModel: ModelId;
  readonly fallbackModel: ModelId;
  readonly onByDefault: boolean;
  readonly switchedBy: "ai" | "places";
  readonly tokens: { readonly input: number; readonly output: number };
  readonly per: string;
};

export const CAPABILITIES = {
  smartEstimates: {
    title: "Smart Estimates",
    summary: "Guesses an Estimate when you open a Task that has none.",
    asks: "choice",
    defaultModel: "openai/decisions/gpt-6-luna",
    fallbackModel: "opencodeGo/deepseek-v4.1-flash",
    onByDefault: true,
    switchedBy: "ai",
    tokens: { input: 900, output: 250 },
    per: "Tasks",
  },
  breakIntoSteps: {
    title: "Break into steps",
    summary: "Suggests Checklist Items for a Task. You edit them before they are added.",
    asks: "json",
    defaultModel: "opencodeGo/deepseek-v4.1-flash",
    fallbackModel: "openai/gpt-6-luna",
    onByDefault: true,
    switchedBy: "ai",
    tokens: { input: 450, output: 300 },
    per: "breakdowns",
  },
  tripDetection: {
    title: "Trip detection",
    summary: "Spots a Task that means going somewhere, for Places.",
    asks: "choice",
    defaultModel: "openai/decisions/gpt-6-luna",
    fallbackModel: "opencodeGo/deepseek-v4.1-flash",
    onByDefault: true,
    switchedBy: "places",
    tokens: { input: 350, output: 150 },
    per: "Tasks",
  },
  agent: {
    title: "LifeOS AI",
    summary: "Answers Cmd+J on a Task and does the runs you start, through the same changes you make, each one undoable.",
    asks: "tools",
    defaultModel: "openai/gpt-6-luna",
    fallbackModel: "opencodeGo/deepseek-v4.1-flash",
    onByDefault: true,
    switchedBy: "ai",
    tokens: { input: 6000, output: 500 },
    per: "answers",
  },
  searchIndex: {
    title: "Search index",
    summary: "Turns Tasks, Projects and Areas into vectors so Cmd+J finds what is related. Search by words works without it.",
    asks: "embeddings",
    defaultModel: "openai/text-embedding-3-small",
    fallbackModel: "openai/text-embedding-3-small",
    onByDefault: true,
    switchedBy: "ai",
    tokens: { input: 120, output: 0 },
    per: "changes",
  },
} as const satisfies Record<string, CapabilitySpec>;

export type CapabilityId = keyof typeof CAPABILITIES;
export const CAPABILITY_IDS = Object.keys(CAPABILITIES) as CapabilityId[];
export const vCapabilityId = v.union(v.literal("smartEstimates"), v.literal("breakIntoSteps"), v.literal("tripDetection"), v.literal("agent"), v.literal("searchIndex"));

export const vRoute = v.object({ on: v.boolean(), model: v.string() });
export const vAiSettings = v.object({ routes: v.record(v.string(), vRoute), askFirst: v.optional(v.boolean()) });
export type AiSettings = Infer<typeof vAiSettings>;
export const DEFAULT_AI_SETTINGS: AiSettings = { routes: {} };

export type Route = { readonly on: boolean; readonly model: ModelId };

export const canAnswer = (model: ModelId, asks: Answer) => (MODELS[model].answers as readonly Answer[]).includes(asks);

export const routeOf = (settings: AiSettings, capability: CapabilityId) => {
  const spec = CAPABILITIES[capability];
  const stored = settings.routes[capability];
  const model = stored && isModelId(stored.model) && canAnswer(stored.model, spec.asks) ? stored.model : spec.defaultModel;
  return { on: stored?.on ?? spec.onByDefault, model } satisfies Route;
};

export const modelChain = (capability: CapabilityId, chosen: ModelId, keyed: ReadonlySet<ProviderId>) => {
  const { asks, defaultModel, fallbackModel } = CAPABILITIES[capability];
  return [...new Set([chosen, defaultModel, fallbackModel])].filter((model) => keyed.has(MODELS[model].provider) && canAnswer(model, asks));
};

export const modelsFor = (capability: CapabilityId, keyed: ReadonlySet<ProviderId>) =>
  MODEL_IDS.filter((model) => keyed.has(MODELS[model].provider) && canAnswer(model, CAPABILITIES[capability].asks));

const cents = new Intl.NumberFormat("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const usd = (amount: number) => (amount < 0.01 ? "under US$0.01" : `US$${cents.format(amount)}`);

export const costPerThousand = (capability: CapabilityId, model: ModelId) => {
  const { tokens } = CAPABILITIES[capability];
  const { price, transport } = MODELS[model];
  const output = transport === "decisions" ? 0 : tokens.output;
  return ((tokens.input * price.input + output * price.output) / 1_000_000) * 1000;
};

export const costLine = (capability: CapabilityId, model: ModelId) => {
  const per = `About ${usd(costPerThousand(capability, model))} per 1,000 ${CAPABILITIES[capability].per}`;
  return PROVIDERS[MODELS[model].provider].allowance ? `${per}, from your OpenCode Go allowance.` : `${per}.`;
};
