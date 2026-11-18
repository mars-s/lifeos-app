import { defineTable } from "convex/server";
import { v, type Infer } from "convex/values";

export const vWhen = v.union(
  v.object({ kind: v.literal("inbox") }),
  v.object({ kind: v.literal("anytime") }),
  v.object({ kind: v.literal("someday") }),
  v.object({ kind: v.literal("scheduled"), date: v.string(), evening: v.boolean() }),
);

export const vStatus = v.union(
  v.object({ kind: v.literal("open") }),
  v.object({ kind: v.literal("completed"), at: v.number() }),
  v.object({ kind: v.literal("canceled"), at: v.number() }),
);

export const vParent = v.union(
  v.object({ kind: v.literal("loose") }),
  v.object({ kind: v.literal("area"), areaId: v.id("areas") }),
  v.object({ kind: v.literal("project"), projectId: v.id("projects"), headingId: v.optional(v.id("headings")) }),
);

export const colours = ["violet", "green", "orange", "teal", "rose", "olive", "plum", "slate"] as const;

export const vColour = v.union(...colours.map((colour) => v.literal(colour)));

export const vThingsList = v.union(
  v.literal("inbox"),
  v.literal("today"),
  v.literal("anytime"),
  v.literal("upcoming"),
  v.literal("someday"),
);

const vThingsLink = v.object({ id: v.string(), index: v.number() });

const vTaskThingsLink = v.object({
  id: v.string(),
  list: vThingsList,
  index: v.number(),
  modifiedAt: v.number(),
});

export type When = Infer<typeof vWhen>;
export type Status = Infer<typeof vStatus>;
export type Parent = Infer<typeof vParent>;
export type Colour = Infer<typeof vColour>;

export const thingsOwnedFields = {
  areas: ["title", "trashedAt"],
  projects: ["title", "notes", "areaId", "when", "deadline", "labelIds", "status", "trashedAt"],
  headings: ["title", "projectId"],
  tasks: ["title", "notes", "when", "deadline", "parent", "labelIds", "status", "trashedAt"],
} as const;

export const plannerTables = {
  areas: defineTable({
    title: v.string(),
    colour: vColour,
    icon: v.optional(v.string()),
    order: v.string(),
    trashedAt: v.optional(v.number()),
    things: v.optional(vThingsLink),
  })
    .index("by_things_id", ["things.id"])
    .index("by_order", ["order"]),
  projects: defineTable({
    title: v.string(),
    notes: v.string(),
    areaId: v.optional(v.id("areas")),
    when: vWhen,
    deadline: v.optional(v.string()),
    labelIds: v.array(v.id("labels")),
    status: vStatus,
    trashedAt: v.optional(v.number()),
    order: v.string(),
    things: v.optional(vThingsLink),
  })
    .index("by_things_id", ["things.id"])
    .index("by_area_order", ["areaId", "order"]),
  headings: defineTable({
    projectId: v.id("projects"),
    title: v.string(),
    order: v.string(),
    things: v.optional(v.object({ id: v.string() })),
  }).index("by_project_order", ["projectId", "order"]),
  labels: defineTable({
    name: v.string(),
    colour: vColour,
    order: v.string(),
  })
    .index("by_name", ["name"])
    .index("by_order", ["order"]),
  tasks: defineTable({
    title: v.string(),
    notes: v.string(),
    when: vWhen,
    deadline: v.optional(v.string()),
    estimateMinutes: v.optional(v.number()),
    parent: vParent,
    labelIds: v.array(v.id("labels")),
    status: vStatus,
    trashedAt: v.optional(v.number()),
    order: v.string(),
    things: v.optional(vTaskThingsLink),
  })
    .index("by_things_id", ["things.id"])
    .index("by_trashed_status_when", ["trashedAt", "status.kind", "when.kind", "when.date"])
    .index("by_trashed_status_deadline", ["trashedAt", "status.kind", "deadline"])
    .index("by_project_order", ["parent.projectId", "order"])
    .index("by_area_order", ["parent.areaId", "order"])
    .index("by_parent_kind_order", ["parent.kind", "order"]),
  checklistItems: defineTable({
    taskId: v.id("tasks"),
    title: v.string(),
    done: v.boolean(),
    order: v.string(),
  }).index("by_task_order", ["taskId", "order"]),
  workBlocks: defineTable({
    taskId: v.id("tasks"),
    start: v.number(),
    minutes: v.number(),
    timeZone: v.string(),
    done: v.boolean(),
    removedAt: v.optional(v.number()),
  })
    .index("by_task_start", ["taskId", "start"])
    .index("by_removed_start", ["removedAt", "start"]),
  thingsSync: defineTable({
    syncedAt: v.number(),
    counts: v.object({ areas: v.number(), projects: v.number(), tasks: v.number() }),
  }),
};
