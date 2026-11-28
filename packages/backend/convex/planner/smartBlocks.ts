import { v } from "convex/values";
import { Clock, Effect, Result } from "effect";
import type { WithoutSystemFields } from "convex/server";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { changeMutation, ownerQuery, Reads, reading, recording } from "../platform/effect";
import { featureReady, featureState } from "../platform/features";
import { capacityDays } from "../calendar/capacity";
import { commitmentsBetween } from "../calendar/commitments";
import { blocksTime, MINUTE_MS, parseTimeZone, zonedMoment } from "../calendar/model";
import { addDays, type IsoDate } from "../../shared/date";
import { effectFromNeverthrow, fromNeverthrow } from "../../shared/effect/bridge";
import { parseIsoDate } from "../../shared/effect/date";
import { InvalidSchedule } from "../../shared/effect/errors";
import { parseSchedule } from "../../shared/effect/recurrence";
import { asWire } from "../../shared/effect/wire";
import { FOREVER, isWindow, occursOnDate, type FillSnapshot, type FillTask } from "../../shared/smartBlocks";
import { FeatureOff, InvalidSmartBlock, NotFound } from "./errors";
import { load, parseTitle, type PlannerError } from "./model";
import { isLive } from "./rows";
import { guessesFor } from "./smartEstimates";
import { vCalendarSchedule, vColour, vSmartBlockFilter, type CalendarSchedule, type SmartBlockFilter } from "./tables";

const MAX_RANGE_DAYS = 62;
const SERIES_LIMIT = 200;
const POOL_LIMIT = 1000;
const BLOCK_LIMIT = 1000;
const AREA_LIMIT = 200;
const MAX_FILL_BLOCKS = 50;
const FREE_DAYS = 31;
const MAX_BLOCK_MS = 24 * 60 * MINUTE_MS;
const DEFAULT_COLOUR = "teal";

type SmartBlock = Doc<"smartBlocks">;
type SmartBlockFields = Partial<WithoutSystemFields<SmartBlock>>;
type SmartBlockFault = (typeof InvalidSmartBlock.fields.reason)["Type"];
type Series = Pick<SmartBlockFields, "repeat" | "until">;

const refused = (reason: SmartBlockFault) => new InvalidSmartBlock({ reason });

const smartBlocksOn = (ctx: QueryCtx) => featureReady(ctx, "smartBlocks");

const parseZone = (timeZone: string) => {
  const zone: Result.Result<string, unknown> = fromNeverthrow(parseTimeZone(timeZone));
  return Result.mapError(zone, () => refused("time_zone"));
};

const parseName = (title: string) => {
  const named: Result.Result<string, PlannerError> = fromNeverthrow(parseTitle(title));
  return named;
};

const parseWindow = (startMinute: number, endMinute: number) => {
  const parsed: Result.Result<{ startMinute: number; endMinute: number }, InvalidSmartBlock> = isWindow(startMinute, endMinute)
    ? Result.succeed({ startMinute, endMinute })
    : Result.fail(refused("window"));
  return parsed;
};

const unique = <T>(values: readonly T[]) => [...new Set(values)];

const cleanFilter = (filter: SmartBlockFilter) => ({
  areaIds: unique(filter.areaIds),
  projectIds: unique(filter.projectIds),
  labelIds: unique(filter.labelIds),
});

const vRepeatInput = v.object({ schedule: vCalendarSchedule, until: v.optional(v.string()) });

type RepeatInput = { schedule: CalendarSchedule; until?: string | undefined };

const seriesOf = (date: IsoDate, schedule: CalendarSchedule, end: string, skipped: readonly string[]) => {
  const parsed: Result.Result<Series, InvalidSchedule> =
    end < date ? Result.fail(new InvalidSchedule({ reason: "end" })) : Result.succeed({ repeat: { schedule, skipped: [...skipped] }, until: end });
  return parsed;
};

const parseRepeat = (date: IsoDate, repeat: RepeatInput | null | undefined, skipped: readonly string[]) => {
  if (!repeat) {
    const single: Result.Result<Series, never> = Result.succeed({ repeat: undefined, until: date });
    return single;
  }
  const until = repeat.until === undefined ? Result.succeed(FOREVER) : Result.map(parseIsoDate(repeat.until), String);
  return Result.flatMap(Result.all([parseSchedule(repeat.schedule), until]), ([schedule, end]) =>
    seriesOf(date, schedule as CalendarSchedule, end, skipped),
  );
};

