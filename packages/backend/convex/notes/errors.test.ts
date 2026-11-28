import { expect, expectTypeOf, test } from "vitest";
import { wireError, type SameWire } from "../../shared/effect/wire";
import { NoteNotFound, type NoteFailure } from "./errors";
import type { NoteError } from "./notes";

test("every note failure crosses the wire as the NoteError the apps already read", () => {
  expectTypeOf<SameWire<NoteFailure, NoteError>>().toEqualTypeOf<true>();
});

test("a failure carries its wire kind and nothing else", () => {
  expect(wireError(new NoteNotFound())).toStrictEqual({ kind: "not_found" });
});
