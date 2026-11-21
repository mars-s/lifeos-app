"use client";

import { useMemo } from "react";
import { api } from "@lifeos/backend/api";
import { switchFeature, withFeature } from "@lifeos/backend/client/feature-actions";
import { FEATURES, type FeatureId, type FeatureSettings, type FeatureStatus } from "@lifeos/backend/features";
import { useChange } from "../changes";
import { useQuietView } from "../hooks";

export { STATUS_WORDS, type FeatureState } from "@lifeos/backend/client/feature-actions";

export const statusTone = (status: FeatureStatus) => (status.kind === "ready" ? "positive" : status.kind === "off" ? "quiet" : "negative");

export const useFeatureOn = (feature: FeatureId) => {
  const states = useQuietView(api.platform.features.list, {});
  return states?.find((state) => state.feature === feature)?.enabled ?? FEATURES[feature].enabledByDefault;
};

export const useFeatures = () => {
  const states = useQuietView(api.platform.features.list, {});
  const change = useChange();
  return useMemo(
    () => ({
      states,
      of: (feature: FeatureId) => states?.find((state) => state.feature === feature),
      setEnabled: (feature: FeatureId, enabled: boolean) => switchFeature(change, states, feature, enabled),
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
