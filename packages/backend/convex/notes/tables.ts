import { defineTable } from "convex/server";
import { v } from "convex/values";

export const vNoteFolder = v.union(
  v.object({ table: v.literal("areas"), id: v.string() }),
  v.object({ table: v.literal("projects"), id: v.string() }),
);

export const vNoteEntity = v.object({
  table: v.union(v.literal("tasks"), v.literal("projects"), v.literal("areas")),
  id: v.string(),
});

export const noteTables = {
  notes: defineTable({
    docId: v.string(),
    title: v.string(),
    titleKey: v.string(),
    excerpt: v.string(),
    searchText: v.string(),
    words: v.number(),
    areaId: v.optional(v.id("areas")),
    projectId: v.optional(v.id("projects")),
    labelIds: v.array(v.id("labels")),
    day: v.optional(v.string()),
    updatedAt: v.number(),
    trashedAt: v.optional(v.number()),
  })
    .index("by_doc", ["docId"])
    .index("by_updated", ["updatedAt"])
    .index("by_area_updated", ["areaId", "updatedAt"])
    .index("by_project_updated", ["projectId", "updatedAt"])
    .index("by_day", ["day"])
    .index("by_title_key", ["titleKey"])
    .index("by_trashed", ["trashedAt"])
    .searchIndex("search_text", { searchField: "searchText", filterFields: ["areaId"] }),
};
