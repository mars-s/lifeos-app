import {
  ImpactFeedbackStyle,
  NotificationFeedbackType,
  impactAsync,
  notificationAsync,
  selectionAsync,
} from "expo-haptics";

export type Haptic = "snap" | "drop" | "complete" | "error" | "toggle";

const PLAY = {
  snap: () => selectionAsync(),
  toggle: () => impactAsync(ImpactFeedbackStyle.Light),
  drop: () => impactAsync(ImpactFeedbackStyle.Medium),
  complete: () => notificationAsync(NotificationFeedbackType.Success),
  error: () => notificationAsync(NotificationFeedbackType.Error),
} satisfies Record<Haptic, () => Promise<void>>;

export const haptic = (kind: Haptic) => {
  PLAY[kind]().catch(() => undefined);
};
