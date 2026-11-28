import { Result } from "effect";
import type { IsoDate } from "../date";
import { InvalidDate } from "./errors";

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
