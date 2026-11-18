export const MINUTE_MS = 60_000;
export const MAX_FOCUS_MINUTES = 24 * 60;
export const MAX_EXTEND_MINUTES = 120;
export const DEFAULT_POMODORO = { focusMinutes: 25, breakMinutes: 5 } as const;

export type FocusState =
  | { readonly kind: "running" }
  | { readonly kind: "paused"; readonly at: number }
  | { readonly kind: "ended"; readonly at: number };

export type FocusClock = {
  readonly start: number;
  readonly pausedMs: number;
  readonly plannedMinutes?: number;
  readonly state: FocusState;
};

export type FocusPlan =
  | { readonly kind: "open" }
  | { readonly kind: "pomodoro"; readonly focusMinutes: number; readonly breakMinutes: number };

export const plannedMs = (clock: FocusClock) =>
  clock.plannedMinutes === undefined ? undefined : clock.plannedMinutes * MINUTE_MS;

const workedMs = (clock: FocusClock, now: number) =>
  Math.max(0, (clock.state.kind === "running" ? now : clock.state.at) - clock.start - clock.pausedMs);

export const overtimeMs = (clock: FocusClock, now: number) => {
  const planned = plannedMs(clock);
  return planned === undefined ? 0 : Math.max(0, workedMs(clock, now) - planned);
};

export const focusedMs = (clock: FocusClock, now: number) => workedMs(clock, now) - overtimeMs(clock, now);

export const remainingMs = (clock: FocusClock, now: number) => {
  const planned = plannedMs(clock);
  return planned === undefined ? undefined : planned - focusedMs(clock, now);
};

export const isTimeUp = (clock: FocusClock, now: number) => remainingMs(clock, now) === 0;

export const endInstant = (clock: FocusClock, now: number) =>
  clock.state.kind === "running" ? now - overtimeMs(clock, now) : clock.state.at;
