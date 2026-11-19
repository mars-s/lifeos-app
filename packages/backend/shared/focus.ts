export const MINUTE_MS = 60_000;
export const MAX_FOCUS_MINUTES = 24 * 60;
export const MAX_EXTEND_MINUTES = 120;
export const POMODOROS_PER_LONG_BREAK = 4;
export const DEFAULT_POMODORO = { focusMinutes: 25, breakMinutes: 5, longBreakMinutes: 15 } as const;

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

export type PomodoroLengths = {
  readonly focusMinutes: number;
  readonly breakMinutes: number;
  readonly longBreakMinutes?: number;
};

export type Pomodoro = PomodoroLengths & { readonly round?: number };

export type FocusPlan = { readonly kind: "open" } | ({ readonly kind: "pomodoro" } & PomodoroLengths);

export type FocusMode = "open" | "pomodoro";

export type FocusPlanChoice = {
  readonly mode: FocusMode;
  readonly focusMinutes: number;
  readonly breakMinutes: number;
  readonly longBreakMinutes: number;
};

export const DEFAULT_FOCUS_PLAN: FocusPlanChoice = { mode: "open", ...DEFAULT_POMODORO };

export const planOf = ({ mode, focusMinutes, breakMinutes, longBreakMinutes }: FocusPlanChoice) =>
  (mode === "open" ? { kind: "open" } : { kind: "pomodoro", focusMinutes, breakMinutes, longBreakMinutes }) satisfies FocusPlan;

export const roundOf = (pomodoro: Pomodoro) => pomodoro.round ?? 1;

export const isLongBreak = (pomodoro: Pomodoro) =>
  pomodoro.longBreakMinutes !== undefined && roundOf(pomodoro) % POMODOROS_PER_LONG_BREAK === 0;

export const stepMinutes = (pomodoro: Pomodoro, kind: "focus" | "break") =>
  kind === "focus" ? pomodoro.focusMinutes : isLongBreak(pomodoro) ? (pomodoro.longBreakMinutes ?? pomodoro.breakMinutes) : pomodoro.breakMinutes;

export const nextStep = (pomodoro: Pomodoro, kind: "focus" | "break") =>
  kind === "focus"
    ? ({ kind: "break", pomodoro } as const)
    : ({ kind: "focus", pomodoro: { ...pomodoro, round: (roundOf(pomodoro) % POMODOROS_PER_LONG_BREAK) + 1 } } as const);

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
