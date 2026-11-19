import { v } from "convex/values";
import { Result, err, ok } from "neverthrow";
import type { WithoutSystemFields } from "convex/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { Recorder } from "../platform/activity";
import { ownerQuery } from "../platform/access";
import { changeMutation } from "../platform/change";
import { featureReady, featureState } from "../platform/features";
import { capacityDays } from "../calendar/capacity";
import { commitmentsBetween } from "../calendar/commitments";
import { blocksTime, MINUTE_MS, parseTimeZone, zonedMoment } from "../calendar/model";
import { addDays, parseIsoDate, type IsoDate } from "../../shared/date";
import { parseSchedule } from "../../shared/recurrence";
import { serialise } from "../../shared/result";
import { FOREVER, isWindow, occursOnDate, type FillSnapshot, type FillTask } from "../../shared/smartBlocks";
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

const refused = (reason: Extract<PlannerError, { kind: "invalid_smart_block" }>["reason"]) =>
  ({ kind: "invalid_smart_block", reason }) satisfies PlannerError;

const featureOff = { kind: "feature_off", feature: "smartBlocks" } satisfies PlannerError;

const smartBlocksOn = (ctx: QueryCtx) => featureReady(ctx, "smartBlocks");

const parseDay = (date: string) => parseIsoDate(date).mapErr<PlannerError>((error) => error);

const parseZone = (timeZone: string) => parseTimeZone(timeZone).mapErr<PlannerError>(() => refused("time_zone"));

const parseWindow = (startMinute: number, endMinute: number) =>
  isWindow(startMinute, endMinute)
    ? ok<{ startMinute: number; endMinute: number }, PlannerError>({ startMinute, endMinute })
    : err<{ startMinute: number; endMinute: number }, PlannerError>(refused("window"));

const unique = <T>(values: readonly T[]) => [...new Set(values)];

const cleanFilter = (filter: SmartBlockFilter) => ({
  areaIds: unique(filter.areaIds),
  projectIds: unique(filter.projectIds),
  labelIds: unique(filter.labelIds),
});

const vRepeatInput = v.object({ schedule: vCalendarSchedule, until: v.optional(v.string()) });

type RepeatInput = { schedule: CalendarSchedule; until?: string | undefined };

const parseRepeat = (date: IsoDate, repeat: RepeatInput | null | undefined, skipped: readonly string[]) => {
  if (!repeat) return ok<Pick<SmartBlockFields, "repeat" | "until">, PlannerError>({ repeat: undefined, until: date });
  const until = repeat.until === undefined ? ok<string, PlannerError>(FOREVER) : parseDay(repeat.until).map(String);
  return Result.combine([parseSchedule(repeat.schedule).mapErr<PlannerError>((error) => error), until]).andThen(([schedule, end]) =>
    end < date
      ? err<Pick<SmartBlockFields, "repeat" | "until">, PlannerError>({ kind: "invalid_schedule", reason: "end" })
      : ok<Pick<SmartBlockFields, "repeat" | "until">, PlannerError>({
          repeat: { schedule: schedule as CalendarSchedule, skipped: [...skipped] },
          until: end,
        }),
  );
};

export const windowOf = (block: Pick<SmartBlock, "startMinute" | "endMinute" | "timeZone">, date: IsoDate) => ({
  start: zonedMoment(date, block.startMinute, block.timeZone),
  end: zonedMoment(date, block.endMinute, block.timeZone),
});

const liveBlock = async (ctx: QueryCtx, blockId: Id<"smartBlocks">) =>
  (await load(ctx, "smartBlocks", blockId)).andThen((block) =>
    block.removedAt === undefined
      ? ok<SmartBlock, PlannerError>(block)
      : err<SmartBlock, PlannerError>({ kind: "not_found", table: "smartBlocks", id: blockId }),
  );

const occurrenceOf = async (ctx: QueryCtx, blockId: Id<"smartBlocks">, date: string) =>
  Result.combine([await liveBlock(ctx, blockId), parseDay(date)]).andThen(([block, day]) =>
    occursOnDate(block, day) ? ok<{ block: SmartBlock; date: IsoDate }, PlannerError>({ block, date: day }) : err(refused("occurrence")),
  );

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

