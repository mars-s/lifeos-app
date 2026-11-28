import { Schema } from "effect";

export class InvalidWindow extends Schema.TaggedError<InvalidWindow>()("InvalidWindow", {
  kind: Schema.tag("invalid_window"),
}) {}

export class InvalidCalendarRange extends Schema.TaggedError<InvalidCalendarRange>()("InvalidCalendarRange", {
  kind: Schema.tag("invalid_range"),
}) {}

export class InvalidCalendarTimeZone extends Schema.TaggedError<InvalidCalendarTimeZone>()("InvalidCalendarTimeZone", {
  kind: Schema.tag("invalid_time_zone"),
  timeZone: Schema.String,
}) {}

export class InvalidWorkingHours extends Schema.TaggedError<InvalidWorkingHours>()("InvalidWorkingHours", {
  kind: Schema.tag("invalid_hours"),
}) {}

export class CalendarNotFound extends Schema.TaggedError<CalendarNotFound>()("CalendarNotFound", {
  kind: Schema.tag("not_found"),
}) {}

export type CalendarFailure = InvalidWindow | InvalidCalendarRange | InvalidCalendarTimeZone | InvalidWorkingHours | CalendarNotFound;
