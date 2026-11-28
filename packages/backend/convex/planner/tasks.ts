import { v } from "convex/values";
import type { WithoutSystemFields } from "convex/server";
import { Clock, Effect, Result } from "effect";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { ownerQuery, reading, recording, type ChangeServices } from "../platform/effect";
import {
  changing,
  keyAfter,
  lastTaskOrder,
  loadFx,
  nextTaskOrder,
  parseDeadline,
  parseEstimate,
  parseLabels,
  parseOrder,
  parseParent,
  parseTitleFx,
  parseWhen,
  plannerChange,
} from "./model";
import { NotFound } from "./errors";
import { endFocusOnClosedTask } from "./focus";
import { requestTrip } from "../places/trips";
import { requestSuggestion } from "./smartEstimates";
import { followCompletion } from "./recurrence";
import { parseNewPlaceFx, placeOnDayFx } from "./plan";
import { enrich } from "./rows";
import { vParent, vWhen } from "./tables";
import type { IsoDate } from "../../shared/date";
import { parseNewBlockFx, vNewBlock } from "./workBlocks";

const CARD_LIMIT = 500;

type TaskFields = Partial<WithoutSystemFields<Doc<"tasks">>>;

const edit = Effect.fn("tasks.edit")(function* <E, R extends ChangeServices>(
  taskId: Id<"tasks">,
  fieldsFor: (task: Doc<"tasks">) => Effect.Effect<TaskFields, E, R>,
) {
  const task = yield* loadFx("tasks", taskId);
  const fields = yield* fieldsFor(task);
  return { changed: yield* recording((record) => record.patch("tasks", taskId, fields)) };
});

const fieldsFrom =
  <E>(fields: Result.Result<TaskFields, E>) =>
  () =>
    Effect.fromResult(fields);

const suggestFor = (taskId: Id<"tasks">) =>
  changing(async (ctx) => {
    await requestSuggestion(ctx, taskId);
    await requestTrip(ctx, taskId);
  });

const placeNewTask = Effect.fn("tasks.placeNewTask")(function* (taskId: Id<"tasks">, place: { date: IsoDate; order: Id<"tasks">[]; at: number }) {
  const task = yield* reading((ctx) => ctx.db.get("tasks", taskId));
  if (!task) return yield* new NotFound({ table: "tasks", id: taskId });
  const order = [...place.order.slice(0, place.at), taskId, ...place.order.slice(place.at)];
  const evening = task.when.kind === "scheduled" && task.when.evening;
  yield* placeOnDayFx(task, place.date, order, evening);
});

export const create = plannerChange({
  action: "task.create",
  args: {
    title: v.string(),
    notes: v.optional(v.string()),
    when: v.optional(vWhen),
    deadline: v.optional(v.string()),
    estimateMinutes: v.optional(v.number()),
    parent: v.optional(vParent),
    labelIds: v.optional(v.array(v.id("labels"))),
    block: v.optional(vNewBlock),
    order: v.optional(v.string()),
    place: v.optional(v.object({ date: v.string(), order: v.array(v.id("tasks")), at: v.number() })),
  },
  handler: Effect.fn("tasks.create")(function* (args) {
    const block = args.block ? yield* Effect.fromResult(parseNewBlockFx(args.block)) : undefined;
    const [title, when, deadline, estimateMinutes, parent, labelIds, order, place] = yield* Effect.all([
      Effect.fromResult(parseTitleFx(args.title)),
      Effect.fromResult(parseWhen(args.when ?? { kind: "inbox" })),
      Effect.fromResult(parseDeadline(args.deadline ?? null)),
      Effect.fromResult(parseEstimate(args.estimateMinutes ?? null)),
      parseParent(args.parent ?? { kind: "loose" }),
      parseLabels(args.labelIds ?? []),
      args.order === undefined ? Effect.succeed(undefined) : Effect.fromResult(parseOrder(args.order)),
      args.place === undefined ? Effect.succeed(undefined) : Effect.fromResult(parseNewPlaceFx(args.place)),
    ]);
    const key = order ?? keyAfter(yield* reading((ctx) => lastTaskOrder(ctx, parent)));
    const taskId = yield* recording((record) =>
      record.insert("tasks", {
        title,
        notes: args.notes ?? "",
        when,
        ...(deadline ? { deadline } : {}),
        ...(estimateMinutes ? { estimateMinutes } : {}),
        parent,
        labelIds,
        status: { kind: "open" },
        order: key,
      }),
    );
    if (block) yield* recording((record) => record.insert("workBlocks", { taskId, ...block, done: false }));
    if (place) yield* placeNewTask(taskId, place);
    yield* suggestFor(taskId);
    return { taskId };
  }),
});

