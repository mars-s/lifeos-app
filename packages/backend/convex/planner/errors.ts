import { Schema } from "effect";
import { InvalidDate, InvalidSchedule } from "../../shared/effect/errors";

const PlannerTable = Schema.Literals([
  "areas",
  "projects",
  "headings",
  "labels",
  "tasks",
  "checklistItems",
  "workBlocks",
  "focusSessions",
  "templates",
  "recurrenceRules",
  "smartBlocks",
]);

export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  kind: Schema.tag("not_found"),
  table: PlannerTable,
  id: Schema.String,
}) {}

export class InvalidEstimate extends Schema.TaggedError<InvalidEstimate>()("InvalidEstimate", {
  kind: Schema.tag("invalid_estimate"),
  minutes: Schema.Number,
}) {}

export class InvalidOrder extends Schema.TaggedError<InvalidOrder>()("InvalidOrder", {
  kind: Schema.tag("invalid_order"),
  order: Schema.String,
}) {}

export class EmptyTitle extends Schema.TaggedError<EmptyTitle>()("EmptyTitle", {
  kind: Schema.tag("empty_title"),
}) {}

export class NameTaken extends Schema.TaggedError<NameTaken>()("NameTaken", {
  kind: Schema.tag("name_taken"),
  taken: Schema.String,
}) {
  wire() {
    return { kind: this.kind, name: this.taken };
  }
}

export class NotTrashed extends Schema.TaggedError<NotTrashed>()("NotTrashed", {
  kind: Schema.tag("not_trashed"),
  table: PlannerTable,
  id: Schema.String,
}) {}

export class InvalidIcon extends Schema.TaggedError<InvalidIcon>()("InvalidIcon", {
  kind: Schema.tag("invalid_icon"),
  icon: Schema.String,
}) {}

export class SelectionTooLarge extends Schema.TaggedError<SelectionTooLarge>()("SelectionTooLarge", {
  kind: Schema.tag("selection_too_large"),
  limit: Schema.Number,
}) {}

export class HeadingOutsideProject extends Schema.TaggedError<HeadingOutsideProject>()("HeadingOutsideProject", {
  kind: Schema.tag("heading_outside_project"),
  headingId: Schema.String,
}) {}

export class InvalidBlock extends Schema.TaggedError<InvalidBlock>()("InvalidBlock", {
  kind: Schema.tag("invalid_block"),
  reason: Schema.Literals(["start", "minutes", "time_zone", "overlap"]),
}) {}

export class InvalidPlan extends Schema.TaggedError<InvalidPlan>()("InvalidPlan", {
  kind: Schema.tag("invalid_plan"),
  reason: Schema.Literals(["range", "time_zone", "order", "goal"]),
}) {}

export class StaleOccurrence extends Schema.TaggedError<StaleOccurrence>()("StaleOccurrence", {
  kind: Schema.tag("stale_occurrence"),
  ruleId: Schema.String,
  date: Schema.String,
}) {}

export class InvalidTemplate extends Schema.TaggedError<InvalidTemplate>()("InvalidTemplate", {
  kind: Schema.tag("invalid_template"),
  reason: Schema.Literals(["checklist", "deadline_offset"]),
}) {}

export class FeatureOff extends Schema.TaggedError<FeatureOff>()("FeatureOff", {
  kind: Schema.tag("feature_off"),
  feature: Schema.Literals(["templates", "smartBlocks"]),
}) {}

export class InvalidSmartBlock extends Schema.TaggedError<InvalidSmartBlock>()("InvalidSmartBlock", {
  kind: Schema.tag("invalid_smart_block"),
  reason: Schema.Literals(["window", "time_zone", "occurrence", "outside", "overlap", "release", "too_many"]),
}) {}

export class InvalidFocus extends Schema.TaggedError<InvalidFocus>()("InvalidFocus", {
  kind: Schema.tag("invalid_focus"),
  reason: Schema.Literals(["minutes", "task_closed", "not_active", "not_ended", "not_timed", "not_pomodoro", "on_break"]),
}) {}

export type PlannerFailure =
  | NotFound
  | InvalidDate
  | InvalidEstimate
  | InvalidOrder
  | EmptyTitle
  | NameTaken
  | NotTrashed
  | InvalidIcon
  | SelectionTooLarge
  | HeadingOutsideProject
  | InvalidBlock
  | InvalidPlan
  | InvalidSchedule
  | StaleOccurrence
  | InvalidTemplate
  | FeatureOff
  | InvalidSmartBlock
  | InvalidFocus;
