import { Schema } from "effect";

export class EstimateInvalidResponse extends Schema.TaggedError<EstimateInvalidResponse>()("EstimateInvalidResponse", {
  kind: Schema.tag("invalid_response"),
}) {}

export class EstimateRefused extends Schema.TaggedError<EstimateRefused>()("EstimateRefused", {
  kind: Schema.tag("refused"),
}) {}

export type DecisionFailure = EstimateInvalidResponse | EstimateRefused;
