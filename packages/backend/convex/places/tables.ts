import { defineTable } from "convex/server";
import { v, type Infer } from "convex/values";
import { vPlaceLabel } from "../../shared/features";

export const vPosition = v.object({ lat: v.number(), lon: v.number() });
export type Position = Infer<typeof vPosition>;

export const placesTables = {
  savedPlaces: defineTable({
    label: vPlaceLabel,
    address: v.string(),
    position: vPosition,
    found: v.string(),
    savedAt: v.number(),
  }).index("by_label", ["label"]),
};
