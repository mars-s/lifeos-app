import { v } from "convex/values";
import { Context, Effect, Layer } from "effect";
import { CAPABILITIES, CAPABILITY_IDS, canAnswer, isModelId, modelChain, routeOf, vCapabilityId, type AiSettings, type ModelId } from "../../shared/ai";
import { changeMutation, ownerQuery, Reads, reading, recording } from "../platform/effect";
import { featureState, writeFeature } from "../platform/features";
import { Secrets } from "../platform/secrets";
import type { SecretName } from "../platform/tables";
import { keyedAttempts, keyedProviders } from "./capabilities";
import { ModelCannotAnswer, SwitchedElsewhere, UnknownModel } from "./errors";
import type { Attempt } from "./transport";

export type RouteError =
  | { readonly kind: "unknown_model"; readonly model: string }
  | { readonly kind: "model_cannot_answer"; readonly model: string }
  | { readonly kind: "switched_elsewhere"; readonly feature: "places" };

export class AiRouter extends Context.Service<
  AiRouter,
  { attemptsFor(chain: readonly ModelId[]): Effect.Effect<ReadonlyArray<Attempt>> }
>()("lifeos/ai/AiRouter") {
  static readonly layerNoDeps = Layer.effect(
    AiRouter,
    Effect.gen(function* () {
      const secrets = yield* Secrets;
      return AiRouter.of({ attemptsFor: (chain) => keyedAttempts(chain).pipe(Effect.provideService(Secrets, secrets)) });
    }),
  );

  static readonly layer = AiRouter.layerNoDeps.pipe(Layer.provide(Secrets.layer));

  static readonly layerTest = (keys: Partial<Record<SecretName, string>>) => AiRouter.layerNoDeps.pipe(Layer.provide(Secrets.layerTest(keys)));
}

export const overview = ownerQuery({
  args: {},
  handler: () =>
    reading(async (ctx) => {
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
    }),
});

const writeAiSettings = Effect.fn("routing.writeAiSettings")(function* (settings: AiSettings) {
  const ctx = yield* Reads;
  return { changed: yield* recording((record) => writeFeature(ctx, record, "ai", { settings })) };
});

const aiSettings = reading(async (ctx) => (await featureState(ctx, "ai")).settings);

export const setRoute = changeMutation({
  action: "ai.route",
  args: { capability: vCapabilityId, on: v.optional(v.boolean()), model: v.optional(v.string()) },
  handler: Effect.fn("routing.setRoute")(function* ({ capability, on, model }) {
    const spec = CAPABILITIES[capability];
    if (on !== undefined && spec.switchedBy === "places") return yield* new SwitchedElsewhere({ feature: "places" });
    const chosen = model === undefined ? undefined : isModelId(model) ? model : null;
    if (chosen === null) return yield* new UnknownModel({ model: model ?? "" });
    if (chosen && !canAnswer(chosen, spec.asks)) return yield* new ModelCannotAnswer({ model: chosen });
    const settings = yield* aiSettings;
    const current = routeOf(settings, capability);
    return yield* writeAiSettings({ routes: { ...settings.routes, [capability]: { on: on ?? current.on, model: chosen ?? current.model } } });
  }),
});

export const setAskFirst = changeMutation({
  action: "ai.askFirst",
  args: { on: v.boolean() },
  handler: Effect.fn("routing.setAskFirst")(function* ({ on }) {
    return yield* writeAiSettings({ ...(yield* aiSettings), askFirst: on });
  }),
});
