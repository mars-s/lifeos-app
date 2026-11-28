import { toNeverthrow } from "./effect/bridge";
import * as fx from "./effect/date";

export type IsoDate = string & { readonly __brand: "IsoDate" };

export type DateError = { readonly kind: "invalid_date"; readonly input: string };

export const parseIsoDate = (input: string) => toNeverthrow(fx.parseIsoDate(input));

const pad = (n: number) => String(n).padStart(2, "0");

export const localIsoDate = (now: Date) =>
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` as IsoDate;

const DAY_MS = 86_400_000;

export const addDays = (date: IsoDate, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10) as IsoDate;

export const daysBetween = (from: IsoDate, to: IsoDate) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

export const laterOf = (a: IsoDate, b: IsoDate) => (a > b ? a : b);
