import { defineSchema, defineTable } from "convex/server";
import { v, type Infer } from "convex/values";

export const thingsStatus = v.union(v.literal("open"), v.literal("completed"), v.literal("canceled"));

export const thingsList = v.union(
  v.literal("inbox"),
  v.literal("today"),
  v.literal("anytime"),
  v.literal("upcoming"),
  v.literal("someday"),
);

export const areaFields = {
  thingsId: v.string(),
  title: v.string(),
  position: v.number(),
};

export const projectFields = {
  thingsId: v.string(),
  title: v.string(),
  notes: v.string(),
  status: thingsStatus,
  areaThingsId: v.optional(v.string()),
  scheduledFor: v.optional(v.string()),
  deadline: v.optional(v.string()),
  tags: v.array(v.string()),
  position: v.number(),
};

export const taskFields = {
  thingsId: v.string(),
  title: v.string(),
  notes: v.string(),
  status: thingsStatus,
  list: thingsList,
  position: v.number(),
  scheduledFor: v.optional(v.string()),
  deadline: v.optional(v.string()),
  tags: v.array(v.string()),
  projectThingsId: v.optional(v.string()),
  areaThingsId: v.optional(v.string()),
  modifiedAt: v.number(),
};

export const thingsSnapshot = v.object({
  areas: v.array(v.object(areaFields)),
  projects: v.array(v.object(projectFields)),
  tasks: v.array(v.object(taskFields)),
});

export type ThingsSnapshot = Infer<typeof thingsSnapshot>;

export default defineSchema({
  areas: defineTable(areaFields).index("by_thingsId", ["thingsId"]),
  projects: defineTable(projectFields).index("by_thingsId", ["thingsId"]),
  tasks: defineTable(taskFields)
    .index("by_thingsId", ["thingsId"])
    .index("by_list", ["list", "position"])
    .index("by_list_scheduledFor", ["list", "scheduledFor"])
    .index("by_deadline", ["deadline"]),
  syncState: defineTable({
    source: v.literal("things"),
    syncedAt: v.number(),
    counts: v.object({ areas: v.number(), projects: v.number(), tasks: v.number() }),
  }).index("by_source", ["source"]),
});
