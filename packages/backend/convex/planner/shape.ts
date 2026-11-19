import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { Recorder } from "../platform/activity";
import { addDays, daysBetween, type IsoDate } from "../../shared/date";
import { requestTrip } from "../places/trips";
import { keyAfter, lastTaskOrder } from "./model";
import { areaSummary, projectSummary } from "./rows";
import { requestSuggestion } from "./smartEstimates";
import type { Parent, TaskShape, When } from "./tables";

export const MAX_SHAPE_CHECKLIST = 100;
export const MAX_DEADLINE_OFFSET_DAYS = 365;

export const scheduledDate = (when: When) => (when.kind === "scheduled" ? (when.date as IsoDate) : undefined);

const offsetDays = (from: IsoDate, deadline: IsoDate) => Math.min(Math.max(daysBetween(from, deadline), 0), MAX_DEADLINE_OFFSET_DAYS);

export const snapshotTask = async (ctx: QueryCtx, task: Doc<"tasks">, today: IsoDate) => {
  const items = await ctx.db
    .query("checklistItems")
    .withIndex("by_task_order", (q) => q.eq("taskId", task._id))
    .take(MAX_SHAPE_CHECKLIST);
  return {
    title: task.title,
    notes: task.notes,
    ...(task.estimateMinutes === undefined ? {} : { estimateMinutes: task.estimateMinutes }),
    labelIds: task.labelIds,
    parent: task.parent,
    checklist: items.map((item) => item.title),
    ...(task.deadline === undefined
      ? {}
      : { deadlineOffsetDays: offsetDays(scheduledDate(task.when) ?? today, task.deadline as IsoDate) }),
  } satisfies TaskShape;
};

export type Placement = {
  readonly when: When;
  readonly date: IsoDate;
  readonly parent: Parent;
  readonly repeat?: { readonly ruleId: Id<"recurrenceRules">; readonly date: IsoDate };
};

export const createFromShape = async (ctx: MutationCtx, record: Recorder, shape: TaskShape, placement: Placement) => {
  const labels = await Promise.all(shape.labelIds.map((id) => ctx.db.get("labels", id)));
  const taskId = await record.insert("tasks", {
    title: shape.title,
    notes: shape.notes,
    when: placement.when,
    ...(shape.deadlineOffsetDays === undefined ? {} : { deadline: addDays(placement.date, shape.deadlineOffsetDays) }),
    ...(shape.estimateMinutes === undefined ? {} : { estimateMinutes: shape.estimateMinutes }),
    parent: placement.parent,
    labelIds: labels.flatMap((label) => (label ? [label._id] : [])),
    status: { kind: "open" },
    order: keyAfter(await lastTaskOrder(ctx, placement.parent)),
    ...(placement.repeat ? { repeat: placement.repeat } : {}),
  });
  let order: string | undefined;
  for (const title of shape.checklist) {
    order = keyAfter(order);
    await record.insert("checklistItems", { taskId, title, done: false, order });
  }
  await requestSuggestion(ctx, taskId);
  await requestTrip(ctx, taskId);
  return taskId;
};

export const homeSummary = async (ctx: QueryCtx, parent: Parent) => {
  const project = parent.kind === "project" ? await ctx.db.get("projects", parent.projectId) : null;
  const areaId = parent.kind === "area" ? parent.areaId : project?.areaId;
  const area = areaId ? await ctx.db.get("areas", areaId) : null;
  return { area: area ? areaSummary(area) : undefined, project: project ? projectSummary(project) : undefined };
};
