import { v } from "convex/values";
import { Clock, Effect } from "effect";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { Recorder } from "../platform/activity";
import type { EntityRef } from "../platform/tables";
import { requestTrip } from "../places/trips";
import { lastProjectOrder } from "./containers";
import { endFocusOnClosedTask } from "./focus";
import { changing, keyAfter, loadFx, plannerChange } from "./model";
import { requestSuggestion } from "./smartEstimates";
import type { When } from "./tables";

const CARRY_LIMIT = 500;

const projectArea = async (ctx: MutationCtx, task: Doc<"tasks">) => {
  if (task.parent.kind === "area") return task.parent.areaId;
  if (task.parent.kind === "project") return (await ctx.db.get("projects", task.parent.projectId))?.areaId;
  return undefined;
};

const projectWhen = (when: When) => (when.kind === "inbox" ? ({ kind: "anytime" } satisfies When) : when);

const carried = async (ctx: MutationCtx, taskId: Id<"tasks">) => {
  const [blocks, sessions, linksFrom, linksTo] = await Promise.all([
    ctx.db
      .query("workBlocks")
      .withIndex("by_task_start", (q) => q.eq("taskId", taskId))
      .take(CARRY_LIMIT),
    ctx.db
      .query("focusSessions")
      .withIndex("by_task_start", (q) => q.eq("taskId", taskId))
      .take(CARRY_LIMIT),
    ctx.db
      .query("entityLinks")
      .withIndex("by_from", (q) => q.eq("from.id", taskId))
      .take(CARRY_LIMIT),
    ctx.db
      .query("entityLinks")
      .withIndex("by_to", (q) => q.eq("to.id", taskId))
      .take(CARRY_LIMIT),
  ]);
  return { blocks, sessions, links: [...new Map([...linksFrom, ...linksTo].map((link) => [link._id, link])).values()] };
};

const carryOver = async (
  record: Recorder,
  from: Id<"tasks">,
  to: Id<"tasks">,
  { blocks, sessions, links }: Awaited<ReturnType<typeof carried>>,
) => {
  const moved = (ref: EntityRef) => (ref.id === from ? ({ table: "tasks", id: to } satisfies EntityRef) : ref);
  for (const block of blocks) await record.patch("workBlocks", block._id, { taskId: to });
  for (const session of sessions) await record.patch("focusSessions", session._id, { taskId: to });
  for (const link of links) await record.patch("entityLinks", link._id, { from: moved(link.from), to: moved(link.to) });
};

const convert = async (ctx: MutationCtx, record: Recorder, task: Doc<"tasks">, at: number) => {
  const taskId = task._id;
  const areaId = await projectArea(ctx, task);
  const projectId = await record.insert("projects", {
    title: task.title,
    notes: task.notes,
    ...(areaId ? { areaId } : {}),
    when: projectWhen(task.when),
    ...(task.deadline ? { deadline: task.deadline } : {}),
    labelIds: task.labelIds,
    status: { kind: "open" },
    order: keyAfter(await lastProjectOrder(ctx, areaId)),
  });
  const items = await ctx.db
    .query("checklistItems")
    .withIndex("by_task_order", (q) => q.eq("taskId", taskId))
    .take(CARRY_LIMIT);
  const history = await carried(ctx, taskId);
  const needsCarrier = items.length === 0 && history.blocks.length + history.sessions.length + history.links.length > 0;
  const steps = needsCarrier ? [{ title: task.title, done: false }] : items;
  const taskIds: Id<"tasks">[] = [];
  let order: string | undefined;
  for (const step of steps) {
    order = keyAfter(order);
    taskIds.push(
      await record.insert("tasks", {
        title: step.title,
        notes: "",
        when: { kind: "anytime" },
        parent: { kind: "project", projectId },
        labelIds: [],
        status: step.done ? { kind: "completed", at } : { kind: "open" },
        order,
      }),
    );
  }
  const carrier = taskIds[steps.findIndex((step) => !step.done)] ?? taskIds[0];
  if (carrier) await carryOver(record, taskId, carrier, history);
  if (task.trashedAt === undefined) await record.patch("tasks", taskId, { trashedAt: at });
  await endFocusOnClosedTask(ctx, record, at);
  for (const [index, id] of taskIds.entries()) {
    if (steps[index]?.done) continue;
    await requestSuggestion(ctx, id);
    await requestTrip(ctx, id);
  }
  return { projectId, taskIds };
};

export const toProject = plannerChange({
  action: "task.convertToProject",
  args: { taskId: v.id("tasks") },
  handler: Effect.fn("convert.toProject")(function* ({ taskId }) {
    const task = yield* loadFx("tasks", taskId);
    const at = yield* Clock.currentTimeMillis;
    return yield* changing((ctx, record) => convert(ctx, record, task, at));
  }),
});
