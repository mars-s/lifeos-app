import { Result } from "effect";
import { UnreadableEstimate } from "./errors";

export const MAX_ESTIMATE_MINUTES = 200 * 60;

const MINUTES_ONLY = /^(\d+)\s*(?:m|min|mins|minutes?)?$/;
const HOURS = /^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)\s*(?:(\d+)\s*(?:m|min|mins|minutes?)?)?$/;
const CLOCK = /^(\d+):([0-5]\d)$/;

const minutesIn = (text: string) => {
  const minutes = MINUTES_ONLY.exec(text);
  if (minutes) return Number(minutes[1]);
  const hours = HOURS.exec(text);
  if (hours) return Number(hours[1]) * 60 + Number(hours[2] ?? 0);
  const clock = CLOCK.exec(text);
  return clock ? Number(clock[1]) * 60 + Number(clock[2]) : Number.NaN;
};

export const parseEstimateText = (input: string) => {
  const minutes = Math.round(minutesIn(input.trim().toLowerCase()));
  const parsed: Result.Result<number, UnreadableEstimate> =
    Number.isInteger(minutes) && minutes > 0 && minutes <= MAX_ESTIMATE_MINUTES
      ? Result.succeed(minutes)
      : Result.fail(new UnreadableEstimate({ input }));
  return parsed;
};

export const formatMinutes = (minutes: number) =>
  `${Math.floor(minutes / 60)}:${String(Math.round(minutes) % 60).padStart(2, "0")}`;

export const shortEstimate = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours === 0 ? `${rest}m` : rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
};
