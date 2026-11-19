import { v, type Infer, type Validator } from "convex/values";
import { DEFAULT_AI_SETTINGS, vAiSettings, type AiSettings, type ProviderSecret } from "./ai";

export const vTravelMode = v.union(v.literal("drive"), v.literal("walk"), v.literal("cycle"));
export type TravelMode = Infer<typeof vTravelMode>;

export const vPlaceLabel = v.union(v.literal("home"), v.literal("work"), v.literal("uni"));
export type PlaceLabel = Infer<typeof vPlaceLabel>;

export const vPlacesSettings = v.object({ travelMode: vTravelMode });
export const vTemplatesSettings = v.object({});

export type FeatureIcon = "sparkle" | "mapPin" | "stamp";
export type FeatureSecret = ProviderSecret;
export type FeatureSetup = "home";

type FeatureSpec<Settings> = {
  readonly title: string;
  readonly summary: string;
  readonly icon: FeatureIcon;
  readonly enabledByDefault: boolean;
  readonly keys: readonly FeatureSecret[];
  readonly requires: readonly string[];
  readonly setup: readonly FeatureSetup[];
  readonly settings: Validator<Settings, "required", string>;
  readonly defaultSettings: Settings;
  readonly uses: readonly string[];
};

export const FEATURES = {
  ai: {
    title: "AI",
    summary: "Smart Estimates, steps for big Tasks and trip detection, on the models you pick. Nothing is sent while it is off.",
    icon: "sparkle",
    enabledByDefault: false,
    keys: ["openai", "opencodeGo"],
    requires: [],
    setup: [],
    settings: vAiSettings,
    defaultSettings: DEFAULT_AI_SETTINGS,
    uses: ["places"],
  },
  places: {
    title: "Places",
    summary: "Finds the nearest shop for an errand, with how far it is and how long it takes to get there.",
    icon: "mapPin",
    enabledByDefault: false,
    keys: [],
    requires: ["ai"],
    setup: ["home"],
    settings: vPlacesSettings,
    defaultSettings: { travelMode: "drive" },
    uses: [],
  },
  templates: {
    title: "Templates",
    summary: "Saved Task shapes you start new Tasks from.",
    icon: "stamp",
    enabledByDefault: true,
    keys: [],
    requires: [],
    setup: [],
    settings: vTemplatesSettings,
    defaultSettings: {},
    uses: [],
  },
} as const satisfies {
  ai: FeatureSpec<AiSettings>;
  places: FeatureSpec<Infer<typeof vPlacesSettings>>;
  templates: FeatureSpec<Infer<typeof vTemplatesSettings>>;
};

export type FeatureId = keyof typeof FEATURES;
export const FEATURE_IDS = Object.keys(FEATURES) as FeatureId[];
export const vFeatureId = v.union(v.literal("ai"), v.literal("places"), v.literal("templates"));

export type FeatureSettings = { [K in FeatureId]: Infer<(typeof FEATURES)[K]["settings"]> };
export type FeatureUses<F extends FeatureId> = (typeof FEATURES)[F]["uses"][number];

export const vFeatureRow = v.union(
  v.object({ feature: v.literal("ai"), enabled: v.boolean(), settings: vAiSettings }),
  v.object({ feature: v.literal("places"), enabled: v.boolean(), settings: vPlacesSettings }),
  v.object({ feature: v.literal("templates"), enabled: v.boolean(), settings: vTemplatesSettings }),
);

export const vFeatureChoice = v.union(
  v.object({ feature: v.literal("ai"), settings: vAiSettings }),
  v.object({ feature: v.literal("places"), settings: vPlacesSettings }),
  v.object({ feature: v.literal("templates"), settings: vTemplatesSettings }),
);

export type FeatureStatus =
  | { readonly kind: "off" }
  | { readonly kind: "ready" }
  | { readonly kind: "needs_key" }
  | { readonly kind: "needs_feature"; readonly feature: FeatureId }
  | { readonly kind: "needs_setup"; readonly setup: FeatureSetup };

export const isFeatureId = (value: string): value is FeatureId => FEATURE_IDS.some((id) => id === value);
