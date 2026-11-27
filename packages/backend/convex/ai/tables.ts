import { defineTable } from "convex/server";
import { v, type Infer } from "convex/values";
import { EMBEDDING_DIMENSIONS } from "../../shared/ai";

export const vAiError = v.union(
  v.object({ kind: v.literal("not_configured") }),
  v.object({ kind: v.literal("unauthorised") }),
  v.object({ kind: v.literal("rate_limited") }),
  v.object({ kind: v.literal("unavailable"), status: v.optional(v.number()) }),
  v.object({ kind: v.literal("invalid_response") }),
  v.object({ kind: v.literal("refused") }),
);

const vAnswered = { answeredBy: v.string(), inputsHash: v.string(), at: v.number() };

export const vStepsOutcome = v.union(
  v.object({ kind: v.literal("waiting") }),
  v.object({ kind: v.literal("suggested"), steps: v.array(v.string()), project: v.boolean(), ...vAnswered }),
  v.object({ kind: v.literal("failed"), error: vAiError, inputsHash: v.string(), at: v.number() }),
);

export type AiError = Infer<typeof vAiError>;
export type StepsOutcome = Infer<typeof vStepsOutcome>;

export const vIndexedRef = v.union(
  v.object({ table: v.literal("tasks"), id: v.id("tasks") }),
  v.object({ table: v.literal("projects"), id: v.id("projects") }),
  v.object({ table: v.literal("areas"), id: v.id("areas") }),
);

export const vIndexKind = v.union(v.literal("task"), v.literal("project"), v.literal("area"));

export type IndexedRef = Infer<typeof vIndexedRef>;
export type IndexKind = Infer<typeof vIndexKind>;

export const vMemoryKind = v.union(v.literal("preference"), v.literal("routine"), v.literal("person"), v.literal("place"), v.literal("goal"));

export const vMemorySource = v.union(v.object({ kind: v.literal("avi") }), v.object({ kind: v.literal("run"), jobId: v.id("jobs") }));

export type MemoryKind = Infer<typeof vMemoryKind>;

export const aiTables = {
  memories: defineTable({ text: v.string(), kind: vMemoryKind, source: vMemorySource, pinned: v.boolean(), createdAt: v.number() })
    .index("by_pinned", ["pinned"])
    .searchIndex("by_text", { searchField: "text" }),
  aiIndex: defineTable({
    entity: vIndexedRef,
    kind: vIndexKind,
    text: v.string(),
    areaId: v.optional(v.id("areas")),
    hash: v.string(),
    embedded: v.boolean(),
    embedding: v.optional(v.array(v.float64())),
    updatedAt: v.number(),
  })
    .index("by_entity", ["entity.id"])
    .index("by_embedded", ["embedded"])
    .searchIndex("by_text", { searchField: "text", filterFields: ["kind", "areaId"] })
    .vectorIndex("by_embedding", { vectorField: "embedding", dimensions: EMBEDDING_DIMENSIONS, filterFields: ["kind", "areaId"] }),
  stepSuggestions: defineTable({
    taskId: v.id("tasks"),
    requestedAt: v.number(),
    answeredAt: v.optional(v.number()),
    outcome: vStepsOutcome,
  }).index("by_task", ["taskId"]),
};
