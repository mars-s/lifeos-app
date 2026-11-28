import { Schema } from "effect";

export class NoteNotFound extends Schema.TaggedError<NoteNotFound>()("NoteNotFound", {
  kind: Schema.tag("not_found"),
}) {}

export type NoteFailure = NoteNotFound;
