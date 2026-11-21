import { Easing } from "react-native-reanimated";

export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

export const PRESS_MS = 120;
export const FAST_MS = 160;
export const BASE_MS = 220;
export const SLOW_MS = 320;
export const LINGER_MS = 1100;

export const SPRING = { duration: 400, dampingRatio: 1 } as const;
export const SPRING_SETTLE = { duration: 400, dampingRatio: 0.8 } as const;
