import { v } from "convex/values";
import { Clock, Effect, Result } from "effect";
import type { WithoutSystemFields } from "convex/server";
import type { Doc, Id } from "../_generated/dataModel";
import { changeMutation, ownerQuery, reading, recording } from "../platform/effect";
import { parseRange } from "../calendar/commitments";
import { parseIsoDate } from "../../shared/date";
import { asWire } from "../../shared/result";
import { MAX_SPREAD_BLOCKS } from "../../shared/spread";
import { InvalidBlock, NotFound, SelectionTooLarge } from "./errors";
import { load } from "./model";
import { enrich, isLive } from "./rows";

const MINUTE_MS = 60_000;

const MAX_BLOCK_MINUTES = 24 * 60;
const RANGE_LIMIT = 1000;

type BlockFields = Partial<WithoutSystemFields<Doc<"workBlocks">>>;

const parseStart = (start: number) => {
  const parsed: Result.Result<number, InvalidBlock> =
    Number.isSafeInteger(start) && start > 0 ? Result.succeed(start) : Result.fail(new InvalidBlock({ reason: "start" }));
  return parsed;
};

const parseMinutes = (minutes: number) => {
  const parsed: Result.Result<number, InvalidBlock> =
    Number.isInteger(minutes) && minutes > 0 && minutes <= MAX_BLOCK_MINUTES
      ? Result.succeed(minutes)
      : Result.fail(new InvalidBlock({ reason: "minutes" }));
  return parsed;
};

const isTimeZone = (timeZone: string) => {
  try {
    return new Intl.DateTimeFormat("en-AU", { timeZone }).resolvedOptions().timeZone.length > 0;
  } catch {
    return false;
  }
};

const parseTimeZone = (timeZone: string) => {
  const parsed: Result.Result<string, InvalidBlock> = isTimeZone(timeZone)
    ? Result.succeed(timeZone)
    : Result.fail(new InvalidBlock({ reason: "time_zone" }));
  return parsed;
};

export const vNewBlock = v.object({ start: v.number(), minutes: v.number(), timeZone: v.string() });

export const parseNewBlock = (block: { start: number; minutes: number; timeZone: string }) =>
  Result.all([parseStart(block.start), parseMinutes(block.minutes), parseTimeZone(block.timeZone)]).pipe(
    Result.map(([start, minutes, timeZone]) => ({ start, minutes, timeZone })),
  );

const parseDay = (date: string | undefined) => (date === undefined ? Result.succeed(undefined) : parseIsoDate(date));

export const create = changeMutation({
  action: "workBlock.create",
  args: { taskId: v.id("tasks"), start: v.number(), minutes: v.number(), timeZone: v.string(), date: v.optional(v.string()) },
  handler: Effect.fn("workBlocks.create")(function* ({ taskId, start, minutes, timeZone, date }) {
    const task = yield* load("tasks", taskId);
    const [validStart, validMinutes, validZone, day] = yield* Effect.fromResult(
      Result.all([parseStart(start), parseMinutes(minutes), parseTimeZone(timeZone), parseDay(date)]),
    );
    const evening = task.when.kind === "scheduled" && task.when.evening;
    if (day) yield* recording((record) => record.patch("tasks", taskId, { when: { kind: "scheduled", date: day, evening } }));
    const blockId = yield* recording((record) =>
      record.insert("workBlocks", { taskId, start: validStart, minutes: validMinutes, timeZone: validZone, done: false }),
    );
    return { blockId };
  }),
});

const vSpreadBlock = v.object({ taskId: v.id("tasks"), start: v.number(), minutes: v.number() });

type Moment = { readonly start: number; readonly minutes: number };

const endOf = (block: Moment) => block.start + block.minutes * MINUTE_MS;

const overlaps = (a: Moment, b: Moment) => a.start < endOf(b) && b.start < endOf(a);

