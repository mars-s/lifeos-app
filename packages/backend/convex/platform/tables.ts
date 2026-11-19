import { defineTable } from "convex/server";
import { v, type Infer } from "convex/values";

export const vEntityRef = v.union(
  v.object({ table: v.literal("areas"), id: v.id("areas") }),
  v.object({ table: v.literal("projects"), id: v.id("projects") }),
  v.object({ table: v.literal("headings"), id: v.id("headings") }),
  v.object({ table: v.literal("tasks"), id: v.id("tasks") }),
  v.object({ table: v.literal("labels"), id: v.id("labels") }),
  v.object({ table: v.literal("checklistItems"), id: v.id("checklistItems") }),
  v.object({ table: v.literal("workBlocks"), id: v.id("workBlocks") }),
  v.object({ table: v.literal("focusSessions"), id: v.id("focusSessions") }),
);

export const vRecordRef = v.union(
  ...vEntityRef.members,
  v.object({ table: v.literal("entityLinks"), id: v.id("entityLinks") }),
  v.object({ table: v.literal("calendars"), id: v.id("calendars") }),
  v.object({ table: v.literal("workingHours"), id: v.id("workingHours") }),
  v.object({ table: v.literal("preferences"), id: v.id("preferences") }),
);

export const vActor = v.union(
  v.object({ kind: v.literal("avi") }),
  v.object({ kind: v.literal("agentRun"), jobId: v.id("jobs") }),
  v.object({ kind: v.literal("things") }),
);

const vStoredFields = v.record(v.string(), v.any());

export const vChange = v.union(
  v.object({ kind: v.literal("insert"), after: vStoredFields }),
  v.object({ kind: v.literal("patch"), before: vStoredFields, after: vStoredFields }),
  v.object({ kind: v.literal("delete"), before: vStoredFields }),
);

export const vUndoTarget = v.union(
  v.object({ kind: v.literal("activity"), activityId: v.id("activity") }),
  v.object({ kind: v.literal("run"), jobId: v.id("jobs") }),
);

export const vJobKind = v.literal("agent");

export const vCapability = v.union(v.literal("things"), v.literal("calendar"), vJobKind);

export const vJob = v.object({ kind: vJobKind, payload: v.object({ request: v.string() }) });

export const vJobStatus = v.union(
  v.object({ kind: v.literal("queued"), availableAt: v.number() }),
  v.object({
    kind: v.literal("claimed"),
    workerId: v.id("workers"),
    leaseUntil: v.number(),
    heartbeatAt: v.number(),
  }),
  v.object({ kind: v.literal("done"), at: v.number(), receipt: v.any() }),
  v.object({ kind: v.literal("failed"), at: v.number(), error: v.string() }),
);

export type EntityRef = Infer<typeof vEntityRef>;
export type RecordRef = Infer<typeof vRecordRef>;
export type Actor = Infer<typeof vActor>;
export type Change = Infer<typeof vChange>;
export type UndoTarget = Infer<typeof vUndoTarget>;
export type JobKind = Infer<typeof vJobKind>;
export type Capability = Infer<typeof vCapability>;
export type Job = Infer<typeof vJob>;

export const platformTables = {
  users: defineTable({ githubId: v.string(), login: v.string() }),
  activity: defineTable({
    actor: vActor,
    action: v.string(),
    at: v.number(),
    undoes: v.optional(vUndoTarget),
  })
    .index("by_run", ["actor.jobId"])
    .index("by_undoes_activity", ["undoes.activityId"])
    .index("by_undoes_run", ["undoes.jobId"]),
  activityChanges: defineTable({
    activityId: v.id("activity"),
    seq: v.number(),
    entity: vRecordRef,
    change: vChange,
  })
    .index("by_activity_seq", ["activityId", "seq"])
    .index("by_entity", ["entity.id"]),
  entityLinks: defineTable({ from: vEntityRef, to: vEntityRef })
    .index("by_from", ["from.id"])
    .index("by_to", ["to.id"]),
  jobs: defineTable({
    job: vJob,
    idempotencyKey: v.string(),
    status: vJobStatus,
    attempts: v.number(),
  })
    .index("by_idempotency_key", ["idempotencyKey"])
    .index("by_kind_status_available", ["job.kind", "status.kind", "status.availableAt"])
    .index("by_kind_status_lease", ["job.kind", "status.kind", "status.leaseUntil"]),
  preferences: defineTable({ smartEstimates: v.boolean() }),
  workers: defineTable({
    name: v.string(),
    capabilities: v.array(vCapability),
    tokenHash: v.string(),
  })
    .index("by_name", ["name"])
    .index("by_token_hash", ["tokenHash"]),
};
