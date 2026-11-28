import { Effect, Option, Redacted } from "effect";
import type { ActionCtx, QueryCtx } from "../_generated/server";
import { CAPABILITIES, MODELS, modelChain, PROVIDER_IDS, PROVIDERS, routeOf, type CapabilityId, type ModelId, type ProviderId } from "../../shared/ai";
import { Acts, runAtEdge } from "../platform/effect";
import { featureReady, featureState } from "../platform/features";
import { secretAvailable, Secrets } from "../platform/secrets";
import type { Attempt } from "./transport";

export const keyedProviders = async (ctx: QueryCtx) => {
  const keyed = await Promise.all(PROVIDER_IDS.map(async (provider) => ((await secretAvailable(ctx, PROVIDERS[provider].secret)) ? [provider] : [])));
  return new Set<ProviderId>(keyed.flat());
};

const capabilityOn = async (ctx: QueryCtx, capability: CapabilityId) => {
  const ai = await featureState(ctx, "ai");
  if (ai.status.kind !== "ready") return false;
  return CAPABILITIES[capability].switchedBy === "places" ? featureReady(ctx, "places") : routeOf(ai.settings, capability).on;
};

export const capabilityChain = async (ctx: QueryCtx, capability: CapabilityId) => {
  if (!(await capabilityOn(ctx, capability))) return [];
  const [ai, keyed] = await Promise.all([featureState(ctx, "ai"), keyedProviders(ctx)]);
  return modelChain(capability, routeOf(ai.settings, capability).model, keyed);
};

export const capabilityReady = async (ctx: QueryCtx, capability: CapabilityId) => (await capabilityChain(ctx, capability)).length > 0;

export const keyedAttempts = Effect.fn("capabilities.keyedAttempts")(function* (chain: readonly ModelId[]) {
  const secrets = yield* Secrets;
  const keys = new Map<ProviderId, string | undefined>();
  for (const model of chain) {
    const { provider } = MODELS[model];
    if (!keys.has(provider)) keys.set(provider, Option.getOrUndefined(Option.map(yield* secrets.reveal(PROVIDERS[provider].secret), Redacted.value)));
  }
  return chain.flatMap((model) => {
    const key = keys.get(MODELS[model].provider);
    return key ? [{ model, key } satisfies Attempt] : [];
  });
});

export const attemptsFor = (ctx: ActionCtx, chain: readonly ModelId[]) =>
  runAtEdge(keyedAttempts(chain).pipe(Effect.provide(Secrets.layer), Effect.provideService(Acts, ctx)));
