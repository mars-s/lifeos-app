import { defineTable } from "convex/server";
import { v, type Infer } from "convex/values";

export const vAvailability = v.union(
  v.literal("busy"),
  v.literal("free"),
  v.literal("tentative"),
  v.literal("unavailable"),
  v.literal("unknown"),
);

export const vResponse = v.union(v.literal("accepted"), v.literal("declined"), v.literal("tentative"), v.literal("pending"));

export const vCalendarKind = v.union(
  v.literal("local"),
  v.literal("calDAV"),
  v.literal("exchange"),
  v.literal("subscription"),
  v.literal("birthday"),
);

export const calendarFields = {
  calendarId: v.string(),
  title: v.string(),
  colour: v.string(),
  source: v.string(),
  kind: vCalendarKind,
};

export const commitmentFields = {
  calendarId: v.string(),
  eventKey: v.string(),
  title: v.string(),
  start: v.number(),
  end: v.number(),
  allDay: v.boolean(),
  location: v.optional(v.string()),
  availability: vAvailability,
  response: v.optional(vResponse),
  recurring: v.boolean(),
};

export type Availability = Infer<typeof vAvailability>;
export type Response = Infer<typeof vResponse>;
export type CalendarKind = Infer<typeof vCalendarKind>;

export const calendarTables = {
  calendars: defineTable({ ...calendarFields, included: v.boolean() }).index("by_calendar_id", ["calendarId"]),
  externalCommitments: defineTable(commitmentFields)
    .index("by_event_key", ["eventKey"])
    .index("by_start", ["start"]),
  calendarSync: defineTable({ syncedAt: v.number(), windowStart: v.number(), windowEnd: v.number() }),
  workingHours: defineTable({ startMinute: v.number(), endMinute: v.number() }),
};
