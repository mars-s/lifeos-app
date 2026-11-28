import { Schema } from "effect";

export class Retired extends Schema.TaggedError<Retired>()("Retired", {
  kind: Schema.tag("retired"),
  retiredAt: Schema.Number,
}) {}

export class NeverImported extends Schema.TaggedError<NeverImported>()("NeverImported", {
  kind: Schema.tag("never_imported"),
}) {}

export type ThingsFailure = Retired | NeverImported;
