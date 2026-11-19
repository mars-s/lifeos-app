import { defineTable } from "convex/server";
import { v, type Infer } from "convex/values";
import { vPlaceLabel, vTravelMode } from "../../shared/features";

export const vPosition = v.object({ lat: v.number(), lon: v.number() });

export const vPlacesError = v.union(
  v.object({ kind: v.literal("not_configured") }),
  v.object({ kind: v.literal("unauthorised") }),
  v.object({ kind: v.literal("rate_limited") }),
  v.object({ kind: v.literal("unavailable"), status: v.optional(v.number()) }),
  v.object({ kind: v.literal("invalid_response") }),
  v.object({ kind: v.literal("refused") }),
);

export const vPlace = v.object({
  key: v.string(),
  name: v.string(),
  suburb: v.optional(v.string()),
  position: vPosition,
  straightMetres: v.number(),
  travel: v.optional(v.object({ seconds: v.number(), metres: v.number() })),
});

const vLooked = { inputsHash: v.string(), at: v.number(), answeredBy: v.optional(v.string()) };
const vSearched = { query: v.string(), mode: vTravelMode, from: vPosition };

export const vTripOutcome = v.union(
  v.object({ kind: v.literal("waiting"), query: v.optional(v.string()) }),
  v.object({ kind: v.literal("none"), ...vLooked }),
  v.object({ kind: v.literal("unfound"), ...vSearched, ...vLooked }),
  v.object({ kind: v.literal("found"), ...vSearched, places: v.array(vPlace), ...vLooked }),
  v.object({ kind: v.literal("failed"), error: vPlacesError, query: v.optional(v.string()), ...vLooked }),
);

export const vTripChoice = v.union(
  v.object({ kind: v.literal("nearest") }),
  v.object({ kind: v.literal("picked"), key: v.string() }),
  v.object({ kind: v.literal("dismissed") }),
);

export type Position = Infer<typeof vPosition>;
export type Place = Infer<typeof vPlace>;
export type PlacesError = Infer<typeof vPlacesError>;
export type TripOutcome = Infer<typeof vTripOutcome>;
export type TripChoice = Infer<typeof vTripChoice>;

export const placesTables = {
  savedPlaces: defineTable({
    label: vPlaceLabel,
    address: v.string(),
    position: vPosition,
    found: v.string(),
    savedAt: v.number(),
  }).index("by_label", ["label"]),
  taskTrips: defineTable({
    taskId: v.id("tasks"),
    requestedAt: v.number(),
    outcome: vTripOutcome,
    choice: vTripChoice,
  }).index("by_task", ["taskId"]),
};