const DUPLICATE_ITEMS = 500;

export const duplicate = plannerChange({
  action: "task.duplicate",
  args: { taskId: v.id("tasks") },
  handler: Effect.fn("tasks.duplicate")(function* ({ taskId }) {
    const task = yield* loadFx("tasks", taskId);
    const order = yield* reading((ctx) => nextTaskOrder(ctx, task.parent, task.order));
    const copyId = yield* recording((record) =>
      record.insert("tasks", {
        title: task.title,
        notes: task.notes,
        when: task.when,
        ...(task.deadline ? { deadline: task.deadline } : {}),
        ...(task.estimateMinutes ? { estimateMinutes: task.estimateMinutes } : {}),
        parent: task.parent,
        labelIds: task.labelIds,
        status: { kind: "open" },
        order,
      }),
    );
    const items = yield* reading((ctx) =>
      ctx.db
        .query("checklistItems")
        .withIndex("by_task_order", (q) => q.eq("taskId", taskId))
        .take(DUPLICATE_ITEMS),
    );
    for (const item of items) {
      yield* recording((record) => record.insert("checklistItems", { taskId: copyId, title: item.title, done: item.done, order: item.order }));
    }
    yield* suggestFor(copyId);
    return { taskId: copyId };
  }),
});

export const rename = plannerChange({
  action: "task.rename",
  args: { taskId: v.id("tasks"), title: v.string() },
  handler: Effect.fn("tasks.rename")(function* ({ taskId, title }) {
    const result = yield* edit(taskId, fieldsFrom(Result.map(parseTitleFx(title), (valid) => ({ title: valid }))));
    if (result.changed) yield* suggestFor(taskId);
    return result;
  }),
});

export const setNotes = plannerChange({
  action: "task.setNotes",
  args: { taskId: v.id("tasks"), notes: v.string() },
  handler: ({ taskId, notes }) => edit(taskId, fieldsFrom(Result.succeed({ notes }))),
});

export const setWhen = plannerChange({
  action: "task.setWhen",
  args: { taskId: v.id("tasks"), when: vWhen },
  handler: ({ taskId, when }) => edit(taskId, fieldsFrom(Result.map(parseWhen(when), (valid) => ({ when: valid })))),
});

export const setDeadline = plannerChange({
  action: "task.setDeadline",
  args: { taskId: v.id("tasks"), deadline: v.union(v.string(), v.null()) },
  handler: ({ taskId, deadline }) => edit(taskId, fieldsFrom(Result.map(parseDeadline(deadline), (valid) => ({ deadline: valid })))),
});

export const setEstimate = plannerChange({
  action: "task.setEstimate",
  args: { taskId: v.id("tasks"), minutes: v.union(v.number(), v.null()) },
  handler: ({ taskId, minutes }) =>
    edit(taskId, fieldsFrom(Result.map(parseEstimate(minutes), (valid) => ({ estimateMinutes: valid })))),
});

export const setLabels = plannerChange({
  action: "task.setLabels",
  args: { taskId: v.id("tasks"), labelIds: v.array(v.id("labels")) },
  handler: ({ taskId, labelIds }) => edit(taskId, () => Effect.map(parseLabels(labelIds), (valid) => ({ labelIds: valid }))),
});