export const windowOf = (block: Pick<SmartBlock, "startMinute" | "endMinute" | "timeZone">, date: IsoDate) => ({
  start: zonedMoment(date, block.startMinute, block.timeZone),
  end: zonedMoment(date, block.endMinute, block.timeZone),
});

const liveBlock = Effect.fn("smartBlocks.liveBlock")(function* (blockId: Id<"smartBlocks">) {
  const block = yield* Reads.use((ctx) => effectFromNeverthrow(() => load(ctx, "smartBlocks", blockId)));
  if (block.removedAt !== undefined) return yield* new NotFound({ table: "smartBlocks", id: blockId });
  return block;
});

const occurrenceOf = Effect.fn("smartBlocks.occurrenceOf")(function* (blockId: Id<"smartBlocks">, date: string) {
  const block = yield* liveBlock(blockId);
  const day = yield* Effect.fromResult(parseIsoDate(date));
  if (!occursOnDate(block, day)) return yield* refused("occurrence");
  return { block, date: day };
});

export const areaPriority = async (ctx: QueryCtx) => {
  const [{ settings }, areas] = await Promise.all([
    featureState(ctx, "smartBlocks"),
    ctx.db.query("areas").withIndex("by_order").take(AREA_LIMIT),
  ]);
  const live = areas.filter(isLive);
  const rank = new Map(settings.areaOrder.map((areaId, index) => [areaId as string, index]));
  const sidebar = new Map(live.map((area, index) => [area._id as string, index]));
  const place = (area: Doc<"areas">) => rank.get(area._id) ?? settings.areaOrder.length + (sidebar.get(area._id) ?? 0);
  return live.toSorted((a, b) => place(a) - place(b)).map(({ _id, title, colour, icon }) => ({ _id, title, colour, icon }));
};

const linkedBlocks = async (ctx: QueryCtx, from: number, to: number) =>
  ctx.db
    .query("workBlocks")
    .withIndex("by_removed_start", (q) => q.eq("removedAt", undefined).gte("start", from).lt("start", to))
    .take(BLOCK_LIMIT);

const seriesFrom = async (ctx: QueryCtx, from: IsoDate) =>
  ctx.db
    .query("smartBlocks")
    .withIndex("by_removed_until", (q) => q.eq("removedAt", undefined).gte("until", from))
    .take(SERIES_LIMIT);

export const occurrencesIn = async (ctx: QueryCtx, from: IsoDate, days: number) => {
  const series = await seriesFrom(ctx, from);
  const dates = Array.from({ length: days }, (_, index) => addDays(from, index));
  return dates.flatMap((date) =>
    series.filter((block) => occursOnDate(block, date)).map((block) => ({ block, date, window: windowOf(block, date) })),
  );
};

const filledOf = (fills: readonly Doc<"workBlocks">[]) => ({
  filled: fills.length,
  filledMinutes: fills.reduce((sum, fill) => sum + fill.minutes, 0),
});

const occurrenceRows = Effect.fn("smartBlocks.occurrenceRows")(function* (from: IsoDate, days: number, timeZone: string) {
  if (!(yield* reading(smartBlocksOn))) return { on: false, occurrences: [] };
  const occurrences = yield* reading((ctx) => occurrencesIn(ctx, from, days));
  const first = zonedMoment(from, 0, timeZone) - MAX_BLOCK_MS;
  const last = zonedMoment(addDays(from, days), 0, timeZone) + MAX_BLOCK_MS;
  const fills = occurrences.length === 0 ? [] : (yield* reading((ctx) => linkedBlocks(ctx, first, last))).filter((block) => block.smartBlock);
  return {
    on: true,
    occurrences: occurrences.map(({ block, date, window }) => ({
      blockId: block._id,
      date,
      title: block.title,
      colour: block.colour,
      start: window.start,
      end: window.end,
      startMinute: block.startMinute,
      endMinute: block.endMinute,
      timeZone: block.timeZone,
      filter: block.filter,
      repeat: block.repeat ? { schedule: block.repeat.schedule, until: block.until === FOREVER ? null : block.until } : null,
      detached: block.detachedFrom !== undefined,
      ...filledOf(fills.filter((fill) => fill.smartBlock?.blockId === block._id && fill.smartBlock.date === date)),
    })),
  };
});

