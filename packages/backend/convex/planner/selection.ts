import { v } from "convex/values";
import type { WithoutSystemFields } from "convex/server";
import { Clock, Effect, Result } from "effect";
import type { Doc, Id } from "../_generated/dataModel";
import { changing, reading, recording, type ChangeServices } from "../platform/effect";
import { SelectionTooLarge } from "./errors";
import { endFocusOnClosedTask } from "./focus";
import { followCompletion } from "./recurrence";
import { keyAfter, lastTaskOrder, load, parseDeadline, parseEstimate, parseParent, parseWhen, plannerChange } from "./model";
import { vParent, vWhen, type Parent } from "./tables";

const MAX_SELECTION = 500;

type TaskFields = Partial<WithoutSystemFields<Doc<"tasks">>>;
type FieldsFor = (task: Doc<"tasks">) => TaskFields;

const loadAll = Effect.fn("selection.loadAll")(function* (taskIds: Id<"tasks">[]) {
  const unique = [...new Set(taskIds)];
  if (unique.length > MAX_SELECTION) return yield* new SelectionTooLarge({ limit: MAX_SELECTION });
  const tasks: Doc<"tasks">[] = [];
  for (const id of unique) tasks.push(yield* load("tasks", id));
  return tasks;
});

const vTaskIds = v.array(v.id("tasks"));

const applyToAll = Effect.fn("selection.applyToAll")(function* <E, R extends ChangeServices>(
  taskIds: Id<"tasks">[],
  fieldsFor: Effect.Effect<FieldsFor, E, R>,
) {
  const tasks = yield* loadAll(taskIds);
  const fields = yield* fieldsFor;
  let changed = 0;
  for (const task of tasks) if (yield* recording((record) => record.patch("tasks", task._id, fields(task)))) changed += 1;
  return { changed };
});

const perTask = (fieldsFor: FieldsFor) => fieldsFor;

const always = (fields: TaskFields) => perTask(() => fields);

const sameParent = (a: Parent, b: Parent) =>
  (a.kind === "loose" && b.kind === "loose") ||
  (a.kind === "area" && b.kind === "area" && a.areaId === b.areaId) ||
  (a.kind === "project" && b.kind === "project" && a.projectId === b.projectId);

export const setWhen = plannerChange({
  action: "tasks.setWhen",
  args: { taskIds: vTaskIds, when: vWhen },
  handler: ({ taskIds, when }) =>
    applyToAll(taskIds, Effect.fromResult(Result.map(parseWhen(when), (valid) => always({ when: valid })))),
});

export const setDeadline = plannerChange({
  action: "tasks.setDeadline",
  args: { taskIds: vTaskIds, deadline: v.union(v.string(), v.null()) },
  handler: ({ taskIds, deadline }) =>
    applyToAll(taskIds, Effect.fromResult(Result.map(parseDeadline(deadline), (valid) => always({ deadline: valid })))),
});

export const setEstimate = plannerChange({
  action: "tasks.setEstimate",
  args: { taskIds: vTaskIds, minutes: v.union(v.number(), v.null()) },
  handler: ({ taskIds, minutes }) =>
    applyToAll(taskIds, Effect.fromResult(Result.map(parseEstimate(minutes), (valid) => always({ estimateMinutes: valid })))),
});

export const setLabel = plannerChange({
  action: "tasks.setLabel",
  args: { taskIds: vTaskIds, labelId: v.id("labels"), on: v.boolean() },
  handler: ({ taskIds, labelId, on }) =>
    applyToAll(
      taskIds,
      Effect.map(load("labels", labelId), () =>
        perTask((task) => {
          const others = task.labelIds.filter((id) => id !== labelId);
          return { labelIds: on ? [...others, labelId] : others };
        }),
      ),
    ),
});

export const move = plannerChange({
  action: "tasks.move",
  args: { taskIds: vTaskIds, parent: vParent },
  handler: Effect.fn("selection.move")(function* ({ taskIds, parent }) {
    let order = yield* reading((ctx) => lastTaskOrder(ctx, parent));
    return yield* applyToAll(
      taskIds,
      Effect.map(parseParent(parent), (valid) =>
        perTask((task) => {
          if (sameParent(task.parent, valid)) return {};
          order = keyAfter(order);
          return { parent: valid, order };
        }),
      ),
    );
  }),
});

export const complete = plannerChange({
  action: "tasks.complete",
  args: { taskIds: vTaskIds },
  handler: Effect.fn("selection.complete")(function* ({ taskIds }) {
    const at = yield* Clock.currentTimeMillis;
    return yield* applyToAll(
      taskIds,
      Effect.succeed(perTask((task) => (task.status.kind === "open" ? { status: { kind: "completed", at } } : {}))),
    ).pipe(
      Effect.ensuring(
        changing(async (ctx, record) => {
          await endFocusOnClosedTask(ctx, record, at);
          await followCompletion(ctx, record, taskIds, at);
        }),
      ),
    );
  }),
});

export const reopen = plannerChange({
  action: "tasks.reopen",
  args: { taskIds: vTaskIds },
  handler: ({ taskIds }) =>
    applyToAll(taskIds, Effect.succeed(perTask((task) => (task.status.kind === "open" ? {} : { status: { kind: "open" } })))).pipe(
      Effect.ensuring(Effect.flatMap(Clock.currentTimeMillis, (now) => changing((ctx, record) => followCompletion(ctx, record, taskIds, now)))),
    ),
});

export const trash = plannerChange({
  action: "tasks.trash",
  args: { taskIds: vTaskIds },
  handler: Effect.fn("selection.trash")(function* ({ taskIds }) {
    const at = yield* Clock.currentTimeMillis;
    return yield* applyToAll(taskIds, Effect.succeed(perTask((task) => (task.trashedAt === undefined ? { trashedAt: at } : {})))).pipe(
      Effect.ensuring(changing((ctx, record) => endFocusOnClosedTask(ctx, record, at))),
    );
  }),
});

export const restore = plannerChange({
  action: "tasks.restore",
  args: { taskIds: vTaskIds },
  handler: ({ taskIds }) => applyToAll(taskIds, Effect.succeed(always({ trashedAt: undefined }))),
});
