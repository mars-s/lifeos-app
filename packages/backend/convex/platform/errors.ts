import { Predicate, Schema } from "effect";
import type { Id } from "../_generated/dataModel";
import type { EntityRef, RecordRef } from "./tables";

const stored = <T>(is: (input: unknown) => boolean) => Schema.declare(is as (input: unknown) => input is T);

const JobIdField = stored<Id<"jobs">>(Predicate.isString);
const RecordField = stored<RecordRef>(Predicate.isObject);
const EntityField = stored<EntityRef>(Predicate.isObject);

export class ActivityNotFound extends Schema.TaggedError<ActivityNotFound>()("ActivityNotFound", {
  kind: Schema.tag("not_found"),
}) {}

export class NotUndoable extends Schema.TaggedError<NotUndoable>()("NotUndoable", {
  kind: Schema.tag("not_undoable"),
  reason: Schema.Literals(["undo", "things", "recurrence", "permanent"]),
}) {}

export class AlreadyUndone extends Schema.TaggedError<AlreadyUndone>()("AlreadyUndone", {
  kind: Schema.tag("already_undone"),
}) {}

export class NothingToUndo extends Schema.TaggedError<NothingToUndo>()("NothingToUndo", {
  kind: Schema.tag("nothing_to_undo"),
}) {}

export class RunActive extends Schema.TaggedError<RunActive>()("RunActive", {
  kind: Schema.tag("run_active"),
}) {}

export class ChangedSince extends Schema.TaggedError<ChangedSince>()("ChangedSince", {
  kind: Schema.tag("changed_since"),
  entity: RecordField,
}) {}

export type UndoFailure = ActivityNotFound | NotUndoable | AlreadyUndone | NothingToUndo | RunActive | ChangedSince;

export class NotClaimed extends Schema.TaggedError<NotClaimed>()("NotClaimed", {
  kind: Schema.tag("not_claimed"),
  jobId: JobIdField,
}) {}

export type JobFailure = NotClaimed;

export class EntityNotFound extends Schema.TaggedError<EntityNotFound>()("EntityNotFound", {
  kind: Schema.tag("not_found"),
  entity: EntityField,
}) {}

export type LinkFailure = EntityNotFound;

export class EmptySecret extends Schema.TaggedError<EmptySecret>()("EmptySecret", {
  kind: Schema.tag("empty"),
}) {}

export class SecretsNotSetUp extends Schema.TaggedError<SecretsNotSetUp>()("SecretsNotSetUp", {
  kind: Schema.tag("not_set_up"),
}) {}

export class KeyRefused extends Schema.TaggedError<KeyRefused>()("KeyRefused", {
  kind: Schema.tag("refused"),
}) {}

export class KeyCheckUnreachable extends Schema.TaggedError<KeyCheckUnreachable>()("KeyCheckUnreachable", {
  kind: Schema.tag("unreachable"),
}) {}

export class KeyCheckUnavailable extends Schema.TaggedError<KeyCheckUnavailable>()("KeyCheckUnavailable", {
  kind: Schema.tag("unavailable"),
  status: Schema.Number,
}) {}

export type SecretFailure = EmptySecret | SecretsNotSetUp | KeyRefused | KeyCheckUnreachable | KeyCheckUnavailable;
