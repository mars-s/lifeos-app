import { expect, expectTypeOf, test } from "vitest";
import { wireError, type SameWire } from "../../shared/result";
import { NeverImported, Retired } from "./thingsErrors";

type RetireError = { readonly kind: "never_imported" };

type ImportError = { readonly kind: "retired"; readonly retiredAt: number };

test("the Things failures cross the wire as the plain errors the importer already reads", () => {
  expectTypeOf<SameWire<Retired, ImportError>>().toEqualTypeOf<true>();
  expectTypeOf<SameWire<NeverImported, RetireError>>().toEqualTypeOf<true>();
});

test("a failure carries its wire kind and fields, and nothing else", () => {
  expect(wireError(new Retired({ retiredAt: 5 }))).toStrictEqual({ kind: "retired", retiredAt: 5 });
  expect(wireError(new NeverImported())).toStrictEqual({ kind: "never_imported" });
});