const parseDays = (days: number) => {
  const parsed: Result.Result<number, InvalidSmartBlock> =
    Number.isInteger(days) && days >= 1 && days <= MAX_RANGE_DAYS ? Result.succeed(days) : Result.fail(refused("window"));
  return parsed;
};

export const range = ownerQuery({
  args: { from: v.string(), days: v.number(), timeZone: v.string() },
  handler: (args) =>
    asWire(
      Effect.gen(function* () {
        const [from, days, timeZone] = yield* Effect.fromResult(Result.all([parseIsoDate(args.from), parseDays(args.days), parseZone(args.timeZone)]));
        return yield* occurrenceRows(from, days, timeZone);
      }),
    ),
});

const minuteOf = (instant: number) => Math.round(instant / MINUTE_MS);

const poolOf = async (ctx: QueryCtx, date: IsoDate) => {
  const [scheduled, anytime] = await Promise.all([
    ctx.db
      .query("tasks")
      .withIndex("by_trashed_status_when", (q) =>
        q.eq("trashedAt", undefined).eq("status.kind", "open").eq("when.kind", "scheduled").lte("when.date", date),
      )
      .take(POOL_LIMIT),
    ctx.db
      .query("tasks")
      .withIndex("by_trashed_status_when", (q) => q.eq("trashedAt", undefined).eq("status.kind", "open").eq("when.kind", "anytime"))
      .take(POOL_LIMIT),
  ]);
  return [...scheduled, ...anytime];
};

export const loadSnapshot = async (ctx: QueryCtx, date: IsoDate, timeZone: string) => {
  const dayStart = zonedMoment(date, 0, timeZone);
  const dayEnd = zonedMoment(addDays(date, 1), 0, timeZone);
  const [pool, nearby, commitments, areas, capacity] = await Promise.all([
    poolOf(ctx, date),
    linkedBlocks(ctx, dayStart - MAX_BLOCK_MS, dayEnd),
    commitmentsBetween(ctx, dayStart, dayEnd),
    areaPriority(ctx),
    capacityDays(ctx, date, FREE_DAYS, timeZone),
  ]);
  const projectIds = unique(pool.flatMap((task) => (task.parent.kind === "project" ? [task.parent.projectId] : [])));
  const [projects, guesses] = await Promise.all([Promise.all(projectIds.map((id) => ctx.db.get("projects", id))), guessesFor(ctx, pool)]);
  const projectArea = new Map(projects.flatMap((project) => (project ? [[project._id as string, project.areaId]] : [])));
  const guessed = new Map<string, number>(guesses.map((guess) => [guess.taskId, guess.minutes]));
  const colours = new Map(areas.map((area) => [area._id as string, area.colour]));
  const blocks = nearby.filter((block) => block.start + block.minutes * MINUTE_MS > dayStart);
  const tasks = pool.map((task) => {
    const areaId = task.parent.kind === "area" ? task.parent.areaId : task.parent.kind === "project" ? projectArea.get(task.parent.projectId) : undefined;
    return {
      _id: task._id,
      title: task.title,
      areaId,
      projectId: task.parent.kind === "project" ? task.parent.projectId : undefined,
      labelIds: task.labelIds,
      deadline: task.deadline,
      scheduled: task.when.kind === "scheduled" ? task.when.date : undefined,
      planOrder: task.plan?.date === date ? task.plan.order : undefined,
      createdAt: task._creationTime,
      estimateMinutes: task.estimateMinutes,
      guessMinutes: guessed.get(task._id),
      colour: areaId === undefined ? undefined : colours.get(areaId),
    } satisfies FillTask;
  });
  return {
    date,
    tasks,
    blocks: blocks.map((block) => ({
      blockId: block._id as string,
      taskId: block.taskId as string,
      start: minuteOf(block.start),
      minutes: block.minutes,
      smartBlock: block.smartBlock,
    })),
    busy: commitments.filter((row) => !row.allDay && blocksTime(row)).map((row) => ({ start: minuteOf(row.start), end: minuteOf(row.end) })),
    areas: areas.map(({ _id, title }) => ({ _id: _id as string, title })),
    freeMinutes: capacity.days.map((day) => day.freeMinutes),
  } satisfies FillSnapshot;
};

