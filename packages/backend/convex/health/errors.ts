import { Schema } from "effect";

export class OuraNotConfigured extends Schema.TaggedError<OuraNotConfigured>()("OuraNotConfigured", {
  kind: Schema.tag("not_configured"),
}) {}

export class OuraNotConnected extends Schema.TaggedError<OuraNotConnected>()("OuraNotConnected", {
  kind: Schema.tag("not_connected"),
}) {}

export class OuraUnauthorised extends Schema.TaggedError<OuraUnauthorised>()("OuraUnauthorised", {
  kind: Schema.tag("unauthorised"),
}) {}

export class OuraForbidden extends Schema.TaggedError<OuraForbidden>()("OuraForbidden", {
  kind: Schema.tag("forbidden"),
}) {}

export class OuraRateLimited extends Schema.TaggedError<OuraRateLimited>()("OuraRateLimited", {
  kind: Schema.tag("rate_limited"),
  retryAfterSeconds: Schema.optional(Schema.Number),
}) {
  wire() {
    const wire: { readonly kind: "rate_limited"; readonly retryAfterSeconds?: number } =
      this.retryAfterSeconds === undefined ? { kind: this.kind } : { kind: this.kind, retryAfterSeconds: this.retryAfterSeconds };
    return wire;
  }
}

export class OuraUnavailable extends Schema.TaggedError<OuraUnavailable>()("OuraUnavailable", {
  kind: Schema.tag("unavailable"),
  status: Schema.optional(Schema.Number),
}) {
  wire() {
    const wire: { readonly kind: "unavailable"; readonly status?: number } =
      this.status === undefined ? { kind: this.kind } : { kind: this.kind, status: this.status };
    return wire;
  }
}

export class OuraInvalidResponse extends Schema.TaggedError<OuraInvalidResponse>()("OuraInvalidResponse", {
  kind: Schema.tag("invalid_response"),
}) {}

export type OuraFailure =
  | OuraNotConfigured
  | OuraNotConnected
  | OuraUnauthorised
  | OuraForbidden
  | OuraRateLimited
  | OuraUnavailable
  | OuraInvalidResponse;

export class InvalidHealthRange extends Schema.TaggedError<InvalidHealthRange>()("InvalidHealthRange", {
  kind: Schema.tag("invalid_range"),
}) {}
