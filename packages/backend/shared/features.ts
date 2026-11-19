import { v, type Infer, type Validator } from "convex/values";

export const vTravelMode = v.union(v.literal("drive"), v.literal("walk"), v.literal("cycle"));
export type TravelMode = Infer<typeof vTravelMode>;

export const vPlaceLabel = v.union(v.literal("home"), v.literal("work"), v.literal("uni"));
export type PlaceLabel = Infer<typeof vPlaceLabel>;

export const vSmartEstimatesSettings = v.object({});
export const vPlacesSettings = v.object({ travelMode: vTravelMode });

export type FeatureIcon = "hourglass" | "mapPin";
export type FeatureSecret = "openai";
export type FeatureSetup = "home";

type FeatureSpec<Settings> = {
  readonly title: string;
  readonly summary: string;
  readonly icon: FeatureIcon;
  readonly enabledByDefault: boolean;
  readonly secrets: readonly FeatureSecret[];
  readonly setup: readonly FeatureSetup[];
  readonly settings: Validator<Settings, "required", string>;
  readonly defaultSettings: Settings;
  readonly uses: readonly string[];
};

export const FEATURES = {
  smartEstimates: {
    title: "Smart Estimates",
    summary: "Suggests an Estimate when you open a Task that has none. You choose whether to keep it.",
    icon: "hourglass",
    enabledByDefault: true,
    secrets: ["openai"],
    setup: [],
    settings: vSmartEstimatesSettings,
    defaultSettings: {},
    uses: ["places"],
  },
  places: {
    title: "Places",
    summary: "Finds the nearest shop for an errand, with how far it is and how long it takes to get there.",
    icon: "mapPin",
    enabledByDefault: false,
    secrets: ["openai"],
    setup: ["home"],
    settings: vPlacesSettings,
    defaultSettings: { travelMode: "drive" },
    uses: [],
  },
} as const satisfies {
  smartEstimates: FeatureSpec<Infer<typeof vSmartEstimatesSettings>>;
  places: FeatureSpec<Infer<typeof vPlacesSettings>>;
};

export type FeatureId = keyof typeof FEATURES;
export const FEATURE_IDS = Object.keys(FEATURES) as FeatureId[];
export const vFeatureId = v.union(v.literal("smartEstimates"), v.literal("places"));

export type FeatureSettings = { [K in FeatureId]: Infer<(typeof FEATURES)[K]["settings"]> };
export type FeatureUses<F extends FeatureId> = (typeof FEATURES)[F]["uses"][number];

export const vFeatureChoice = v.union(
  v.object({ feature: v.literal("smartEstimates"), settings: vSmartEstimatesSettings }),
  v.object({ feature: v.literal("places"), settings: vPlacesSettings }),
);

export type FeatureStatus =
  | { readonly kind: "off" }
  | { readonly kind: "ready" }
  | { readonly kind: "needs_key"; readonly secret: FeatureSecret }
  | { readonly kind: "needs_setup"; readonly setup: FeatureSetup };

export const isFeatureId = (value: string): value is FeatureId => FEATURE_IDS.some((id) => id === value);
