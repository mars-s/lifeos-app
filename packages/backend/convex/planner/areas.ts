import { v } from "convex/values";
import type { WithoutSystemFields } from "convex/server";
import { Clock, Effect, Result } from "effect";
import type { Doc, Id } from "../_generated/dataModel";
import { changing, reading, recording } from "../platform/effect";
import { endFocusOnClosedTask } from "./focus";
import { isIcon, lastAreaOrder, nextAreaColour, restoreArea, trashArea } from "./containers";
import { InvalidIcon } from "./errors";
import { keyAfter, load, parseOrder, parseTitle, plannerChange } from "./model";
import { vColour } from "./tables";

type AreaFields = Partial<WithoutSystemFields<Doc<"areas">>>;

const parseIcon = (icon: string | null) => {
  const parsed: Result.Result<string | undefined, InvalidIcon> =
    icon === null ? Result.succeed(undefined) : isIcon(icon) ? Result.succeed(icon) : Result.fail(new InvalidIcon({ icon }));
  return parsed;
};

const edit = Effect.fn("areas.edit")(function* <E>(areaId: Id<"areas">, fields: Result.Result<AreaFields, E>) {
  yield* load("areas", areaId);
  const valid = yield* Effect.fromResult(fields);
  return { changed: yield* recording((record) => record.patch("areas", areaId, valid)) };
});

export const create = plannerChange({
  action: "area.create",
  args: { title: v.string(), colour: v.optional(vColour), icon: v.optional(v.string()) },
  handler: Effect.fn("areas.create")(function* (args) {
    const [title, icon] = yield* Effect.fromResult(Result.all([parseTitle(args.title), parseIcon(args.icon ?? null)]));
    const colour = args.colour ?? (yield* reading(nextAreaColour));
    const order = keyAfter(yield* reading(lastAreaOrder));
    const areaId = yield* recording((record) => record.insert("areas", { title, colour, ...(icon ? { icon } : {}), order }));
    return { areaId };
  }),
});

export const rename = plannerChange({
  action: "area.rename",
  args: { areaId: v.id("areas"), title: v.string() },
  handler: ({ areaId, title }) => edit(areaId, Result.map(parseTitle(title), (valid) => ({ title: valid }))),
});

export const setColour = plannerChange({
  action: "area.setColour",
  args: { areaId: v.id("areas"), colour: vColour },
  handler: ({ areaId, colour }) => edit(areaId, Result.succeed({ colour })),
});

export const setIcon = plannerChange({
  action: "area.setIcon",
  args: { areaId: v.id("areas"), icon: v.union(v.string(), v.null()) },
  handler: ({ areaId, icon }) => edit(areaId, Result.map(parseIcon(icon), (valid) => ({ icon: valid }))),
});

export const reorder = plannerChange({
  action: "area.reorder",
  args: { areaId: v.id("areas"), order: v.string() },
  handler: ({ areaId, order }) => edit(areaId, Result.map(parseOrder(order), (valid) => ({ order: valid }))),
});

export const trash = plannerChange({
  action: "area.trash",
  args: { areaId: v.id("areas") },
  handler: Effect.fn("areas.trash")(function* ({ areaId }) {
    const area = yield* load("areas", areaId);
    const at = yield* Clock.currentTimeMillis;
    yield* trashArea(area, at);
    yield* changing((ctx, record) => endFocusOnClosedTask(ctx, record, at));
    return { changed: area.trashedAt === undefined };
  }),
});

export const restore = plannerChange({
  action: "area.restore",
  args: { areaId: v.id("areas") },
  handler: Effect.fn("areas.restore")(function* ({ areaId }) {
    const area = yield* load("areas", areaId);
    yield* restoreArea(area);
    return { changed: area.trashedAt !== undefined };
  }),
});
