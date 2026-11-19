"use client";

import { Hourglass } from "@phosphor-icons/react";
import { useSmartEstimates } from "../smart-estimate";
import { FeatureRow, SettingsGroup } from "./rows";

const SmartEstimatesRow = () => {
  const smart = useSmartEstimates();
  if (!smart.status) return <p className="px-3.5 py-3.5 text-small text-muted-foreground">Loading…</p>;
  return (
    <FeatureRow
      icon={Hourglass}
      label="Smart Estimates"
      hint={
        smart.status.configured
          ? "Suggests an Estimate when you open a Task that has none. You choose whether to keep it."
          : "Not set up on this LifeOS yet. It needs an OpenAI key in Core before it can suggest Estimates."
      }
      checked={smart.status.enabled}
      onCheckedChange={(enabled) => void smart.set(enabled)}
      disabled={!smart.status.configured}
    />
  );
};

export const FeaturesSection = () => (
  <SettingsGroup title="Features" hint="Switch optional parts of LifeOS on or off.">
    <SmartEstimatesRow />
  </SettingsGroup>
);
