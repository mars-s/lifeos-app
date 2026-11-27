import { v } from "convex/values";
import { err, ok } from "neverthrow";
import { CAPABILITIES, CAPABILITY_IDS, canAnswer, isModelId, modelChain, routeOf, vCapabilityId } from "../../shared/ai";
import { ownerQuery } from "../platform/access";
import { changeMutation } from "../platform/change";
import { featureState, writeFeature } from "../platform/features";
import { keyedProviders } from "./capabilities";

export type RouteError =
  | { readonly kind: "unknown_model"; readonly model: string }
  | { readonly kind: "model_cannot_answer"; readonly model: string }
  | { readonly kind: "switched_elsewhere"; readonly feature: "places" };

export const overview = ownerQuery({
  args: {},
  handler: async (ctx) => {
    const [ai, places, keyed] = await Promise.all([featureState(ctx, "ai"), featureState(ctx, "places"), keyedProviders(ctx)]);
    return {
      keyed: [...keyed],
      askFirst: ai.settings.askFirst === true,
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

export const setAskFirst = changeMutation({
  action: "ai.askFirst",
  args: { on: v.boolean() },
  handler: async (ctx, { on }, record) => {
    const { settings } = await featureState(ctx, "ai");
    return ok<{ changed: boolean }, never>({ changed: await writeFeature(ctx, record, "ai", { settings: { ...settings, askFirst: on } }) });
  },
});
