"use client";

import type { OptimisticLocalStore } from "convex/browser";
import { useMemo } from "react";
import { api } from "@lifeos/backend/api";
import { FEATURES, type FeatureId, type FeatureSettings, type FeatureStatus } from "@lifeos/backend/features";
import { useChange } from "../changes";
import { useQuietView } from "../hooks";

export type FeatureState = { feature: FeatureId; enabled: boolean; settings: FeatureSettings[FeatureId]; status: FeatureStatus };

export const STATUS_WORDS = {
  off: () => "Off",
  ready: () => "On",
  needs_key: () => "Needs an OpenAI key",
  needs_setup: () => "Needs your home address",
} satisfies { [K in FeatureStatus["kind"]]: () => string };

export const statusTone = (status: FeatureStatus) => (status.kind === "ready" ? "positive" : status.kind === "off" ? "quiet" : "negative");

const withFeature = (feature: FeatureId, change: (state: FeatureState) => FeatureState) => (store: OptimisticLocalStore) => {
  const states = store.getQuery(api.platform.features.list, {});
  if (states) store.setQuery(api.platform.features.list, {}, states.map((state) => (state.feature === feature ? change(state) : state)));
};

const WHEN_OFF = {
  smartEstimates: (store: OptimisticLocalStore) => {
    for (const { args } of store.getAllQueries(api.planner.smartEstimates.forTask)) store.setQuery(api.planner.smartEstimates.forTask, args, { kind: "presets" });
  },
  places: (store: OptimisticLocalStore) => {
    for (const { args } of store.getAllQueries(api.places.trips.forTask)) store.setQuery(api.places.trips.forTask, args, null);
  },
} satisfies Record<FeatureId, (store: OptimisticLocalStore) => void>;

const switched = (enabled: boolean, before: FeatureStatus) =>
  enabled ? (before.kind === "off" ? ({ kind: "ready" } as const) : before) : ({ kind: "off" } as const);

export const useFeatures = () => {
  const states = useQuietView(api.platform.features.list, {});
  const change = useChange();
  return useMemo(
    () => ({
      states,
      of: (feature: FeatureId) => states?.find((state) => state.feature === feature),
      setEnabled: (feature: FeatureId, enabled: boolean) => {
        const before = states?.find((state) => state.feature === feature);
        return change({
          title: `${FEATURES[feature].title} ${enabled ? "on" : "off"}`,
          mutation: api.platform.features.setEnabled,
          args: { feature, enabled },
          apply: (store) => {
            withFeature(feature, (state) => ({ ...state, enabled, status: switched(enabled, state.status) }))(store);
            if (!enabled) WHEN_OFF[feature](store);
          },
          revert: withFeature(feature, (state) => (before ? { ...state, enabled: before.enabled, status: before.status } : state)),
        });
      },
      setTravelMode: (travelMode: FeatureSettings["places"]["travelMode"]) => {
        const before = states?.find((state) => state.feature === "places")?.settings;
        return change({
          title: "Travel Mode changed",
          mutation: api.platform.features.configure,
          args: { choice: { feature: "places", settings: { travelMode } } },
          apply: withFeature("places", (state) => ({ ...state, settings: { travelMode } })),
          revert: withFeature("places", (state) => (before ? { ...state, settings: before } : state)),
        });
      },
    }),
    [change, states],
  );
};