export const fillInputs = ownerQuery({
  args: { date: v.string(), timeZone: v.string() },
  handler: (args) =>
    asWire(
      Effect.gen(function* () {
        const [date, timeZone] = yield* Effect.fromResult(Result.all([parseIsoDate(args.date), parseZone(args.timeZone)]));
        return yield* reading(async (ctx) => ((await smartBlocksOn(ctx)) ? loadSnapshot(ctx, date, timeZone) : null));
      }),
    ),
});

export const priority = ownerQuery({ args: {}, handler: () => reading(areaPriority) });

const vFillBlock = v.object({ taskId: v.id("tasks"), start: v.number(), minutes: v.number() });

type FillBlockInput = { taskId: Id<"tasks">; start: number; minutes: number };

const overlaps = (a: { start: number; minutes: number }, b: { start: number; minutes: number }) =>
  a.start < b.start + b.minutes * MINUTE_MS && b.start < a.start + a.minutes * MINUTE_MS;

const checkFill = Effect.fn("smartBlocks.checkFill")(function* (
  block: Pick<SmartBlock, "startMinute" | "endMinute" | "timeZone">,
  blockId: Id<"smartBlocks"> | null,
  date: IsoDate,
  blocks: readonly FillBlockInput[],
  release: readonly Id<"workBlocks">[],
) {
  if (blocks.length > MAX_FILL_BLOCKS || release.length > MAX_FILL_BLOCKS) return yield* refused("too_many");
  const window = windowOf(block, date);
  const outside = blocks.some(
    (fill) => !Number.isSafeInteger(fill.start) || !Number.isInteger(fill.minutes) || fill.minutes <= 0 || fill.start < window.start || fill.start + fill.minutes * MINUTE_MS > window.end,
  );
  if (outside) return yield* refused("outside");
  const released = yield* reading((ctx) => Promise.all(release.map((id) => ctx.db.get("workBlocks", id))));
  const foreign = released.some(
    (found) => !found || found.removedAt !== undefined || blockId === null || found.smartBlock?.blockId !== blockId || found.smartBlock.date !== date,
  );
  if (foreign) return yield* refused("release");
  const tasks = yield* reading((ctx) => Promise.all(blocks.map((fill) => ctx.db.get("tasks", fill.taskId))));
  const closed = blocks.find((_, index) => {
    const task = tasks[index];
    return !task || !isLive(task) || task.status.kind !== "open";
  });
  if (closed) return yield* new NotFound({ table: "tasks", id: closed.taskId });
  const freed = new Set<string>(release);
  const existing = (yield* reading((ctx) => linkedBlocks(ctx, window.start - MAX_BLOCK_MS, window.end))).filter((other) => !freed.has(other._id));
  const clash = blocks.some((fill, index) => existing.some((other) => overlaps(fill, other)) || blocks.slice(index + 1).some((other) => overlaps(fill, other)));
  if (clash) return yield* refused("overlap");
});

const writeFill = Effect.fn("smartBlocks.writeFill")(function* (
  block: Pick<SmartBlock, "_id" | "timeZone">,
  date: IsoDate,
  blocks: readonly FillBlockInput[],
  release: readonly Id<"workBlocks">[],
) {
  const at = yield* Clock.currentTimeMillis;
  for (const id of release) yield* recording((record) => record.patch("workBlocks", id, { removedAt: at }));
  const blockIds: Id<"workBlocks">[] = [];
  for (const fill of blocks)
    blockIds.push(
      yield* recording((record) =>
        record.insert("workBlocks", {
          taskId: fill.taskId,
          start: fill.start,
          minutes: fill.minutes,
          timeZone: block.timeZone,
          done: false,
          smartBlock: { blockId: block._id, date },
        }),
      ),
    );
  return blockIds;
});

const vEditFields = {
  title: v.optional(v.string()),
  colour: v.optional(vColour),
  startMinute: v.optional(v.number()),
  endMinute: v.optional(v.number()),
  filter: v.optional(vSmartBlockFilter),
};

type EditFields = { title?: string; colour?: Doc<"smartBlocks">["colour"]; startMinute?: number; endMinute?: number; filter?: SmartBlockFilter };

