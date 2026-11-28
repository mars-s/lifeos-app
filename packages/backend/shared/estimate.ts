import { toNeverthrow } from "./effect/bridge";
import * as fx from "./effect/estimate";

export type EstimateTextError = { readonly kind: "unreadable_estimate"; readonly input: string };

export { MAX_ESTIMATE_MINUTES } from "./effect/estimate";

export const parseEstimateText = (input: string) => toNeverthrow(fx.parseEstimateText(input));

export const formatMinutes = (minutes: number) =>
  `${Math.floor(minutes / 60)}:${String(Math.round(minutes) % 60).padStart(2, "0")}`;

export const shortEstimate = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours === 0 ? `${rest}m` : rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
};
