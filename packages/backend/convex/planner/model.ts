import { Effect, Result } from "effect";
import { generateKeyBetween } from "fractional-indexing";
import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { ObjectType, PropertyValidators } from "convex/values";
import { changeMutation, reading, type ChangeServices } from "../platform/effect";
import type { InvalidDate } from "../../shared/errors";
import { parseIsoDate } from "../../shared/date";
import { MAX_ESTIMATE_MINUTES } from "../../shared/estimate";
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

export const load = <T extends PlannerTable>(table: T, id: Id<T>) =>
  Effect.flatMap(reading((ctx) => ctx.db.get(id)), (doc) => (doc ? Effect.succeed(doc) : Effect.fail(new NotFound({ table, id }))));

export const parseTitle = (title: string) => {
  const trimmed = title.trim();
  const parsed: Result.Result<string, EmptyTitle> = trimmed ? Result.succeed(trimmed) : Result.fail(new EmptyTitle());
  return parsed;
};

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
  if (parent.kind === "area") yield* load("areas", parent.areaId);
  if (parent.kind !== "project") return parent;
  yield* load("projects", parent.projectId);
  if (!parent.headingId) return parent;
  const heading = yield* load("headings", parent.headingId);
  if (heading.projectId !== parent.projectId) return yield* new HeadingOutsideProject({ headingId: heading._id });
  return parent;
});

export const parseLabels = Effect.fn("model.parseLabels")(function* (labelIds: Id<"labels">[]) {
  const unique = [...new Set(labelIds)];
  for (const id of unique) yield* load("labels", id);
  return unique;
});

export const plannerChange = <Args extends PropertyValidators, A extends object>(spec: {
  action: string;
  args: Args;
  handler: (args: ObjectType<Args>) => Effect.Effect<A, PlannerFailure, ChangeServices>;
}) => changeMutation(spec);

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