const parseEdit = (block: SmartBlock, fields: EditFields) =>
  Result.map(
    Result.all([
      fields.title === undefined ? Result.succeed(block.title) : parseName(fields.title),
      parseWindow(fields.startMinute ?? block.startMinute, fields.endMinute ?? block.endMinute),
    ]),
    ([title, window]) => ({
      title,
      colour: fields.colour ?? block.colour,
      ...window,
      filter: fields.filter ? cleanFilter(fields.filter) : block.filter,
    }),
  );

type Edited = ReturnType<typeof parseEdit> extends Result.Result<infer T, unknown> ? T : never;

const relink = Effect.fn("smartBlocks.relink")(function* (from: SmartBlock, date: IsoDate, to: Id<"smartBlocks">) {
  const window = windowOf(from, date);
  const linked = (yield* reading((ctx) => linkedBlocks(ctx, window.start - MAX_BLOCK_MS, window.end + MAX_BLOCK_MS))).filter(
    (fill) => fill.smartBlock?.blockId === from._id && fill.smartBlock.date === date,
  );
  for (const fill of linked) yield* recording((record) => record.patch("workBlocks", fill._id, { smartBlock: { blockId: to, date } }));
});

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, index) => id === b[index]);

const sameFilter = (a: SmartBlockFilter, b: SmartBlockFilter) =>
  sameIds(a.areaIds, b.areaIds) && sameIds(a.projectIds, b.projectIds) && sameIds(a.labelIds, b.labelIds);

const writeOne = Effect.fn("smartBlocks.writeOne")(function* (block: SmartBlock, date: IsoDate, edited: Edited) {
  const { repeat } = block;
  if (!repeat) {
    yield* recording((record) => record.patch("smartBlocks", block._id, edited));
    return block._id;
  }
  const unchanged =
    edited.title === block.title &&
    edited.colour === block.colour &&
    edited.startMinute === block.startMinute &&
    edited.endMinute === block.endMinute &&
    sameFilter(edited.filter, block.filter);
  if (unchanged) return block._id;
  yield* recording((record) => record.patch("smartBlocks", block._id, { repeat: { ...repeat, skipped: [...repeat.skipped, date].toSorted() } }));
  const detachedId = yield* recording((record) =>
    record.insert("smartBlocks", {
      ...edited,
      date,
      until: date,
      timeZone: block.timeZone,
      detachedFrom: { blockId: block._id, date },
    }),
  );
  yield* relink(block, date, detachedId);
  return detachedId;
});

const whenOn = <A, E, R>(run: Effect.Effect<A, E, R>) =>
  reading(smartBlocksOn).pipe(
    Effect.filterOrFail(
      (on) => on,
      () => new FeatureOff({ feature: "smartBlocks" }),
    ),
    Effect.andThen(run),
  );

export const create = changeMutation({
  action: "smartBlock.create",
  args: {
    title: v.string(),
    colour: v.optional(vColour),
    date: v.string(),
    startMinute: v.number(),
    endMinute: v.number(),
    timeZone: v.string(),
    filter: v.optional(vSmartBlockFilter),
    repeat: v.optional(vRepeatInput),
    fill: v.optional(v.array(vFillBlock)),
  },
  handler: (args) =>
    whenOn(
      Effect.gen(function* () {
        const [title, date, window, timeZone] = yield* Effect.fromResult(
          Result.all([parseName(args.title), parseIsoDate(args.date), parseWindow(args.startMinute, args.endMinute), parseZone(args.timeZone)]),
        );
        const series = yield* Effect.fromResult(parseRepeat(date, args.repeat, []));
        const fields = {
          title,
          colour: args.colour ?? DEFAULT_COLOUR,
          date,
          ...window,
          timeZone,
          filter: cleanFilter(args.filter ?? { areaIds: [], projectIds: [], labelIds: [] }),
          until: series.until ?? date,
          ...(series.repeat ? { repeat: series.repeat } : {}),
        };
        if (!occursOnDate(fields, date)) return yield* refused("occurrence");
        const fills = args.fill ?? [];
        yield* checkFill(fields, null, date, fills, []);
        const blockId = yield* recording((record) => record.insert("smartBlocks", fields));
        const blockIds = yield* writeFill({ _id: blockId, timeZone }, date, fills, []);
        return { blockId, blockIds };
      }),
    ),
});

const vScope = v.union(v.literal("one"), v.literal("all"));

const vEdit = v.object({ scope: vScope, ...vEditFields, repeat: v.optional(v.union(vRepeatInput, v.null())) });

