import { Result } from "effect";
import { InvalidDate } from "./errors.ts";

export type IsoDate = string & { readonly __brand: "IsoDate" };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const roundTrips = (input: string) => {
  const match = ISO_DATE.exec(input);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const parsed = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day;
};

export const parseIsoDate = (input: string) => {
  const parsed: Result.Result<IsoDate, InvalidDate> = roundTrips(input)
    ? Result.succeed(input as IsoDate)
    : Result.fail(new InvalidDate({ input }));
  return parsed;
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
