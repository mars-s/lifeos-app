import { requireOptionalNativeModule } from "expo";

type LifeOSWidgetsModule = {
  writeSnapshot: (json: string) => void;
  setToken: (token: string | null) => boolean;
  pendingTicks: () => string[];
  clearTicks: (taskIds: string[]) => void;
  takeRoute: () => string | null;
  syncFocus: (json: string | null) => Promise<void>;
};

export const widgets = requireOptionalNativeModule<LifeOSWidgetsModule>("LifeOSWidgets");