export const range = ownerQuery({
  args: { from: v.string(), days: v.number(), timeZone: v.string() },
  handler: async (ctx, args) => {
    const parsed = Result.combine([
      parseDay(args.from),
      Number.isInteger(args.days) && args.days >= 1 && args.days <= MAX_RANGE_DAYS ? ok<number, PlannerError>(args.days) : err<number, PlannerError>(refused("window")),
      parseZone(args.timeZone),
    ]);
    return serialise(
      await parsed.asyncMap(async ([from, days, timeZone]) => {
        if (!(await smartBlocksOn(ctx))) return { on: false, occurrences: [] };
        const occurrences = await occurrencesIn(ctx, from, days);
        const first = zonedMoment(from, 0, timeZone) - MAX_BLOCK_MS;
        const last = zonedMoment(addDays(from, days), 0, timeZone) + MAX_BLOCK_MS;
        const fills = occurrences.length === 0 ? [] : (await linkedBlocks(ctx, first, last)).filter((block) => block.smartBlock);
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
            filled: fills.filter((fill) => fill.smartBlock?.blockId === block._id && fill.smartBlock.date === date).length,
          })),
        };
      }),
    );
  },
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
  const [pool, blocks, commitments, areas, capacity] = await Promise.all([
    poolOf(ctx, date),
    linkedBlocks(ctx, dayStart, dayEnd),
    commitmentsBetween(ctx, dayStart, dayEnd),
    areaPriority(ctx),
    capacityDays(ctx, date, FREE_DAYS, timeZone),
  ]);
  const projectIds = unique(pool.flatMap((task) => (task.parent.kind === "project" ? [task.parent.projectId] : [])));
  const [projects, guesses] = await Promise.all([Promise.all(projectIds.map((id) => ctx.db.get("projects", id))), guessesFor(ctx, pool)]);
  const projectArea = new Map(projects.flatMap((project) => (project ? [[project._id as string, project.areaId]] : [])));
  const guessed = new Map<string, number>(guesses.map((guess) => [guess.taskId, guess.minutes]));
  const colours = new Map(areas.map((area) => [area._id as string, area.colour]));
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
  handler: async (ctx, args) =>
    serialise(
      await Result.combine([parseDay(args.date), parseZone(args.timeZone)]).asyncMap(async ([date, timeZone]) =>
        (await smartBlocksOn(ctx)) ? loadSnapshot(ctx, date, timeZone) : null,
      ),
    ),
});

export const priority = ownerQuery({ args: {}, handler: (ctx) => areaPriority(ctx) });

const vFillBlock = v.object({ taskId: v.id("tasks"), start: v.number(), minutes: v.number() });

type FillBlockInput = { taskId: Id<"tasks">; start: number; minutes: number };

const overlaps = (a: { start: number; minutes: number }, b: { start: number; minutes: number }) =>
  a.start < b.start + b.minutes * MINUTE_MS && b.start < a.start + a.minutes * MINUTE_MS;

const applyFill = async (
  ctx: MutationCtx,
  record: Recorder,
  block: SmartBlock,
  date: IsoDate,
  blocks: readonly FillBlockInput[],
  release: readonly Id<"workBlocks">[],
) => {
  if (blocks.length > MAX_FILL_BLOCKS || release.length > MAX_FILL_BLOCKS) return err<{ blockIds: Id<"workBlocks">[] }, PlannerError>(refused("too_many"));
  const window = windowOf(block, date);
  const outside = blocks.some(
    (fill) => !Number.isSafeInteger(fill.start) || !Number.isInteger(fill.minutes) || fill.minutes <= 0 || fill.start < window.start || fill.start + fill.minutes * MINUTE_MS > window.end,
  );
  if (outside) return err<{ blockIds: Id<"workBlocks">[] }, PlannerError>(refused("outside"));
  const released = await Promise.all(release.map((id) => ctx.db.get("workBlocks", id)));
  const foreign = released.some(
    (found) => !found || found.removedAt !== undefined || found.smartBlock?.blockId !== block._id || found.smartBlock.date !== date,
  );
  if (foreign) return err<{ blockIds: Id<"workBlocks">[] }, PlannerError>(refused("release"));
  const tasks = await Promise.all(blocks.map((fill) => ctx.db.get("tasks", fill.taskId)));
  const closed = blocks.find((_, index) => {
    const task = tasks[index];
    return !task || !isLive(task) || task.status.kind !== "open";
  });
  if (closed) return err<{ blockIds: Id<"workBlocks">[] }, PlannerError>({ kind: "not_found", table: "tasks", id: closed.taskId });
  const freed = new Set<string>(release);
  const existing = (await linkedBlocks(ctx, window.start - MAX_BLOCK_MS, window.end)).filter((other) => !freed.has(other._id));
  const clash = blocks.some((fill, index) => existing.some((other) => overlaps(fill, other)) || blocks.slice(index + 1).some((other) => overlaps(fill, other)));
  if (clash) return err<{ blockIds: Id<"workBlocks">[] }, PlannerError>(refused("overlap"));
  const at = Date.now();
  for (const id of release) await record.patch("workBlocks", id, { removedAt: at });
  const blockIds: Id<"workBlocks">[] = [];
  for (const fill of blocks)
    blockIds.push(
      await record.insert("workBlocks", {
        taskId: fill.taskId,
        start: fill.start,
        minutes: fill.minutes,
        timeZone: block.timeZone,
        done: false,
        smartBlock: { blockId: block._id, date },
      }),
    );
  return ok<{ blockIds: Id<"workBlocks">[] }, PlannerError>({ blockIds });
};

