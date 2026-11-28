import { expect, expectTypeOf, test } from "vitest";
import { wireError, type SameWire } from "../../shared/result";
import { FeatureOff, InvalidBlock, NameTaken, NotFound, type PlannerFailure } from "./errors";
import type { PlannerTable } from "./model";

type PlannerError =
  | { readonly kind: "not_found"; readonly table: PlannerTable; readonly id: string }
  | { readonly kind: "invalid_date"; readonly input: string }
  | { readonly kind: "invalid_estimate"; readonly minutes: number }
  | { readonly kind: "invalid_order"; readonly order: string }
  | { readonly kind: "empty_title" }
  | { readonly kind: "name_taken"; readonly name: string }
  | { readonly kind: "not_trashed"; readonly table: PlannerTable; readonly id: string }
  | { readonly kind: "invalid_icon"; readonly icon: string }
  | { readonly kind: "selection_too_large"; readonly limit: number }
  | { readonly kind: "heading_outside_project"; readonly headingId: string }
  | { readonly kind: "invalid_block"; readonly reason: "start" | "minutes" | "time_zone" | "overlap" }
  | { readonly kind: "invalid_plan"; readonly reason: "range" | "time_zone" | "order" | "goal" }
  | { readonly kind: "invalid_schedule"; readonly reason: "every" | "days" | "day" | "month" | "end" | "count" | "time_zone" }
  | { readonly kind: "stale_occurrence"; readonly ruleId: string; readonly date: string }
  | { readonly kind: "invalid_template"; readonly reason: "checklist" | "deadline_offset" }
  | { readonly kind: "feature_off"; readonly feature: "templates" }
  | {
      readonly kind: "invalid_smart_block";
      readonly reason: "window" | "time_zone" | "occurrence" | "outside" | "overlap" | "release" | "too_many";
    }
  | { readonly kind: "feature_off"; readonly feature: "smartBlocks" }
  | {
      readonly kind: "invalid_focus";
      readonly reason: "minutes" | "task_closed" | "not_active" | "not_ended" | "not_timed" | "not_pomodoro" | "on_break";
    };

test("every planner failure crosses the wire as the PlannerError the apps already read", () => {
  expectTypeOf<SameWire<PlannerFailure, PlannerError>>().toEqualTypeOf<true>();
});

test("a failure carries its wire kind and fields, and nothing else", () => {
  expect(wireError(new NotFound({ table: "tasks", id: "t1" }))).toStrictEqual({ kind: "not_found", table: "tasks", id: "t1" });
  expect(wireError(new InvalidBlock({ reason: "overlap" }))).toStrictEqual({ kind: "invalid_block", reason: "overlap" });
  expect(wireError(new NameTaken({ taken: "Deep Work" }))).toStrictEqual({ kind: "name_taken", name: "Deep Work" });
  expect(wireError(new FeatureOff({ feature: "templates" }))).toStrictEqual({ kind: "feature_off", feature: "templates" });
});