export const spread = changeMutation({
  action: "workBlock.spread",
  args: { blocks: v.array(vSpreadBlock), timeZone: v.string() },
  handler: Effect.fn("workBlocks.spread")(function* ({ blocks, timeZone }) {
    if (blocks.length === 0 || blocks.length > MAX_SPREAD_BLOCKS) return yield* new SelectionTooLarge({ limit: MAX_SPREAD_BLOCKS });
    yield* Effect.fromResult(
      Result.all([parseTimeZone(timeZone), ...blocks.flatMap((block) => [parseStart(block.start), parseMinutes(block.minutes)])]),
    );
    const tasks = yield* reading((ctx) => Promise.all(blocks.map((block) => ctx.db.get("tasks", block.taskId))));
    const closed = blocks.find((_, index) => {
      const task = tasks[index];
      return !task || !isLive(task) || task.status.kind !== "open";
    });
    if (closed) return yield* new NotFound({ table: "tasks", id: closed.taskId });
    const earliest = Math.min(...blocks.map((block) => block.start));
    const latest = Math.max(...blocks.map(endOf));
    const existing = yield* reading((ctx) =>
      ctx.db
        .query("workBlocks")
        .withIndex("by_removed_start", (q) => q.eq("removedAt", undefined).gte("start", earliest - MAX_BLOCK_MINUTES * MINUTE_MS).lt("start", latest))
        .take(RANGE_LIMIT),
    );
    const clash = blocks.some(
      (block, index) => existing.some((other) => overlaps(block, other)) || blocks.slice(index + 1).some((other) => overlaps(block, other)),
    );
    if (clash) return yield* new InvalidBlock({ reason: "overlap" });
    const blockIds: Id<"workBlocks">[] = [];
    for (const block of blocks) blockIds.push(yield* recording((record) => record.insert("workBlocks", { ...block, timeZone, done: false })));
    return { blockIds };
  }),
});

const liveBlock = Effect.fn("workBlocks.liveBlock")(function* (blockId: Id<"workBlocks">) {
  const block = yield* load("workBlocks", blockId);
  if (block.removedAt !== undefined) return yield* new NotFound({ table: "workBlocks", id: blockId });
  return block;
});

const patchBlock = Effect.fn("workBlocks.patchBlock")(function* (blockId: Id<"workBlocks">, fields: Effect.Effect<BlockFields, InvalidBlock>) {
  yield* liveBlock(blockId);
  const valid = yield* fields;
  return { changed: yield* recording((record) => record.patch("workBlocks", blockId, valid)) };
});

export const move = changeMutation({
  action: "workBlock.move",
  args: { blockId: v.id("workBlocks"), start: v.number() },
  handler: ({ blockId, start }) => patchBlock(blockId, Effect.map(Effect.fromResult(parseStart(start)), (valid) => ({ start: valid }))),
});

export const resize = changeMutation({
  action: "workBlock.resize",
  args: { blockId: v.id("workBlocks"), minutes: v.number() },
  handler: ({ blockId, minutes }) => patchBlock(blockId, Effect.map(Effect.fromResult(parseMinutes(minutes)), (valid) => ({ minutes: valid }))),
});

export const complete = changeMutation({
  action: "workBlock.complete",
  args: { blockId: v.id("workBlocks"), done: v.boolean() },
  handler: ({ blockId, done }) => patchBlock(blockId, Effect.succeed({ done })),
});

export const remove = changeMutation({
  action: "workBlock.remove",
  args: { blockId: v.id("workBlocks") },
  handler: ({ blockId }) => patchBlock(blockId, Effect.map(Clock.currentTimeMillis, (removedAt) => ({ removedAt }))),
});

const blocksBetween = Effect.fn("workBlocks.blocksBetween")(function* (from: number, to: number) {
  const blocks = yield* reading((ctx) =>
    ctx.db
      .query("workBlocks")
      .withIndex("by_removed_start", (q) => q.eq("removedAt", undefined).gte("start", from).lt("start", to))
      .take(RANGE_LIMIT),
  );
  const rows = yield* reading(async (ctx) => {
    const ids = [...new Set(blocks.map((block) => block.taskId))];
    const tasks = (await Promise.all(ids.map((id) => ctx.db.get("tasks", id)))).flatMap((task) => (task && isLive(task) ? [task] : []));
    return new Map((await enrich(ctx, tasks)).map((row) => [row._id, row]));
  });
  return blocks.flatMap(({ _id, taskId, start, minutes, done }) => {
    const task = rows.get(taskId);
    return task ? [{ _id, taskId, start, minutes, done, task }] : [];
  });
});

export const range = ownerQuery({
  args: { from: v.number(), to: v.number() },
  handler: ({ from, to }) =>
    asWire(
      Effect.gen(function* () {
        const window = yield* Effect.fromResult(parseRange(from, to));
        return yield* blocksBetween(window.from, window.to);
      }),
    ),
});
