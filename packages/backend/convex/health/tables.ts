import { defineTable } from "convex/server";
import { v, type Infer } from "convex/values";

export const BEDTIME_STATUSES = [
  "not_enough_nights",
  "not_enough_recent_nights",
  "bad_sleep_quality",
  "only_recommended_found",
  "optimal_found",
] as const;

export const BEDTIME_RECOMMENDATIONS = [
  "improve_efficiency",
  "earlier_bedtime",
  "later_bedtime",
  "earlier_wake_up_time",
  "later_wake_up_time",
  "follow_optimal_bedtime",
] as const;

export const vBedtimeStatus = v.union(...BEDTIME_STATUSES.map((status) => v.literal(status)));
export const vBedtimeRecommendation = v.union(...BEDTIME_RECOMMENDATIONS.map((recommendation) => v.literal(recommendation)));

export const vSleepPeriod = v.object({
  start: v.number(),
  end: v.number(),
  offsetMinutes: v.number(),
  asleepMinutes: v.optional(v.number()),
});

export const vBedtimeWindow = v.object({ startOffset: v.number(), endOffset: v.number(), dayTz: v.number() });

export const vSleepTime = v.object({
  status: v.optional(vBedtimeStatus),
  recommendation: v.optional(vBedtimeRecommendation),
  window: v.optional(vBedtimeWindow),
});

export const vHealthDay = v.object({
  day: v.string(),
  sleep: v.optional(vSleepPeriod),
  sleepScore: v.optional(v.number()),
  readinessScore: v.optional(v.number()),
  sleepTime: v.optional(vSleepTime),
});

export const vOuraError = v.union(
  v.object({ kind: v.literal("not_configured") }),
  v.object({ kind: v.literal("not_connected") }),
  v.object({ kind: v.literal("unauthorised") }),
  v.object({ kind: v.literal("forbidden") }),
  v.object({ kind: v.literal("rate_limited"), retryAfterSeconds: v.optional(v.number()) }),
  v.object({ kind: v.literal("unavailable"), status: v.optional(v.number()) }),
  v.object({ kind: v.literal("invalid_response") }),
);

export const vOuraSync = v.union(
  v.object({ kind: v.literal("never") }),
  v.object({ kind: v.literal("ok"), at: v.number() }),
  v.object({ kind: v.literal("failed"), at: v.number(), error: vOuraError, lastOkAt: v.optional(v.number()) }),
);

export type SleepPeriod = Infer<typeof vSleepPeriod>;
export type BedtimeStatus = Infer<typeof vBedtimeStatus>;
export type BedtimeRecommendation = Infer<typeof vBedtimeRecommendation>;
export type BedtimeWindow = Infer<typeof vBedtimeWindow>;
export type SleepTime = Infer<typeof vSleepTime>;
export type HealthDay = Infer<typeof vHealthDay>;
export type OuraError = Infer<typeof vOuraError>;
export type OuraSync = Infer<typeof vOuraSync>;

export const healthTables = {
  healthDays: defineTable({ source: v.literal("oura"), ...vHealthDay.fields, syncedAt: v.number() }).index("by_source_and_day", [
    "source",
    "day",
  ]),
  ouraConnection: defineTable({
    accessToken: v.string(),
    refreshToken: v.string(),
    expiresAt: v.number(),
    scope: v.string(),
    connectedAt: v.number(),
    sync: vOuraSync,
  }),
  ouraAuthStates: defineTable({ state: v.string(), verifier: v.string(), expiresAt: v.number() }).index("by_state", ["state"]),
};
