import { v } from "convex/values";
import type { WithoutSystemFields } from "convex/server";
import { generateKeyBetween } from "fractional-indexing";
import { Effect, Result } from "effect";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { featureState } from "../platform/features";
import { ownerQuery, reading, recording } from "../platform/effect";
import { parseIsoDate } from "../../shared/effect/date";
import { FeatureOff, InvalidTemplate, type EmptyTitle } from "./errors";
import { changing, keyAfter, liveHome, loadFx, parseEstimate, parseLabels, parseParent, parseTitleFx, parseWhen, plannerChange } from "./model";
import {
  MAX_DEADLINE_OFFSET_DAYS,
  MAX_SHAPE_CHECKLIST,
  createFromShape,
  homeSummary,
  scheduledDate,
  snapshotTask,
} from "./shape";
import { vParent, vWhen, type Parent } from "./tables";

const TEMPLATE_LIMIT = 200;

type TemplateFields = Partial<WithoutSystemFields<Doc<"templates">>>;

const parseChecklist = (titles: string[]) => {
  const parsed: Result.Result<string[], InvalidTemplate | EmptyTitle> =
    titles.length > MAX_SHAPE_CHECKLIST ? Result.fail(new InvalidTemplate({ reason: "checklist" })) : Result.all(titles.map(parseTitleFx));
  return parsed;
};

const parseDeadlineOffset = (days: number | null) => {
  const parsed: Result.Result<number | undefined, InvalidTemplate> =
    days === null
      ? Result.succeed(undefined)
      : Number.isInteger(days) && days >= 0 && days <= MAX_DEADLINE_OFFSET_DAYS
        ? Result.succeed(days)
        : Result.fail(new InvalidTemplate({ reason: "deadline_offset" }));
  return parsed;
};

const templatesOn = (ctx: QueryCtx) => featureState(ctx, "templates");

const requireTemplates = Effect.fn("templates.requireOn")(function* () {
  if (!(yield* reading(templatesOn)).enabled) return yield* new FeatureOff({ feature: "templates" });
});

const unchanged = Effect.succeed({});

export const list = ownerQuery({
  args: {},
  handler: () =>
    reading(async (ctx) => {
      const templates = await ctx.db.query("templates").withIndex("by_order").take(TEMPLATE_LIMIT);
      const labelIds = [...new Set(templates.flatMap((template) => template.labelIds))];
      const labels = new Map(
        (await Promise.all(labelIds.map((id) => ctx.db.get("labels", id)))).flatMap((label) =>
          label ? [[label._id, { _id: label._id, name: label.name, colour: label.colour }] as const] : [],
        ),
      );
      const homes = await Promise.all(templates.map((template) => homeSummary(ctx, template.parent)));
      return templates.map((template, index) => ({
        ...template,
        labels: template.labelIds.flatMap((id) => labels.get(id) ?? []),
        checklistCount: template.checklist.length,
        ...homes[index],
      }));
    }),
});

export const saveFromTask = plannerChange({
  action: "template.save",
  args: { taskId: v.id("tasks"), today: v.string() },
  handler: Effect.fn("templates.saveFromTask")(function* ({ taskId, today }) {
    yield* requireTemplates();
    const [task, day] = yield* Effect.all([loadFx("tasks", taskId), Effect.fromResult(parseIsoDate(today))]);
    const last = yield* reading((ctx) => ctx.db.query("templates").withIndex("by_order").order("desc").first());
    const shape = yield* reading((ctx) => snapshotTask(ctx, task, day));
    const templateId = yield* recording((record) => record.insert("templates", { ...shape, order: keyAfter(last?.order) }));
    return { templateId };
  }),
});

