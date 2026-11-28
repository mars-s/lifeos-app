import { Schema } from "effect";

export class PlacesNotConfigured extends Schema.TaggedError<PlacesNotConfigured>()("PlacesNotConfigured", {
  kind: Schema.tag("not_configured"),
}) {}

export class PlacesUnauthorised extends Schema.TaggedError<PlacesUnauthorised>()("PlacesUnauthorised", {
  kind: Schema.tag("unauthorised"),
}) {}

export class PlacesRateLimited extends Schema.TaggedError<PlacesRateLimited>()("PlacesRateLimited", {
  kind: Schema.tag("rate_limited"),
}) {}

export class PlacesUnavailable extends Schema.TaggedError<PlacesUnavailable>()("PlacesUnavailable", {
  kind: Schema.tag("unavailable"),
  status: Schema.optional(Schema.Number),
}) {
  wire() {
    const wire: { readonly kind: "unavailable"; readonly status?: number } =
      this.status === undefined ? { kind: this.kind } : { kind: this.kind, status: this.status };
    return wire;
  }
}

export class PlacesInvalidResponse extends Schema.TaggedError<PlacesInvalidResponse>()("PlacesInvalidResponse", {
  kind: Schema.tag("invalid_response"),
}) {}

export class PlacesRefused extends Schema.TaggedError<PlacesRefused>()("PlacesRefused", {
  kind: Schema.tag("refused"),
}) {}

export type PlacesFailure =
  | PlacesNotConfigured
  | PlacesUnauthorised
  | PlacesRateLimited
  | PlacesUnavailable
  | PlacesInvalidResponse
  | PlacesRefused;

export class AddressEmpty extends Schema.TaggedError<AddressEmpty>()("AddressEmpty", {
  kind: Schema.tag("empty"),
}) {}

export class AddressNotFound extends Schema.TaggedError<AddressNotFound>()("AddressNotFound", {
  kind: Schema.tag("not_found"),
}) {}

export class GeocoderUnreachable extends Schema.TaggedError<GeocoderUnreachable>()("GeocoderUnreachable", {
  kind: Schema.tag("unreachable"),
}) {}

export class GeocoderUnavailable extends Schema.TaggedError<GeocoderUnavailable>()("GeocoderUnavailable", {
  kind: Schema.tag("unavailable"),
  status: Schema.Number,
}) {}

export class GeocoderInvalidResponse extends Schema.TaggedError<GeocoderInvalidResponse>()("GeocoderInvalidResponse", {
  kind: Schema.tag("invalid_response"),
}) {}

export type GeocodeFailure = GeocoderUnreachable | GeocoderUnavailable | GeocoderInvalidResponse;

export type SavePlaceFailure = AddressEmpty | AddressNotFound | GeocodeFailure;

export class NoTrip extends Schema.TaggedError<NoTrip>()("NoTrip", {
  kind: Schema.tag("no_trip"),
}) {}

export class UnknownPlace extends Schema.TaggedError<UnknownPlace>()("UnknownPlace", {
  kind: Schema.tag("unknown_place"),
}) {}

export type TripFailure = NoTrip | UnknownPlace;
