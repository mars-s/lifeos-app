import { v } from "convex/values";
import type { WithoutSystemFields } from "convex/server";
import { generateKeyBetween } from "fractional-indexing";
import { Result, err, ok } from "neverthrow";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { ownerQuery } from "../platform/access";
import { featureState } from "../platform/features";
import { changeMutation } from "../platform/change";
import { parseIsoDate } from "../../shared/date";
import {
  keyAfter,
  liveHome,
  load,
  parseEstimate,
  parseLabels,
  parseParent,
  parseTitle,
  parseWhen,
  type PlannerError,
} from "./model";
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

const parseDay = (input: string) => parseIsoDate(input).mapErr<PlannerError>((error) => error);

const parseChecklist = (titles: string[]) =>
  titles.length > MAX_SHAPE_CHECKLIST
    ? err<string[], PlannerError>({ kind: "invalid_template", reason: "checklist" })
    : Result.combine(titles.map(parseTitle));

const parseDeadlineOffset = (days: number | null) =>
  days === null
    ? ok<number | undefined, PlannerError>(undefined)
    : Number.isInteger(days) && days >= 0 && days <= MAX_DEADLINE_OFFSET_DAYS
      ? ok<number | undefined, PlannerError>(days)
      : err<number | undefined, PlannerError>({ kind: "invalid_template", reason: "deadline_offset" });

const templatesOn = async (ctx: QueryCtx) => (await featureState(ctx, "templates")).enabled;

const SWITCHED_OFF = { kind: "feature_off", feature: "templates" } as const satisfies PlannerError;

export const list = ownerQuery({
  args: {},
  handler: async (ctx) => {
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
  },
});

export const saveFromTask = changeMutation({
  action: "template.save",
  args: { taskId: v.id("tasks"), today: v.string() },
  handler: async (ctx, { taskId, today }, record) => {
    if (!(await templatesOn(ctx))) return err<{ templateId: Id<"templates"> }, PlannerError>(SWITCHED_OFF);
    const inputs = Result.combine([await load(ctx, "tasks", taskId), parseDay(today)]);
    if (inputs.isErr()) return err<{ templateId: Id<"templates"> }, PlannerError>(inputs.error);
    const [task, day] = inputs.value;
    const last = await ctx.db.query("templates").withIndex("by_order").order("desc").first();
    const templateId = await record.insert("templates", { ...(await snapshotTask(ctx, task, day)), order: keyAfter(last?.order) });
    return ok<{ templateId: Id<"templates"> }, PlannerError>({ templateId });
  },
});

export const createTask = changeMutation({
  action: "template.createTask",
  args: { templateId: v.id("templates"), when: vWhen, parent: v.optional(vParent), today: v.string() },
  handler: async (ctx, { templateId, when, parent, today }, record) => {
    if (!(await templatesOn(ctx))) return err<{ taskId: Id<"tasks"> }, PlannerError>(SWITCHED_OFF);
    const inputs = Result.combine([
      await load(ctx, "templates", templateId),
      parseWhen(when),
      parseDay(today),
      await parseParent(ctx, parent ?? { kind: "loose" }),
    ]);
    if (inputs.isErr()) return err<{ taskId: Id<"tasks"> }, PlannerError>(inputs.error);
    const [template, validWhen, day, given] = inputs.value;
    const home: Parent = template.parent.kind === "loose" ? given : await liveHome(ctx, template.parent);
    const taskId = await createFromShape(ctx, record, template, {
      when: validWhen,
      date: scheduledDate(validWhen) ?? day,
      parent: home,
    });
    return ok<{ taskId: Id<"tasks"> }, PlannerError>({ taskId });
  },
});

export const update = changeMutation({
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
  handler: async (ctx, { templateId, ...input }, record) => {
    if (!(await templatesOn(ctx))) return err<{ changed: boolean }, PlannerError>(SWITCHED_OFF);
    const template = await load(ctx, "templates", templateId);
    if (template.isErr()) return err<{ changed: boolean }, PlannerError>(template.error);
    const fields = Result.combine([
      input.title === undefined ? ok({}) : parseTitle(input.title).map((title) => ({ title })),
      ok(input.notes === undefined ? {} : { notes: input.notes }),
      input.estimateMinutes === undefined
        ? ok({})
        : parseEstimate(input.estimateMinutes).map((estimateMinutes) => ({ estimateMinutes })),
      input.labelIds === undefined ? ok({}) : (await parseLabels(ctx, input.labelIds)).map((labelIds) => ({ labelIds })),
      input.parent === undefined ? ok({}) : (await parseParent(ctx, input.parent)).map((parent) => ({ parent })),
      input.checklist === undefined ? ok({}) : parseChecklist(input.checklist).map((checklist) => ({ checklist })),
      input.deadlineOffsetDays === undefined
        ? ok({})
        : parseDeadlineOffset(input.deadlineOffsetDays).map((deadlineOffsetDays) => ({ deadlineOffsetDays })),
    ]);
    if (fields.isErr()) return err<{ changed: boolean }, PlannerError>(fields.error);
    const patch: TemplateFields = Object.assign({}, ...fields.value);
    return ok<{ changed: boolean }, PlannerError>({ changed: await record.patch("templates", templateId, patch) });
  },
});

export const reorder = changeMutation({
  action: "template.reorder",
  args: { templateId: v.id("templates"), targetId: v.id("templates"), placement: v.union(v.literal("before"), v.literal("after")) },
  handler: async (ctx, { templateId, targetId, placement }, record) => {
    if (!(await templatesOn(ctx))) return err<{ changed: boolean }, PlannerError>(SWITCHED_OFF);
    const inputs = Result.combine(await Promise.all([load(ctx, "templates", templateId), load(ctx, "templates", targetId)]));
    if (inputs.isErr()) return err<{ changed: boolean }, PlannerError>(inputs.error);
    const [template, target] = inputs.value;
    const before = placement === "before";
    const neighbour = await ctx.db.query("templates")
      .withIndex("by_order", (q) => before ? q.lt("order", target.order) : q.gt("order", target.order))
      .order(before ? "desc" : "asc")
      .first();
    if (templateId === targetId || neighbour?._id === templateId) return ok<{ changed: boolean }, PlannerError>({ changed: false });
    const order = before
      ? generateKeyBetween(neighbour?.order ?? null, target.order)
      : generateKeyBetween(target.order, neighbour?.order ?? null);
    return ok<{ changed: boolean }, PlannerError>({ changed: await record.patch("templates", template._id, { order }) });
  },
});

export const remove = changeMutation({
  action: "template.remove",
  args: { templateId: v.id("templates") },
  handler: async (ctx, { templateId }, record) => {
    if (!(await templatesOn(ctx))) return err<{ changed: boolean }, PlannerError>(SWITCHED_OFF);
    const template = await load(ctx, "templates", templateId);
    if (template.isErr()) return err<{ changed: boolean }, PlannerError>(template.error);
    return ok<{ changed: boolean }, PlannerError>({ changed: await record.remove("templates", templateId) });
  },
});