export const move = plannerChange({
  action: "task.move",
  args: { taskId: v.id("tasks"), parent: vParent, order: v.optional(v.string()) },
  handler: ({ taskId, parent, order }) =>
    edit(taskId, () =>
      Effect.gen(function* () {
        const validParent = yield* parseParent(parent);
        const key =
          order === undefined ? keyAfter(yield* reading((ctx) => lastTaskOrder(ctx, parent))) : yield* Effect.fromResult(parseOrder(order));
        return { parent: validParent, order: key };
      }),
    ),
});

export const reorder = plannerChange({
  action: "task.reorder",
  args: { taskId: v.id("tasks"), order: v.string() },
  handler: ({ taskId, order }) => edit(taskId, fieldsFrom(Result.map(parseOrder(order), (valid) => ({ order: valid })))),
});

export const complete = plannerChange({
  action: "task.complete",
  args: { taskId: v.id("tasks") },
  handler: Effect.fn("tasks.complete")(function* ({ taskId }) {
    const at = yield* Clock.currentTimeMillis;
    return yield* edit(taskId, (task) =>
      Effect.succeed<TaskFields>(task.status.kind === "completed" ? {} : { status: { kind: "completed", at } }),
    ).pipe(
      Effect.ensuring(
        changing(async (ctx, record) => {
          await endFocusOnClosedTask(ctx, record, at);
          await followCompletion(ctx, record, [taskId], at);
        }),
      ),
    );
  }),
});

export const uncomplete = plannerChange({
  action: "task.uncomplete",
  args: { taskId: v.id("tasks") },
  handler: ({ taskId }) =>
    edit(taskId, () => Effect.succeed<TaskFields>({ status: { kind: "open" } })).pipe(
      Effect.ensuring(Effect.flatMap(Clock.currentTimeMillis, (now) => changing((ctx, record) => followCompletion(ctx, record, [taskId], now)))),
    ),
});

export const trash = plannerChange({
  action: "task.trash",
  args: { taskId: v.id("tasks") },
  handler: Effect.fn("tasks.trash")(function* ({ taskId }) {
    const at = yield* Clock.currentTimeMillis;
    return yield* edit(taskId, (task) => Effect.succeed<TaskFields>(task.trashedAt === undefined ? { trashedAt: at } : {})).pipe(
      Effect.ensuring(changing((ctx, record) => endFocusOnClosedTask(ctx, record, at))),
    );
  }),
});

export const restore = plannerChange({
  action: "task.restore",
  args: { taskId: v.id("tasks") },
  handler: ({ taskId }) => edit(taskId, () => Effect.succeed<TaskFields>({ trashedAt: undefined })),
});

export const row = ownerQuery({
  args: { taskId: v.id("tasks") },
  handler: ({ taskId }) =>
    reading(async (ctx) => {
      const task = await ctx.db.get("tasks", taskId);
      const [found] = task ? await enrich(ctx, [task]) : [];
      return found ?? null;
    }),
});

const cardOf = async (ctx: QueryCtx, taskId: Id<"tasks">) => {
  const task = await ctx.db.get("tasks", taskId);
  if (!task) return null;
  const [checklist, blocks] = await Promise.all([
    ctx.db
      .query("checklistItems")
      .withIndex("by_task_order", (q) => q.eq("taskId", taskId))
      .take(CARD_LIMIT),
    ctx.db
      .query("workBlocks")
      .withIndex("by_task_start", (q) => q.eq("taskId", taskId))
      .take(CARD_LIMIT),
  ]);
  return { ...task, checklist, workBlocks: blocks.filter((block) => block.removedAt === undefined) };
};

export const card = ownerQuery({
  args: { taskId: v.id("tasks") },
  handler: ({ taskId }) => reading((ctx) => cardOf(ctx, taskId)),
});
