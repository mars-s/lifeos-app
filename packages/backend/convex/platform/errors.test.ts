import { expect, expectTypeOf, test } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { EntityRef, RecordRef } from "./tables";
import { wireError, type SameWire } from "../../shared/result";
import {
  ChangedSince,
  EntityNotFound,
  KeyCheckUnavailable,
  NotClaimed,
  NotUndoable,
  type JobFailure,
  type LinkFailure,
  type SecretFailure,
  type UndoFailure,
} from "./errors";

type JobError = { readonly kind: "not_claimed"; readonly jobId: Id<"jobs"> };

type LinkError = { readonly kind: "not_found"; readonly entity: EntityRef };

type SecretError =
  | { readonly kind: "empty" }
  | { readonly kind: "not_set_up" }
  | { readonly kind: "refused" }
  | { readonly kind: "unreachable" }
  | { readonly kind: "unavailable"; readonly status: number };

type UndoError =
  | { readonly kind: "not_found" }
  | { readonly kind: "not_undoable"; readonly reason: "undo" | "things" | "recurrence" | "permanent" }
  | { readonly kind: "already_undone" }
  | { readonly kind: "nothing_to_undo" }
  | { readonly kind: "run_active" }
  | { readonly kind: "changed_since"; readonly entity: RecordRef };

test("every platform failure crosses the wire as the plain error the apps already read", () => {
  expectTypeOf<SameWire<UndoFailure, UndoError>>().toEqualTypeOf<true>();
  expectTypeOf<SameWire<JobFailure, JobError>>().toEqualTypeOf<true>();
  expectTypeOf<SameWire<LinkFailure, LinkError>>().toEqualTypeOf<true>();
  expectTypeOf<SameWire<SecretFailure, SecretError>>().toEqualTypeOf<true>();
});

test("a platform failure carries its wire kind and fields, and nothing else", () => {
  const taskId = "t1" as Id<"tasks">;
  const jobId = "j1" as Id<"jobs">;
  expect(wireError(new NotUndoable({ reason: "permanent" }))).toStrictEqual({ kind: "not_undoable", reason: "permanent" });
  expect(wireError(new ChangedSince({ entity: { table: "tasks", id: taskId } }))).toStrictEqual({
    kind: "changed_since",
    entity: { table: "tasks", id: taskId },
  });
  expect(wireError(new NotClaimed({ jobId }))).toStrictEqual({ kind: "not_claimed", jobId });
  expect(wireError(new EntityNotFound({ entity: { table: "tasks", id: taskId } }))).toStrictEqual({
    kind: "not_found",
    entity: { table: "tasks", id: taskId },
  });
  expect(wireError(new KeyCheckUnavailable({ status: 503 }))).toStrictEqual({ kind: "unavailable", status: 503 });
});
