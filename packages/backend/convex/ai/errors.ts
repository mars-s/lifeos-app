import { Schema } from "effect";

export class AiNotConfigured extends Schema.TaggedError<AiNotConfigured>()("AiNotConfigured", {
  kind: Schema.tag("not_configured"),
}) {}

export class AiUnauthorised extends Schema.TaggedError<AiUnauthorised>()("AiUnauthorised", {
  kind: Schema.tag("unauthorised"),
}) {}

export class AiRateLimited extends Schema.TaggedError<AiRateLimited>()("AiRateLimited", {
  kind: Schema.tag("rate_limited"),
}) {}

export class AiUnavailable extends Schema.TaggedError<AiUnavailable>()("AiUnavailable", {
  kind: Schema.tag("unavailable"),
  status: Schema.optional(Schema.Number),
}) {
  wire() {
    const wire: { readonly kind: "unavailable"; readonly status?: number } =
      this.status === undefined ? { kind: this.kind } : { kind: this.kind, status: this.status };
    return wire;
  }
}

export class AiInvalidResponse extends Schema.TaggedError<AiInvalidResponse>()("AiInvalidResponse", {
  kind: Schema.tag("invalid_response"),
}) {}

export class AiRefused extends Schema.TaggedError<AiRefused>()("AiRefused", {
  kind: Schema.tag("refused"),
}) {}

export type AiFailure = AiNotConfigured | AiUnauthorised | AiRateLimited | AiUnavailable | AiInvalidResponse | AiRefused;

export class UnknownModel extends Schema.TaggedError<UnknownModel>()("UnknownModel", {
  kind: Schema.tag("unknown_model"),
  model: Schema.String,
}) {}

export class ModelCannotAnswer extends Schema.TaggedError<ModelCannotAnswer>()("ModelCannotAnswer", {
  kind: Schema.tag("model_cannot_answer"),
  model: Schema.String,
}) {}

export class SwitchedElsewhere extends Schema.TaggedError<SwitchedElsewhere>()("SwitchedElsewhere", {
  kind: Schema.tag("switched_elsewhere"),
  feature: Schema.Literal("places"),
}) {}

export type RouteFailure = UnknownModel | ModelCannotAnswer | SwitchedElsewhere;

export class MemoryNotFound extends Schema.TaggedError<MemoryNotFound>()("MemoryNotFound", {
  kind: Schema.tag("not_found"),
}) {}

export class EmptyMemory extends Schema.TaggedError<EmptyMemory>()("EmptyMemory", {
  kind: Schema.tag("empty"),
}) {}

export class MemoryOff extends Schema.TaggedError<MemoryOff>()("MemoryOff", {
  kind: Schema.tag("memory_off"),
}) {}

export type MemoryFailure = MemoryNotFound | EmptyMemory | MemoryOff;

export class EmptyRequest extends Schema.TaggedError<EmptyRequest>()("EmptyRequest", {
  kind: Schema.tag("empty_request"),
}) {}

export class NotWaiting extends Schema.TaggedError<NotWaiting>()("NotWaiting", {
  kind: Schema.tag("not_waiting"),
}) {}

export type RunFailure = AiNotConfigured | EmptyRequest | NotWaiting;
