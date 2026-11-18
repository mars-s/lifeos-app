import { v } from "convex/values";
import type { WithoutSystemFields } from "convex/server";
import { Result, err, ok } from "neverthrow";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { Recorder } from "../platform/activity";
import { changeMutation } from "../platform/change";
import { endFocusOnClosedTask } from "./focus";
import { isIcon, lastAreaOrder, nextAreaColour, restoreArea, trashArea } from "./containers";
import { keyAfter, load, parseOrder, parseTitle, type PlannerError } from "./model";
import { vColour } from "./tables";

type AreaFields = Partial<WithoutSystemFields<Doc<"areas">>>;

const parseIcon = (icon: string | null) =>
  icon === null
    ? ok<string | undefined, PlannerError>(undefined)
    : isIcon(icon)
      ? ok<string | undefined, PlannerError>(icon)
      : err<string | undefined, PlannerError>({ kind: "invalid_icon", icon });

const edit = async (ctx: MutationCtx, record: Recorder, areaId: Id<"areas">, fields: Result<AreaFields, PlannerError>) => {
  const area = await load(ctx, "areas", areaId);
  const valid = Result.combine([area, fields]);
  if (valid.isErr()) return err<{ changed: boolean }, PlannerError>(valid.error);
  return ok<{ changed: boolean }, PlannerError>({ changed: await record.patch("areas", areaId, valid.value[1]) });
};

export const create = changeMutation({
  action: "area.create",
  args: { title: v.string(), colour: v.optional(vColour), icon: v.optional(v.string()) },
  handler: async (ctx, args, record) => {
    const fields = Result.combine([parseTitle(args.title), parseIcon(args.icon ?? null)]);
    if (fields.isErr()) return err<{ areaId: Id<"areas"> }, PlannerError>(fields.error);
    const [title, icon] = fields.value;
    const areaId = await record.insert("areas", {
      title,
      colour: args.colour ?? (await nextAreaColour(ctx)),
      ...(icon ? { icon } : {}),
      order: keyAfter(await lastAreaOrder(ctx)),
    });
    return ok<{ areaId: Id<"areas"> }, PlannerError>({ areaId });
  },
});

export const rename = changeMutation({
  action: "area.rename",
  args: { areaId: v.id("areas"), title: v.string() },
  handler: (ctx, { areaId, title }, record) => edit(ctx, record, areaId, parseTitle(title).map((valid) => ({ title: valid }))),
});

export const setColour = changeMutation({
  action: "area.setColour",
  args: { areaId: v.id("areas"), colour: vColour },
  handler: (ctx, { areaId, colour }, record) => edit(ctx, record, areaId, ok({ colour })),
});

export const setIcon = changeMutation({
  action: "area.setIcon",
  args: { areaId: v.id("areas"), icon: v.union(v.string(), v.null()) },
  handler: (ctx, { areaId, icon }, record) => edit(ctx, record, areaId, parseIcon(icon).map((valid) => ({ icon: valid }))),
});

export const reorder = changeMutation({
  action: "area.reorder",
  args: { areaId: v.id("areas"), order: v.string() },
  handler: (ctx, { areaId, order }, record) => edit(ctx, record, areaId, parseOrder(order).map((valid) => ({ order: valid }))),
});

export const trash = changeMutation({
  action: "area.trash",
  args: { areaId: v.id("areas") },
  handler: async (ctx, { areaId }, record) =>
    (await load(ctx, "areas", areaId)).asyncMap(async (area) => {
      const at = Date.now();
      await trashArea(ctx, record, area, at);
      await endFocusOnClosedTask(ctx, record, at);
      return { changed: area.trashedAt === undefined };
    }),
});

export const restore = changeMutation({
  action: "area.restore",
  args: { areaId: v.id("areas") },
  handler: async (ctx, { areaId }, record) =>
    (await load(ctx, "areas", areaId)).asyncMap(async (area) => {
      await restoreArea(ctx, record, area);
      return { changed: area.trashedAt !== undefined };
    }),
});