const vEditFields = {
  title: v.optional(v.string()),
  colour: v.optional(vColour),
  startMinute: v.optional(v.number()),
  endMinute: v.optional(v.number()),
  filter: v.optional(vSmartBlockFilter),
};

type EditFields = { title?: string; colour?: Doc<"smartBlocks">["colour"]; startMinute?: number; endMinute?: number; filter?: SmartBlockFilter };

const parseEdit = (block: SmartBlock, fields: EditFields) =>
  Result.combine([
    fields.title === undefined ? ok<string, PlannerError>(block.title) : parseTitle(fields.title),
    parseWindow(fields.startMinute ?? block.startMinute, fields.endMinute ?? block.endMinute),
  ]).map(([title, window]) => ({
    title,
    colour: fields.colour ?? block.colour,
    ...window,
    filter: fields.filter ? cleanFilter(fields.filter) : block.filter,
  }));

const relink = async (ctx: MutationCtx, record: Recorder, from: SmartBlock, date: IsoDate, to: Id<"smartBlocks">) => {
  const window = windowOf(from, date);
  const linked = (await linkedBlocks(ctx, window.start - MAX_BLOCK_MS, window.end + MAX_BLOCK_MS)).filter(
    (fill) => fill.smartBlock?.blockId === from._id && fill.smartBlock.date === date,
  );
  for (const fill of linked) await record.patch("workBlocks", fill._id, { smartBlock: { blockId: to, date } });
};

const editOne = async (ctx: MutationCtx, record: Recorder, block: SmartBlock, date: IsoDate, fields: EditFields) => {
  const parsed = parseEdit(block, fields);
  if (parsed.isErr()) return err<Id<"smartBlocks">, PlannerError>(parsed.error);
  if (!block.repeat) {
    await record.patch("smartBlocks", block._id, parsed.value);
    return ok<Id<"smartBlocks">, PlannerError>(block._id);
  }
  const unchanged =
    parsed.value.title === block.title &&
    parsed.value.colour === block.colour &&
    parsed.value.startMinute === block.startMinute &&
    parsed.value.endMinute === block.endMinute &&
    JSON.stringify(parsed.value.filter) === JSON.stringify(block.filter);
  if (unchanged) return ok<Id<"smartBlocks">, PlannerError>(block._id);
  await record.patch("smartBlocks", block._id, { repeat: { ...block.repeat, skipped: [...block.repeat.skipped, date].toSorted() } });
  const detachedId = await record.insert("smartBlocks", {
    ...parsed.value,
    date,
    until: date,
    timeZone: block.timeZone,
    detachedFrom: { blockId: block._id, date },
  });
  await relink(ctx, record, block, date, detachedId);
  return ok<Id<"smartBlocks">, PlannerError>(detachedId);
};

