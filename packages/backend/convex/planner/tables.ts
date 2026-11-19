import { defineTable } from "convex/server";
import { v, type GenericValidator, type Infer } from "convex/values";

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

export const vFocusState = v.union(
  v.object({ kind: v.literal("running") }),
  v.object({ kind: v.literal("paused"), at: v.number() }),
  v.object({ kind: v.literal("ended"), at: v.number() }),
);

export const vPomodoro = v.object({ focusMinutes: v.number(), breakMinutes: v.number() });

export const vFocusPlan = v.union(
  v.object({ kind: v.literal("open") }),
  v.object({ kind: v.literal("pomodoro"), ...vPomodoro.fields }),
);

export const vSmartEstimateError = v.union(
  v.object({ kind: v.literal("not_configured") }),
  v.object({ kind: v.literal("unauthorised") }),
  v.object({ kind: v.literal("rate_limited") }),
  v.object({ kind: v.literal("unavailable"), status: v.optional(v.number()) }),
  v.object({ kind: v.literal("invalid_response") }),
  v.object({ kind: v.literal("refused") }),
);

export const vSuggestionOutcome = v.union(
  v.object({ kind: v.literal("waiting") }),
  v.object({
    kind: v.literal("suggested"),
    minutes: v.number(),
    reason: v.string(),
    confidence: v.number(),
    model: v.string(),
    inputsHash: v.string(),
    at: v.number(),
  }),
  v.object({ kind: v.literal("failed"), error: vSmartEstimateError, inputsHash: v.string(), at: v.number() }),
);

export type When = Infer<typeof vWhen>;
export type Status = Infer<typeof vStatus>;
export type Parent = Infer<typeof vParent>;
export type Colour = Infer<typeof vColour>;
export type SmartEstimateError = Infer<typeof vSmartEstimateError>;
export type SuggestionOutcome = Infer<typeof vSuggestionOutcome>;

const areaFields = {
  title: v.string(),
  colour: vColour,
  icon: v.optional(v.string()),
  order: v.string(),
  trashedAt: v.optional(v.number()),
};

const projectFields = {
  title: v.string(),
  notes: v.string(),
  areaId: v.optional(v.id("areas")),
  when: vWhen,
  deadline: v.optional(v.string()),
  labelIds: v.array(v.id("labels")),
  status: vStatus,
  trashedAt: v.optional(v.number()),
  order: v.string(),
};

const headingFields = {
  projectId: v.id("projects"),
  title: v.string(),
  order: v.string(),
};

const labelFields = {
  name: v.string(),
  colour: vColour,
  order: v.string(),
};

const taskFields = {
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
  plan: v.optional(v.object({ date: v.string(), order: v.string() })),
};

const checklistItemFields = {
  taskId: v.id("tasks"),
  title: v.string(),
  done: v.boolean(),
  order: v.string(),
};

export const vAreaBase = v.object(areaFields).pick("title");
export const vLabelBase = v.object(labelFields).pick("name");
export const vProjectBase = v
  .object(projectFields)
  .pick("title", "notes", "areaId", "when", "deadline", "labelIds", "status", "trashedAt");
export const vHeadingBase = v.object(headingFields).pick("title", "projectId");
export const vTaskBase = v
  .object(taskFields)
  .pick("title", "notes", "when", "deadline", "parent", "labelIds", "status", "trashedAt");
export const vChecklistItemBase = v.object(checklistItemFields).pick("title", "done");

const thingsLink = <Base extends GenericValidator>(base: Base) => v.object({ id: v.string(), base: v.optional(base) });

export const plannerTables = {
  areas: defineTable({ ...areaFields, things: v.optional(thingsLink(vAreaBase)) })
    .index("by_things_id", ["things.id"])
    .index("by_order", ["order"])
    .index("by_trashed", ["trashedAt"]),
  projects: defineTable({ ...projectFields, things: v.optional(thingsLink(vProjectBase)) })
    .index("by_things_id", ["things.id"])
    .index("by_area_order", ["areaId", "order"])
    .index("by_trashed", ["trashedAt"]),
  headings: defineTable({ ...headingFields, things: v.optional(thingsLink(vHeadingBase)) })
    .index("by_things_id", ["things.id"])
    .index("by_project_order", ["projectId", "order"]),
  labels: defineTable({ ...labelFields, things: v.optional(thingsLink(vLabelBase)) })
    .index("by_things_id", ["things.id"])
    .index("by_name", ["name"])
    .index("by_order", ["order"]),
  tasks: defineTable({
    ...taskFields,
    things: v.optional(thingsLink(vTaskBase).extend({ todayIndex: v.number() })),
  })
    .index("by_things_id", ["things.id"])
    .index("by_trashed_status_when", ["trashedAt", "status.kind", "when.kind", "when.date"])
    .index("by_trashed_status_deadline", ["trashedAt", "status.kind", "deadline"])
    .index("by_trashed_closed_at", ["trashedAt", "status.at"])
    .index("by_project_order", ["parent.projectId", "order"])
    .index("by_area_order", ["parent.areaId", "order"])
    .index("by_parent_kind_order", ["parent.kind", "order"]),
  checklistItems: defineTable({ ...checklistItemFields, things: v.optional(thingsLink(vChecklistItemBase)) })
    .index("by_things_id", ["things.id"])
    .index("by_task_order", ["taskId", "order"]),
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
  focusSessions: defineTable({
    taskId: v.id("tasks"),
    kind: v.union(v.literal("focus"), v.literal("break")),
    start: v.number(),
    plannedMinutes: v.optional(v.number()),
    pausedMs: v.number(),
    state: vFocusState,
    pomodoro: v.optional(vPomodoro),
    removedAt: v.optional(v.number()),
  })
    .index("by_task_start", ["taskId", "start"])
    .index("by_start", ["start"])
    .index("by_state", ["state.kind"]),
  estimateSuggestions: defineTable({
    taskId: v.id("tasks"),
    requestedAt: v.number(),
    outcome: vSuggestionOutcome,
  }).index("by_task", ["taskId"]),
  thingsSync: defineTable({
    syncedAt: v.number(),
    counts: v.object({
      areas: v.number(),
      projects: v.number(),
      headings: v.number(),
      tasks: v.number(),
      checklistItems: v.number(),
      labels: v.number(),
    }),
    retiredAt: v.optional(v.number()),
  }),
  thingsTombstones: defineTable({ thingsId: v.string() }).index("by_things_id", ["thingsId"]),
};
