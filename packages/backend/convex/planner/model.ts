import { generateKeyBetween } from "fractional-indexing";
import { Result, err, ok } from "neverthrow";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { parseIsoDate } from "../../shared/date";
import { MAX_ESTIMATE_MINUTES } from "../../shared/estimate";
import type { Parent, When } from "./tables";

type PlannerTable = "areas" | "projects" | "headings" | "labels" | "tasks" | "checklistItems" | "workBlocks" | "focusSessions";

export type PlannerError =
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
  | { readonly kind: "invalid_block"; readonly reason: "start" | "minutes" | "time_zone" }
  | { readonly kind: "invalid_plan"; readonly reason: "range" | "time_zone" | "order" }
  | {
      readonly kind: "invalid_focus";
      readonly reason: "minutes" | "task_closed" | "not_active" | "not_ended" | "not_timed" | "not_pomodoro" | "on_break";
    };

export const load = async <T extends PlannerTable>(ctx: QueryCtx, table: T, id: Id<T>) => {
  const doc = await ctx.db.get(id);
  const found: Result<Doc<T>, PlannerError> = doc ? ok(doc) : err({ kind: "not_found", table, id });
  return found;
};

export const parseTitle = (title: string) => {
  const trimmed = title.trim();
  return trimmed ? ok<string, PlannerError>(trimmed) : err<string, PlannerError>({ kind: "empty_title" });
};

const parseDate = (input: string) => parseIsoDate(input).mapErr<PlannerError>((error) => error);

export const parseWhen = (when: When) =>
  when.kind === "scheduled" ? parseDate(when.date).map(() => when) : ok<When, PlannerError>(when);

export const parseDeadline = (deadline: string | null) =>
  deadline === null ? ok<string | undefined, PlannerError>(undefined) : parseDate(deadline).map(String);

export const parseEstimate = (minutes: number | null) =>
  minutes === null
    ? ok<number | undefined, PlannerError>(undefined)
    : Number.isInteger(minutes) && minutes > 0 && minutes <= MAX_ESTIMATE_MINUTES
      ? ok<number | undefined, PlannerError>(minutes)
      : err<number | undefined, PlannerError>({ kind: "invalid_estimate", minutes });

export const parseOrder = (order: string) =>
  Result.fromThrowable<() => string, PlannerError>(
    () => generateKeyBetween(order, null),
    () => ({ kind: "invalid_order", order }),
  )().map(() => order);

export const keyAfter = (last: string | undefined) => generateKeyBetween(last ?? null, null);

export const parseParent = async (ctx: QueryCtx, parent: Parent) => {
  if (parent.kind === "loose") return ok<Parent, PlannerError>(parent);
  if (parent.kind === "area") return (await load(ctx, "areas", parent.areaId)).map(() => parent);
  const project = await load(ctx, "projects", parent.projectId);
  if (project.isErr() || !parent.headingId) return project.map(() => parent);
  const heading = await load(ctx, "headings", parent.headingId);
  return heading.andThen((found) =>
    found.projectId === parent.projectId
      ? ok<Parent, PlannerError>(parent)
      : err<Parent, PlannerError>({ kind: "heading_outside_project", headingId: found._id }),
  );
};

export const parseLabels = async (ctx: QueryCtx, labelIds: Id<"labels">[]) => {
  const unique = [...new Set(labelIds)];
  for (const id of unique) {
    const found = await load(ctx, "labels", id);
    if (found.isErr()) return err<Id<"labels">[], PlannerError>(found.error);
  }
  return ok<Id<"labels">[], PlannerError>(unique);
};

export const lastTaskOrder = async (ctx: QueryCtx, parent: Parent) => {
  const last =
    parent.kind === "project"
      ? await ctx.db
          .query("tasks")
          .withIndex("by_project_order", (q) => q.eq("parent.projectId", parent.projectId))
          .order("desc")
          .first()
      : parent.kind === "area"
        ? await ctx.db
            .query("tasks")
            .withIndex("by_area_order", (q) => q.eq("parent.areaId", parent.areaId))
            .order("desc")
            .first()
        : await ctx.db
            .query("tasks")
            .withIndex("by_parent_kind_order", (q) => q.eq("parent.kind", "loose"))
            .order("desc")
            .first();
  return last?.order;
};
