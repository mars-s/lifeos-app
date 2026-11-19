import { v } from "convex/values";
import { err, ok } from "neverthrow";
import type { ActionCtx, QueryCtx } from "../_generated/server";
import {
  CAPABILITIES,
  CAPABILITY_IDS,
  canAnswer,
  isModelId,
  MODELS,
  modelChain,
  PROVIDER_IDS,
  PROVIDERS,
  routeOf,
  vCapabilityId,
  type CapabilityId,
  type ModelId,
  type ProviderId,
} from "../../shared/ai";
import { ownerQuery } from "../platform/access";
import { changeMutation } from "../platform/change";
import { featureReady, featureState, writeFeature } from "../platform/features";
import { revealSecret, secretAvailable } from "../platform/secrets";
import type { Attempt } from "./transport";

export type RouteError =
  | { readonly kind: "unknown_model"; readonly model: string }
  | { readonly kind: "model_cannot_answer"; readonly model: string }
  | { readonly kind: "switched_elsewhere"; readonly feature: "places" };

const keyedProviders = async (ctx: QueryCtx) => {
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

export const attemptsFor = async (ctx: ActionCtx, chain: readonly ModelId[]) => {
  const keys = new Map<ProviderId, string | undefined>();
  for (const model of chain) {
    const { provider } = MODELS[model];
    if (!keys.has(provider)) keys.set(provider, await revealSecret(ctx, PROVIDERS[provider].secret));
  }
  return chain.flatMap((model) => {
    const key = keys.get(MODELS[model].provider);
    return key ? [{ model, key } satisfies Attempt] : [];
  });
};

export const overview = ownerQuery({
  args: {},
  handler: async (ctx) => {
    const [ai, places, keyed] = await Promise.all([featureState(ctx, "ai"), featureState(ctx, "places"), keyedProviders(ctx)]);
    return {
      keyed: [...keyed],
      capabilities: CAPABILITY_IDS.map((capability) => {
        const route = routeOf(ai.settings, capability);
        const on = CAPABILITIES[capability].switchedBy === "places" ? places.enabled : route.on;
        return { capability, on, model: route.model, answering: modelChain(capability, route.model, keyed)[0] ?? null };
      }),
    };
  },
});

export const setRoute = changeMutation({
  action: "ai.route",
  args: { capability: vCapabilityId, on: v.optional(v.boolean()), model: v.optional(v.string()) },
  handler: async (ctx, { capability, on, model }, record) => {
    const spec = CAPABILITIES[capability];
    if (on !== undefined && spec.switchedBy === "places") return err<{ changed: boolean }, RouteError>({ kind: "switched_elsewhere", feature: "places" });
    const chosen = model === undefined ? undefined : isModelId(model) ? model : null;
    if (chosen === null) return err<{ changed: boolean }, RouteError>({ kind: "unknown_model", model: model ?? "" });
    if (chosen && !canAnswer(chosen, spec.asks)) return err<{ changed: boolean }, RouteError>({ kind: "model_cannot_answer", model: chosen });
    const { settings } = await featureState(ctx, "ai");
    const current = routeOf(settings, capability);
    const routes = { ...settings.routes, [capability]: { on: on ?? current.on, model: chosen ?? current.model } };
    return ok<{ changed: boolean }, RouteError>({ changed: await writeFeature(ctx, record, "ai", { settings: { routes } }) });
  },
});
