export const EASE_OUT = [0.23, 1, 0.32, 1] as const;
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const;

export const CSS_EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
export const CSS_EASE_IN_OUT = "cubic-bezier(0.77, 0, 0.175, 1)";

export const spring = { type: "spring", duration: 0.3, bounce: 0 } as const;
export const springLift = { type: "spring", duration: 0.28, bounce: 0.12 } as const;
export const springSettle = { type: "spring", duration: 0.45, bounce: 0.22 } as const;
export const springLayout = { type: "spring", duration: 0.4, bounce: 0 } as const;

export const enter = { duration: 0.2, ease: EASE_OUT } as const;
export const exit = { duration: 0.14, ease: EASE_OUT } as const;
export const instant = { duration: 0 } as const;

export const LINGER_MS = 1100;
