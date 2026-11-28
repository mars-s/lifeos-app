import { addDays, type IsoDate } from "./date";

export type EnergyKind = "solid" | "usual" | "learning" | "none";

export type EnergyDay = {
  readonly date: IsoDate;
  readonly kind: EnergyKind;
  readonly points: readonly { readonly minute: number; readonly level: number }[];
  readonly wake: number;
  readonly bedtime: number;
  readonly peak: { readonly start: number; readonly end: number };
  readonly dip: { readonly start: number; readonly end: number };
  readonly low: boolean;
  readonly reading: { readonly asleepMinutes?: number; readonly readiness?: number; readonly debtMinutes: number; readonly nights: number };
};

const WAKE = 7 * 60 + 5;
const BEDTIME = 22 * 60 + 45;
const STEP = 15;

const levelAt = (minute: number) => {
  const hour = minute / 60;
  const awake = Math.max(0, (minute - WAKE) / 60);
  const rhythm = 0.3 * Math.cos((2 * Math.PI * (hour - 16.5)) / 24) + 0.24 * Math.cos((4 * Math.PI * (hour - 9)) / 24);
  const pressure = 0.7 * (1 - Math.exp(-awake / 16)) + 0.45 * Math.exp(-awake / 0.8);
  return Math.max(0.06, Math.min(1, (rhythm - pressure + 0.5) / 0.62));
};

const POINTS = Array.from({ length: (BEDTIME - WAKE) / 5 + 1 }, (_, index) => {
  const minute = WAKE + index * 5;
  return { minute, level: Math.round(levelAt(minute) * 1000) / 1000 };
}).filter((point) => (point.minute - WAKE) % STEP === 0 || point.minute === BEDTIME);

export const standInEnergy = (from: IsoDate, days: number, today: IsoDate) =>
  Array.from({ length: days }, (_, index) => {
    const date = addDays(from, index);
    const day: EnergyDay = {
      date,
      kind: date > today ? "usual" : "solid",
      points: POINTS,
      wake: WAKE,
      bedtime: BEDTIME,
      peak: { start: 10 * 60, end: 12 * 60 },
      dip: { start: 14 * 60, end: 15 * 60 + 30 },
      low: false,
      reading: { asleepMinutes: 450, readiness: 82, debtMinutes: 40, nights: 14 },
    };
    return day;
  });
