import { v } from "convex/values";
import { Result, err, ok } from "neverthrow";
import type { WithoutSystemFields } from "convex/server";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { Recorder } from "../platform/activity";
import { ownerQuery } from "../platform/access";
import { changeMutation } from "../platform/change";
import { parseRange } from "../calendar/commitments";
import { parseIsoDate } from "../../shared/date";
import { serialise } from "../../shared/result";
import { MAX_SPREAD_BLOCKS } from "../../shared/spread";
import { load, type PlannerError } from "./model";
import { enrich, isLive } from "./rows";

const MINUTE_MS = 60_000;

const MAX_BLOCK_MINUTES = 24 * 60;
const RANGE_LIMIT = 1000;

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

const parseDay = (date: string | undefined) =>
  date === undefined ? ok<string | undefined, PlannerError>(undefined) : parseIsoDate(date).map(String).mapErr<PlannerError>((error) => error);

export const create = changeMutation({
  action: "workBlock.create",
  args: { taskId: v.id("tasks"), start: v.number(), minutes: v.number(), timeZone: v.string(), date: v.optional(v.string()) },
  handler: async (ctx, { taskId, start, minutes, timeZone, date }, record) => {
    const task = await load(ctx, "tasks", taskId);
    if (task.isErr()) return err<{ blockId: Id<"workBlocks"> }, PlannerError>(task.error);
    const fields = Result.combine([parseStart(start), parseMinutes(minutes), parseTimeZone(timeZone), parseDay(date)]);
    if (fields.isErr()) return err<{ blockId: Id<"workBlocks"> }, PlannerError>(fields.error);
    const [validStart, validMinutes, validZone, day] = fields.value;
    const evening = task.value.when.kind === "scheduled" && task.value.when.evening;
    if (day) await record.patch("tasks", taskId, { when: { kind: "scheduled", date: day, evening } });
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

const vSpreadBlock = v.object({ taskId: v.id("tasks"), start: v.number(), minutes: v.number() });

type Moment = { readonly start: number; readonly minutes: number };

const endOf = (block: Moment) => block.start + block.minutes * MINUTE_MS;

const overlaps = (a: Moment, b: Moment) => a.start < endOf(b) && b.start < endOf(a);

const spreadRefused = (error: PlannerError) => err<{ blockIds: Id<"workBlocks">[] }, PlannerError>(error);

export const spread = changeMutation({
  action: "workBlock.spread",
  args: { blocks: v.array(vSpreadBlock), timeZone: v.string() },
  handler: async (ctx, { blocks, timeZone }, record) => {
    if (blocks.length === 0 || blocks.length > MAX_SPREAD_BLOCKS) return spreadRefused({ kind: "selection_too_large", limit: MAX_SPREAD_BLOCKS });
    const fields = Result.combine([
      parseTimeZone(timeZone),
      ...blocks.flatMap((block) => [parseStart(block.start), parseMinutes(block.minutes)]),
    ]);
    if (fields.isErr()) return spreadRefused(fields.error);
    const tasks = await Promise.all(blocks.map((block) => ctx.db.get("tasks", block.taskId)));
    const closed = blocks.find((_, index) => {
      const task = tasks[index];
      return !task || !isLive(task) || task.status.kind !== "open";
    });
    if (closed) return spreadRefused({ kind: "not_found", table: "tasks", id: closed.taskId });
    const earliest = Math.min(...blocks.map((block) => block.start));
    const latest = Math.max(...blocks.map(endOf));
    const existing = await ctx.db
      .query("workBlocks")
      .withIndex("by_removed_start", (q) => q.eq("removedAt", undefined).gte("start", earliest - MAX_BLOCK_MINUTES * MINUTE_MS).lt("start", latest))
      .take(RANGE_LIMIT);
    const clash = blocks.some(
      (block, index) => existing.some((other) => overlaps(block, other)) || blocks.slice(index + 1).some((other) => overlaps(block, other)),
    );
    if (clash) return spreadRefused({ kind: "invalid_block", reason: "overlap" });
    const blockIds: Id<"workBlocks">[] = [];
    for (const block of blocks) blockIds.push(await record.insert("workBlocks", { ...block, timeZone, done: false }));
    return ok<{ blockIds: Id<"workBlocks">[] }, PlannerError>({ blockIds });
  },
});

const patchBlock = async (
  ctx: MutationCtx,
  record: Recorder,
  blockId: Id<"workBlocks">,
  fields: Result<BlockFields, PlannerError>,
) => {
  const block = (await load(ctx, "workBlocks", blockId)).andThen((found) =>
    found.removedAt === undefined
      ? ok<Doc<"workBlocks">, PlannerError>(found)
      : err<Doc<"workBlocks">, PlannerError>({ kind: "not_found", table: "workBlocks", id: blockId }),
  );
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

export const range = ownerQuery({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from, to }) =>
    serialise(
      await parseRange(from, to).asyncMap(async (window) => {
        const blocks = await ctx.db
          .query("workBlocks")
          .withIndex("by_removed_start", (q) => q.eq("removedAt", undefined).gte("start", window.from).lt("start", window.to))
          .take(RANGE_LIMIT);
        const ids = [...new Set(blocks.map((block) => block.taskId))];
        const tasks = (await Promise.all(ids.map((id) => ctx.db.get("tasks", id)))).flatMap((task) => (task && isLive(task) ? [task] : []));
        const rows = new Map((await enrich(ctx, tasks)).map((row) => [row._id, row]));
        return blocks.flatMap(({ _id, taskId, start, minutes, done }) => {
          const task = rows.get(taskId);
          return task ? [{ _id, taskId, start, minutes, done, task }] : [];
        });
      }),
    ),
});
