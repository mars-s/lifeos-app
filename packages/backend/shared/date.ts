import { err, ok } from "neverthrow";

export type IsoDate = string & { readonly __brand: "IsoDate" };

export type DateError = { readonly kind: "invalid_date"; readonly input: string };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const parseIsoDate = (input: string) => {
  const match = ISO_DATE.exec(input);
  if (!match) return err<IsoDate, DateError>({ kind: "invalid_date", input });
  const [, year, month, day] = match.map(Number);
  const parsed = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  const roundTrips =
    parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day;
  return roundTrips ? ok<IsoDate, DateError>(input as IsoDate) : err<IsoDate, DateError>({ kind: "invalid_date", input });
};

const pad = (n: number) => String(n).padStart(2, "0");

export const localIsoDate = (now: Date) =>
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` as IsoDate;

const DAY_MS = 86_400_000;

export const addDays = (date: IsoDate, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10) as IsoDate;

export const daysBetween = (from: IsoDate, to: IsoDate) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

export const laterOf = (a: IsoDate, b: IsoDate) => (a > b ? a : b);