const whenOn = async <T>(ctx: QueryCtx, run: () => Promise<Result<T, PlannerError>>) =>
  (await smartBlocksOn(ctx)) ? run() : err<T, PlannerError>(featureOff);

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
  handler: (ctx, args, record) =>
    whenOn(ctx, async () => {
      const parsed = Result.combine([parseTitle(args.title), parseDay(args.date), parseWindow(args.startMinute, args.endMinute), parseZone(args.timeZone)]);
      if (parsed.isErr()) return err(parsed.error);
      const [title, date, window, timeZone] = parsed.value;
      const repeat = parseRepeat(date, args.repeat, []);
      if (repeat.isErr()) return err(repeat.error);
      const blockId = await record.insert("smartBlocks", {
        title,
        colour: args.colour ?? DEFAULT_COLOUR,
        date,
        ...window,
        timeZone,
        filter: cleanFilter(args.filter ?? { areaIds: [], projectIds: [], labelIds: [] }),
        until: repeat.value.until ?? date,
        ...(repeat.value.repeat ? { repeat: repeat.value.repeat } : {}),
      });
      const block = await ctx.db.get("smartBlocks", blockId);
      if (!block) return err<{ blockId: Id<"smartBlocks">; blockIds: Id<"workBlocks">[] }, PlannerError>({ kind: "not_found", table: "smartBlocks", id: blockId });
      if (!occursOnDate(block, date)) return err<{ blockId: Id<"smartBlocks">; blockIds: Id<"workBlocks">[] }, PlannerError>(refused("occurrence"));
      const filled = await applyFill(ctx, record, block, date, args.fill ?? [], []);
      return filled.map(({ blockIds }) => ({ blockId, blockIds }));
    }),
});

export const edit = changeMutation({
  action: "smartBlock.edit",
  args: {
    blockId: v.id("smartBlocks"),
    date: v.optional(v.string()),
    ...vEditFields,
    repeat: v.optional(v.union(vRepeatInput, v.null())),
  },
  handler: (ctx, { blockId, date, repeat, ...fields }, record) =>
    whenOn(ctx, async () => {
      if (date !== undefined) {
        const occurrence = await occurrenceOf(ctx, blockId, date);
        if (occurrence.isErr()) return err(occurrence.error);
        return (await editOne(ctx, record, occurrence.value.block, occurrence.value.date, fields)).map((id) => ({ blockId: id }));
      }
      const block = await liveBlock(ctx, blockId);
      if (block.isErr()) return err(block.error);
      const parsed = parseEdit(block.value, fields);
      if (parsed.isErr()) return err(parsed.error);
      const anchor = block.value.date as IsoDate;
      const series =
        repeat === undefined
          ? ok<Pick<SmartBlockFields, "repeat" | "until">, PlannerError>({})
          : parseRepeat(anchor, repeat, block.value.repeat?.skipped ?? []);
      if (series.isErr()) return err(series.error);
      await record.patch("smartBlocks", blockId, { ...parsed.value, ...series.value });
      return ok<{ blockId: Id<"smartBlocks"> }, PlannerError>({ blockId });
    }),
});

export const skip = changeMutation({
  action: "smartBlock.skip",
  args: { blockId: v.id("smartBlocks"), date: v.string() },
  handler: (ctx, { blockId, date }, record) =>
    whenOn(ctx, async () =>
      (await occurrenceOf(ctx, blockId, date)).asyncMap(async ({ block, date: day }) => {
        if (block.repeat) await record.patch("smartBlocks", blockId, { repeat: { ...block.repeat, skipped: [...block.repeat.skipped, day].toSorted() } });
        else await record.patch("smartBlocks", blockId, { removedAt: Date.now() });
        return { blockId };
      }),
    ),
});

export const remove = changeMutation({
  action: "smartBlock.remove",
  args: { blockId: v.id("smartBlocks") },
  handler: (ctx, { blockId }, record) =>
    whenOn(ctx, async () =>
      (await liveBlock(ctx, blockId)).asyncMap(async () => {
        await record.patch("smartBlocks", blockId, { removedAt: Date.now() });
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
    window: v.optional(v.object({ startMinute: v.number(), endMinute: v.number() })),
  },
  handler: (ctx, { blockId, date, blocks, release, window }, record) =>
    whenOn(ctx, async () => {
      const occurrence = await occurrenceOf(ctx, blockId, date);
      if (occurrence.isErr()) return err(occurrence.error);
      let block = occurrence.value.block;
      if (window && (window.startMinute !== block.startMinute || window.endMinute !== block.endMinute)) {
        const edited = await editOne(ctx, record, block, occurrence.value.date, window);
        if (edited.isErr()) return err(edited.error);
        const fresh = await ctx.db.get("smartBlocks", edited.value);
        if (!fresh) return err<{ blockId: Id<"smartBlocks">; blockIds: Id<"workBlocks">[] }, PlannerError>({ kind: "not_found", table: "smartBlocks", id: edited.value });
        block = fresh;
      }
      const filled = await applyFill(ctx, record, block, occurrence.value.date, blocks, release);
      return filled.map(({ blockIds }) => ({ blockId: block._id, blockIds }));
    }),
});
