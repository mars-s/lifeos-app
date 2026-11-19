import { FEATURE_IDS } from "@lifeos/backend/features";

export default async function FeatureSettingsRoute() {
  return null;
}

export const getConfig = async () => ({ render: "static", staticPaths: FEATURE_IDS }) as const;
