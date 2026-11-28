import { Effect, Result } from "effect";
import { generateKeyBetween } from "fractional-indexing";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { Recorder as Recording } from "../platform/activity";
import type { ObjectType, PropertyValidators } from "convex/values";
import { changeMutation, legacyRead, reading, Recorder, type ChangeServices } from "../platform/effect";
import { toNeverthrow } from "../../shared/effect/bridge";
import type { InvalidDate } from "../../shared/effect/errors";
import { parseIsoDate } from "../../shared/effect/date";
import { MAX_ESTIMATE_MINUTES } from "../../shared/effect/estimate";
import type { ScheduleError } from "../../shared/recurrence";
import { EmptyTitle, HeadingOutsideProject, InvalidEstimate, InvalidOrder, NotFound, type PlannerFailure } from "./errors";
import type { Parent, When } from "./tables";

export type PlannerTable =
  | "areas"
  | "projects"
  | "headings"
  | "labels"
  | "tasks"
  | "checklistItems"
  | "workBlocks"
  | "focusSessions"
  | "templates"
  | "recurrenceRules"
  | "smartBlocks";

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
  | { readonly kind: "invalid_block"; readonly reason: "start" | "minutes" | "time_zone" | "overlap" }
  | { readonly kind: "invalid_plan"; readonly reason: "range" | "time_zone" | "order" | "goal" }
  | ScheduleError
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

export const loadFx = <T extends PlannerTable>(table: T, id: Id<T>) =>
  Effect.flatMap(reading((ctx) => ctx.db.get(id)), (doc) => (doc ? Effect.succeed(doc) : Effect.fail(new NotFound({ table, id }))));

export const load = <T extends PlannerTable>(ctx: QueryCtx, table: T, id: Id<T>) => legacyRead<Doc<T>, PlannerFailure>(ctx, loadFx(table, id));

export const parseTitleFx = (title: string) => {
  const trimmed = title.trim();
  const parsed: Result.Result<string, EmptyTitle> = trimmed ? Result.succeed(trimmed) : Result.fail(new EmptyTitle());
  return parsed;
};

export const parseTitle = (title: string) => toNeverthrow<string, PlannerFailure>(parseTitleFx(title));

export const parseWhen = (when: When) => {
  const parsed: Result.Result<When, InvalidDate> = when.kind === "scheduled" ? Result.map(parseIsoDate(when.date), () => when) : Result.succeed(when);
  return parsed;
};

export const parseDeadline = (deadline: string | null) => {
  const parsed: Result.Result<string | undefined, InvalidDate> = deadline === null ? Result.succeed(undefined) : parseIsoDate(deadline);
  return parsed;
};

export const parseEstimate = (minutes: number | null) => {
  const parsed: Result.Result<number | undefined, InvalidEstimate> =
    minutes === null
      ? Result.succeed(undefined)
      : Number.isInteger(minutes) && minutes > 0 && minutes <= MAX_ESTIMATE_MINUTES
        ? Result.succeed(minutes)
        : Result.fail(new InvalidEstimate({ minutes }));
  return parsed;
};

export const parseOrder = (order: string) =>
  Result.try({ try: () => generateKeyBetween(order, null), catch: () => new InvalidOrder({ order }) }).pipe(Result.map(() => order));

export const keyAfter = (last: string | undefined) => generateKeyBetween(last ?? null, null);

export const parseParent = Effect.fn("model.parseParent")(function* (parent: Parent) {
  if (parent.kind === "area") yield* loadFx("areas", parent.areaId);
  if (parent.kind !== "project") return parent;
  yield* loadFx("projects", parent.projectId);
  if (!parent.headingId) return parent;
  const heading = yield* loadFx("headings", parent.headingId);
  if (heading.projectId !== parent.projectId) return yield* new HeadingOutsideProject({ headingId: heading._id });
  return parent;
});

export const parseLabels = Effect.fn("model.parseLabels")(function* (labelIds: Id<"labels">[]) {
  const unique = [...new Set(labelIds)];
  for (const id of unique) yield* loadFx("labels", id);
  return unique;
});

export const plannerChange = <Args extends PropertyValidators, A extends object>(spec: {
  action: string;
  args: Args;
  handler: (args: ObjectType<Args>) => Effect.Effect<A, PlannerFailure, ChangeServices>;
}) => changeMutation(spec);

export const changing = <A>(write: (ctx: MutationCtx, record: Recording) => Promise<A>) =>
  Effect.flatMap(Recorder, (record) => reading((ctx) => write(ctx as MutationCtx, record)));

export const nextTaskOrder = async (ctx: QueryCtx, parent: Parent, after: string) => {
  const next =
    parent.kind === "project"
      ? await ctx.db
          .query("tasks")
          .withIndex("by_project_order", (q) => q.eq("parent.projectId", parent.projectId).gt("order", after))
          .first()
      : parent.kind === "area"
        ? await ctx.db
            .query("tasks")
            .withIndex("by_area_order", (q) => q.eq("parent.areaId", parent.areaId).gt("order", after))
            .first()
        : await ctx.db
            .query("tasks")
            .withIndex("by_parent_kind_order", (q) => q.eq("parent.kind", "loose").gt("order", after))
            .first();
  return generateKeyBetween(after, next?.order ?? null);
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

const isLive = (record: { trashedAt?: number } | null) => record !== null && record.trashedAt === undefined;

export const liveHome = async (ctx: QueryCtx, parent: Parent) => {
  if (parent.kind === "loose") return parent;
  if (parent.kind === "area") return isLive(await ctx.db.get("areas", parent.areaId)) ? parent : ({ kind: "loose" } satisfies Parent);
  const project = await ctx.db.get("projects", parent.projectId);
  if (isLive(project)) return parent;
  const areaId = project?.areaId;
  return areaId && isLive(await ctx.db.get("areas", areaId))
    ? ({ kind: "area", areaId } satisfies Parent)
    : ({ kind: "loose" } satisfies Parent);
};
