"use client";

import { CaretUpDown, Check, Key, MapPin, Hourglass, ListChecks, type Icon } from "@phosphor-icons/react";
import type { OptimisticLocalStore } from "convex/browser";
import type { FunctionReturnType } from "convex/server";
import { api } from "@lifeos/backend/api";
import { CAPABILITIES, costLine, MODELS, modelsFor, PROVIDER_IDS, PROVIDERS, type CapabilityId, type ModelId } from "@lifeos/backend/ai";
import { Menu, type MenuGroup } from "@/components/ui/action-menu";
import { Switch } from "@/components/ui/choice-controls";
import { useChange } from "../changes";
import { useQuietView } from "../hooks";
import { useFeatures } from "./feature-state";
import { ProviderKey } from "./provider-keys";
import { SettingsGroup, SettingsRow } from "./rows";

type Overview = FunctionReturnType<typeof api.ai.routing.overview>;
type CapabilityState = Overview["capabilities"][number];

const CAPABILITY_ICONS = { smartEstimates: Hourglass, breakIntoSteps: ListChecks, tripDetection: MapPin } satisfies Record<CapabilityId, Icon>;

const PROVIDER_HINTS = {
  openai: "Runs the Decisions API, the cheapest way to get Smart Estimates and trip detection.",
  opencodeGo: "Cheap open models for everyday asks, such as Break into steps.",
} as const;

const withRoute = (capability: CapabilityId, change: (state: CapabilityState) => CapabilityState) => (store: OptimisticLocalStore) => {
  const overview = store.getQuery(api.ai.routing.overview, {});
  if (!overview) return;
  store.setQuery(api.ai.routing.overview, {}, {
    ...overview,
    capabilities: overview.capabilities.map((state) => (state.capability === capability ? change(state) : state)),
  });
};

const useRoutes = () => {
  const change = useChange();
  return {
    setOn: (state: CapabilityState, on: boolean) =>
      change({
        title: `${CAPABILITIES[state.capability].title} ${on ? "on" : "off"}`,
        mutation: api.ai.routing.setRoute,
        args: { capability: state.capability, on },
        apply: withRoute(state.capability, (current) => ({ ...current, on })),
        revert: withRoute(state.capability, (current) => ({ ...current, on: state.on })),
      }),
    setModel: (state: CapabilityState, model: ModelId) =>
      change({
        title: "Model changed",
        mutation: api.ai.routing.setRoute,
        args: { capability: state.capability, model },
        apply: withRoute(state.capability, (current) => ({ ...current, model, answering: model })),
        revert: withRoute(state.capability, (current) => ({ ...current, model: state.model, answering: state.answering })),
      }),
  };
};

const modelGroups = (state: CapabilityState, keyed: ReadonlySet<(typeof PROVIDER_IDS)[number]>, pick: (model: ModelId) => void) =>
  PROVIDER_IDS.flatMap((provider) => {
    const models = modelsFor(state.capability, keyed).filter((model) => MODELS[model].provider === provider);
    return models.length === 0
      ? []
      : [
          {
            id: provider,
            label: PROVIDERS[provider].title,
            items: models.map((model) =>
              state.answering === model
                ? { id: model, label: MODELS[model].title, icon: Check, description: "In use" }
                : { id: model, label: MODELS[model].title, leading: <span aria-hidden="true" className="size-4" />, onSelect: () => pick(model) },
            ),
          } satisfies MenuGroup,
        ];
  });

const ModelPicker = ({ state, keyed }: { state: CapabilityState; keyed: ReadonlySet<(typeof PROVIDER_IDS)[number]> }) => {
  const routes = useRoutes();
  const answering = state.answering;
  if (!answering) return <p className="text-small text-pretty text-faint-foreground">Add a key above to pick a model.</p>;
  const model = MODELS[answering];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <Menu
        align="start"
        groups={modelGroups(state, keyed, (picked) => void routes.setModel(state, picked))}
        trigger={
          <button
            type="button"
            aria-label={`Model for ${CAPABILITIES[state.capability].title}: ${model.title} on ${PROVIDERS[model.provider].title}`}
            className="inline-flex h-8 items-center gap-2 rounded-lg bg-foreground/[0.05] pr-2 pl-2.5 text-small transition-[background-color,scale] duration-(--dur-fast) ease-out outline-none hover:bg-foreground/[0.08] focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.97]"
          >
            <span translate="no" className="font-medium">
              {model.title}
            </span>
            <span translate="no" className="text-muted-foreground">
              {PROVIDERS[model.provider].title}
            </span>
            <CaretUpDown weight="bold" className="size-3.5 text-faint-foreground" aria-hidden="true" />
          </button>
        }
      />
      <p className="text-small text-pretty text-muted-foreground tabular-nums">{costLine(state.capability, answering)}</p>
    </div>
  );
};

const CapabilityRow = ({ state, keyed }: { state: CapabilityState; keyed: ReadonlySet<(typeof PROVIDER_IDS)[number]> }) => {
  const routes = useRoutes();
  const features = useFeatures();
  const spec = CAPABILITIES[state.capability];
  const byPlaces = spec.switchedBy === "places";
  return (
    <SettingsRow
      icon={CAPABILITY_ICONS[state.capability]}
      label={spec.title}
      hint={byPlaces ? `${spec.summary} It is on while Places is on.` : spec.summary}
      below={state.on ? <ModelPicker state={state} keyed={keyed} /> : null}
    >
      <Switch
        aria-label={byPlaces ? "Places" : spec.title}
        checked={state.on}
        onCheckedChange={(on) => void (byPlaces ? features.setEnabled("places", on) : routes.setOn(state, on))}
      />
    </SettingsRow>
  );
};

export const AiSettings = () => {
  const overview = useQuietView(api.ai.routing.overview, {});
  const keyed = new Set(overview?.keyed ?? []);
  return (
    <>
      <SettingsGroup title="Keys" hint="Either key is enough. LifeOS checks a key with its provider before keeping it, seals it, and never shows it again.">
        {PROVIDER_IDS.map((provider) => (
          <SettingsRow
            key={provider}
            icon={Key}
            label={PROVIDERS[provider].title}
            hint={PROVIDER_HINTS[provider]}
            below={
              <div className="grid gap-2">
                <ProviderKey provider={provider} />
                {provider === "opencodeGo" && (
                  <p className="text-small text-pretty text-faint-foreground">
                    OpenCode built Go for coding agents. It asks apps that call it to name themselves and keep a steady session, and it watches for heavy use. LifeOS
                    names itself, keeps one session per job, and only asks small questions when you edit a Task.
                  </p>
                )}
              </div>
            }
          />
        ))}
      </SettingsGroup>
      <SettingsGroup title="What AI does" hint="Each job runs on the model you pick. If that model fails, the default answers, then a cheap fallback.">
        {overview ? (
          overview.capabilities.map((state) => <CapabilityRow key={state.capability} state={state} keyed={keyed} />)
        ) : (
          <p className="px-3.5 py-3.5 text-small text-muted-foreground">Loading…</p>
        )}
      </SettingsGroup>
    </>
  );
};
