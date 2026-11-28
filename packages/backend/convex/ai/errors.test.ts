import { expect, expectTypeOf, test } from "vitest";
import { wireError, type SameWire } from "../../shared/effect/wire";
import {
  AiNotConfigured,
  AiUnavailable,
  SwitchedElsewhere,
  UnknownModel,
  type AiFailure,
  type MemoryFailure,
  type RouteFailure,
  type RunFailure,
} from "./errors";
import type { MemoryError } from "./memory";
import type { RouteError } from "./routing";
import type { RunError } from "./runs";
import type { AiError } from "./tables";

test("every AI failure crosses the wire as the plain error the apps and the stored outcomes already read", () => {
  expectTypeOf<SameWire<AiFailure, AiError>>().toEqualTypeOf<true>();
  expectTypeOf<SameWire<RouteFailure, RouteError>>().toEqualTypeOf<true>();
  expectTypeOf<SameWire<MemoryFailure, MemoryError>>().toEqualTypeOf<true>();
  expectTypeOf<SameWire<RunFailure, RunError>>().toEqualTypeOf<true>();
});

test("an AI failure carries its wire kind and fields, and nothing else", () => {
  expect(wireError(new AiUnavailable({}))).toStrictEqual({ kind: "unavailable" });
  expect(wireError(new AiUnavailable({ status: 503 }))).toStrictEqual({ kind: "unavailable", status: 503 });
  expect(wireError(new AiNotConfigured())).toStrictEqual({ kind: "not_configured" });
  expect(wireError(new UnknownModel({ model: "openai/gpt-9" }))).toStrictEqual({ kind: "unknown_model", model: "openai/gpt-9" });
  expect(wireError(new SwitchedElsewhere({ feature: "places" }))).toStrictEqual({ kind: "switched_elsewhere", feature: "places" });
});
