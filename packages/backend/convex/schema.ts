import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const taskStatus = v.union(v.literal("open"), v.literal("done"));

export const taskFields = {
  title: v.string(),
  notes: v.optional(v.string()),
  status: taskStatus,
  scheduledFor: v.optional(v.string()),
  area: v.optional(v.string()),
  thingsId: v.optional(v.string()),
};

export default defineSchema({
  tasks: defineTable(taskFields)
    .index("by_scheduledFor", ["scheduledFor"])
    .index("by_thingsId", ["thingsId"]),
});