export const createTask = plannerChange({
  action: "template.createTask",
  args: { templateId: v.id("templates"), when: vWhen, parent: v.optional(vParent), today: v.string() },
  handler: Effect.fn("templates.createTask")(function* ({ templateId, when, parent, today }) {
    yield* requireTemplates();
    const [template, validWhen, day, given] = yield* Effect.all([
      loadFx("templates", templateId),
      Effect.fromResult(parseWhen(when)),
      Effect.fromResult(parseIsoDate(today)),
      parseParent(parent ?? { kind: "loose" }),
    ]);
    const home: Parent = template.parent.kind === "loose" ? given : yield* reading((ctx) => liveHome(ctx, template.parent));
    const taskId = yield* changing((ctx, record) =>
      createFromShape(ctx, record, template, { when: validWhen, date: scheduledDate(validWhen) ?? day, parent: home }),
    );
    return { taskId };
  }),
});

export const update = plannerChange({
  action: "template.update",
  args: {
    templateId: v.id("templates"),
    title: v.optional(v.string()),
    notes: v.optional(v.string()),
    estimateMinutes: v.optional(v.union(v.number(), v.null())),
    labelIds: v.optional(v.array(v.id("labels"))),
    parent: v.optional(vParent),
    checklist: v.optional(v.array(v.string())),
    deadlineOffsetDays: v.optional(v.union(v.number(), v.null())),
  },
  handler: Effect.fn("templates.update")(function* ({ templateId, ...input }) {
    yield* requireTemplates();
    yield* loadFx("templates", templateId);
    const fields = yield* Effect.all([
      input.title === undefined ? unchanged : Effect.fromResult(Result.map(parseTitleFx(input.title), (title) => ({ title }))),
      Effect.succeed(input.notes === undefined ? {} : { notes: input.notes }),
      input.estimateMinutes === undefined
        ? unchanged
        : Effect.fromResult(Result.map(parseEstimate(input.estimateMinutes), (estimateMinutes) => ({ estimateMinutes }))),
      input.labelIds === undefined ? unchanged : Effect.map(parseLabels(input.labelIds), (labelIds) => ({ labelIds })),
      input.parent === undefined ? unchanged : Effect.map(parseParent(input.parent), (parent) => ({ parent })),
      input.checklist === undefined ? unchanged : Effect.fromResult(Result.map(parseChecklist(input.checklist), (checklist) => ({ checklist }))),
      input.deadlineOffsetDays === undefined
        ? unchanged
        : Effect.fromResult(Result.map(parseDeadlineOffset(input.deadlineOffsetDays), (deadlineOffsetDays) => ({ deadlineOffsetDays }))),
    ]);
    const patch: TemplateFields = Object.assign({}, ...fields);
    return { changed: yield* recording((record) => record.patch("templates", templateId, patch)) };
  }),
});

export const reorder = plannerChange({
  action: "template.reorder",
  args: { templateId: v.id("templates"), targetId: v.id("templates"), placement: v.union(v.literal("before"), v.literal("after")) },
  handler: Effect.fn("templates.reorder")(function* ({ templateId, targetId, placement }) {
    yield* requireTemplates();
    const [template, target] = yield* Effect.all([loadFx("templates", templateId), loadFx("templates", targetId)]);
    const before = placement === "before";
    const neighbour = yield* reading((ctx) =>
      ctx.db
        .query("templates")
        .withIndex("by_order", (q) => (before ? q.lt("order", target.order) : q.gt("order", target.order)))
        .order(before ? "desc" : "asc")
        .first(),
    );
    if (templateId === targetId || neighbour?._id === templateId) return { changed: false };
    const order = before
      ? generateKeyBetween(neighbour?.order ?? null, target.order)
      : generateKeyBetween(target.order, neighbour?.order ?? null);
    return { changed: yield* recording((record) => record.patch("templates", template._id, { order })) };
  }),
});

export const remove = plannerChange({
  action: "template.remove",
  args: { templateId: v.id("templates") },
  handler: Effect.fn("templates.remove")(function* ({ templateId }) {
    yield* requireTemplates();
    yield* loadFx("templates", templateId);
    return { changed: yield* recording((record) => record.remove("templates", templateId)) };
  }),
});
