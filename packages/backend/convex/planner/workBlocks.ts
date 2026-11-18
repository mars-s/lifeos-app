import { v } from "convex/values";
import { Result, err, ok } from "neverthrow";
import type { WithoutSystemFields } from "convex/server";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { Recorder } from "../platform/activity";
import { changeMutation } from "../platform/change";
import { load, type PlannerError } from "./model";

const MAX_BLOCK_MINUTES = 24 * 60;

type BlockFields = Partial<WithoutSystemFields<Doc<"workBlocks">>>;

const parseStart = (start: number) =>
  Number.isSafeInteger(start) && start > 0
    ? ok<number, PlannerError>(start)
    : err<number, PlannerError>({ kind: "invalid_block", reason: "start" });

const parseMinutes = (minutes: number) =>
  Number.isInteger(minutes) && minutes > 0 && minutes <= MAX_BLOCK_MINUTES
    ? ok<number, PlannerError>(minutes)
    : err<number, PlannerError>({ kind: "invalid_block", reason: "minutes" });

const isTimeZone = (timeZone: string) => {
  try {
    return new Intl.DateTimeFormat("en-AU", { timeZone }).resolvedOptions().timeZone.length > 0;
  } catch {
    return false;
  }
};

const parseTimeZone = (timeZone: string) =>
  isTimeZone(timeZone)
    ? ok<string, PlannerError>(timeZone)
    : err<string, PlannerError>({ kind: "invalid_block", reason: "time_zone" });

export const create = changeMutation({
  action: "workBlock.create",
  args: { taskId: v.id("tasks"), start: v.number(), minutes: v.number(), timeZone: v.string() },
  handler: async (ctx, { taskId, start, minutes, timeZone }, record) => {
    const task = await load(ctx, "tasks", taskId);
    if (task.isErr()) return err<{ blockId: Id<"workBlocks"> }, PlannerError>(task.error);
    const fields = Result.combine([parseStart(start), parseMinutes(minutes), parseTimeZone(timeZone)]);
    if (fields.isErr()) return err<{ blockId: Id<"workBlocks"> }, PlannerError>(fields.error);
    const [validStart, validMinutes, validZone] = fields.value;
    const blockId = await record.insert("workBlocks", {
      taskId,
      start: validStart,
      minutes: validMinutes,
      timeZone: validZone,
      done: false,
    });
    return ok<{ blockId: Id<"workBlocks"> }, PlannerError>({ blockId });
  },
});

const patchBlock = async (
  ctx: MutationCtx,
  record: Recorder,
  blockId: Id<"workBlocks">,
  fields: Result<BlockFields, PlannerError>,
) => {
  const block = await load(ctx, "workBlocks", blockId);
  if (block.isErr()) return err<{ changed: boolean }, PlannerError>(block.error);
  if (fields.isErr()) return err<{ changed: boolean }, PlannerError>(fields.error);
  return ok<{ changed: boolean }, PlannerError>({ changed: await record.patch("workBlocks", blockId, fields.value) });
};

export const move = changeMutation({
  action: "workBlock.move",
  args: { blockId: v.id("workBlocks"), start: v.number() },
  handler: (ctx, { blockId, start }, record) =>
    patchBlock(ctx, record, blockId, parseStart(start).map((valid) => ({ start: valid }))),
});

export const resize = changeMutation({
  action: "workBlock.resize",
  args: { blockId: v.id("workBlocks"), minutes: v.number() },
  handler: (ctx, { blockId, minutes }, record) =>
    patchBlock(ctx, record, blockId, parseMinutes(minutes).map((valid) => ({ minutes: valid }))),
});

export const complete = changeMutation({
  action: "workBlock.complete",
  args: { blockId: v.id("workBlocks"), done: v.boolean() },
  handler: (ctx, { blockId, done }, record) => patchBlock(ctx, record, blockId, ok({ done })),
});

export const remove = changeMutation({
  action: "workBlock.remove",
  args: { blockId: v.id("workBlocks") },
  handler: (ctx, { blockId }, record) => patchBlock(ctx, record, blockId, ok({ removedAt: Date.now() })),
});
