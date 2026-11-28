import { Schema } from "effect";

export class InvalidDate extends Schema.TaggedError<InvalidDate>()("InvalidDate", {
  kind: Schema.tag("invalid_date"),
  input: Schema.String,
}) {}

export class UnreadableEstimate extends Schema.TaggedError<UnreadableEstimate>()("UnreadableEstimate", {
  kind: Schema.tag("unreadable_estimate"),
  input: Schema.String,
}) {}

export class InvalidSchedule extends Schema.TaggedError<InvalidSchedule>()("InvalidSchedule", {
  kind: Schema.tag("invalid_schedule"),
  reason: Schema.Literals(["every", "days", "day", "month", "end", "count", "time_zone"]),
}) {}