type Edit = EditFields & { scope: "one" | "all"; repeat?: RepeatInput | null | undefined };

const planEdit = (block: SmartBlock, { scope, repeat, ...fields }: Edit) =>
  Result.flatMap(parseEdit(block, fields), (edited) =>
    Result.map(
      scope === "one" || repeat === undefined ? Result.succeed<Series>({}) : parseRepeat(block.date as IsoDate, repeat, block.repeat?.skipped ?? []),
      (series) => ({ scope, edited, series, after: scope === "one" ? { ...block, ...edited } : { ...block, ...edited, ...series } }),
    ),
  );

type PlannedEdit = ReturnType<typeof planEdit> extends Result.Result<infer T, unknown> ? T : never;

const writeEdit = Effect.fn("smartBlocks.writeEdit")(function* (block: SmartBlock, date: IsoDate, plan: PlannedEdit) {
  if (plan.scope === "one") return yield* writeOne(block, date, plan.edited);
  yield* recording((record) => record.patch("smartBlocks", block._id, { ...plan.edited, ...plan.series }));
  return block._id;
});

const editTarget = Effect.fn("smartBlocks.editTarget")(function* (
  blockId: Id<"smartBlocks">,
  date: string | undefined,
  repeat: RepeatInput | null | undefined,
  fields: EditFields,
) {
  if (date === undefined) {
    const block = yield* liveBlock(blockId);
    return { block, date: block.date as IsoDate, edit: { scope: "all" as const, repeat, ...fields } };
  }
  const found = yield* occurrenceOf(blockId, date);
  return { ...found, edit: { scope: "one" as const, ...fields } };
});

export const edit = changeMutation({
  action: "smartBlock.edit",
  args: {
    blockId: v.id("smartBlocks"),
    date: v.optional(v.string()),
    ...vEditFields,
    repeat: v.optional(v.union(vRepeatInput, v.null())),
  },
  handler: ({ blockId, date, repeat, ...fields }) =>
    whenOn(
      Effect.gen(function* () {
        const { block, date: day, edit: changes } = yield* editTarget(blockId, date, repeat, fields);
        const plan = yield* Effect.fromResult(planEdit(block, changes));
        return { blockId: yield* writeEdit(block, day, plan) };
      }),
    ),
});

export const skip = changeMutation({
  action: "smartBlock.skip",
  args: { blockId: v.id("smartBlocks"), date: v.string() },
  handler: ({ blockId, date }) =>
    whenOn(
      Effect.gen(function* () {
        const { block, date: day } = yield* occurrenceOf(blockId, date);
        const { repeat } = block;
        const removedAt = yield* Clock.currentTimeMillis;
        yield* recording((record) =>
          repeat
            ? record.patch("smartBlocks", blockId, { repeat: { ...repeat, skipped: [...repeat.skipped, day].toSorted() } })
            : record.patch("smartBlocks", blockId, { removedAt }),
        );
        return { blockId };
      }),
    ),
});

export const remove = changeMutation({
  action: "smartBlock.remove",
  args: { blockId: v.id("smartBlocks") },
  handler: ({ blockId }) =>
    whenOn(
      Effect.gen(function* () {
        yield* liveBlock(blockId);
        const removedAt = yield* Clock.currentTimeMillis;
        yield* recording((record) => record.patch("smartBlocks", blockId, { removedAt }));
        return { blockId };
      }),
    ),
});

export const fill = changeMutation({
  action: "smartBlock.fill",
  args: {
    blockId: v.id("smartBlocks"),
    date: v.string(),
    blocks: v.array(vFillBlock),
    release: v.array(v.id("workBlocks")),
    edit: v.optional(vEdit),
  },
  handler: ({ blockId, date, blocks, release, edit: changes }) =>
    whenOn(
      Effect.gen(function* () {
        const { block, date: day } = yield* occurrenceOf(blockId, date);
        const plan = changes ? yield* Effect.fromResult(planEdit(block, changes)) : null;
        const after = plan?.after ?? block;
        if (!occursOnDate(after, day)) return yield* refused("occurrence");
        yield* checkFill(after, block._id, day, blocks, release);
        const target = plan ? yield* writeEdit(block, day, plan) : block._id;
        const blockIds = yield* writeFill({ _id: target, timeZone: block.timeZone }, day, blocks, release);
        return { blockId: target, blockIds };
      }),
    ),
});
