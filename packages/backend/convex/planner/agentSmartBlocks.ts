import { tool, type ToolDefinition } from "@convex-dev/mcp";
import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { agentMutation, agentQuery, MCP_SCOPES } from "../platform/access";
import { featureReady } from "../platform/features";
import { zonedIso } from "../calendar/model";
import { describeSchedule } from "../../shared/recurrence";
import { FOREVER, fillSmartBlock, occursOnDate, type FillCandidate } from "../../shared/smartBlocks";
import { agentDate, agentId, agentTimeZone } from "./agentReads";
import { vReceipt, write, writer } from "./agentWrites";
import { labelNamed } from "./labels";
import * as smartBlocks from "./smartBlocks";
import { loadSnapshot, occurrencesIn, windowOf } from "./smartBlocks";
import { vCalendarSchedule, vColour } from "./tables";

const MINUTE_MS = 60_000;
const MAX_LIST_DAYS = 14;

const requireOn = async (ctx: QueryCtx) => {
  if (!(await featureReady(ctx, "smartBlocks"))) throw new ConvexError("Smart Blocks is switched off in Settings. Ask Avi to switch it on.");
};

const clockMinute = (input: string) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(input.trim());
  const minute = match ? Number(match[1]) * 60 + Number(match[2]) : Number.NaN;
  if (!match || Number(match[2]) > 59 || minute > 24 * 60) throw new ConvexError(`"${input}" is not a time. Use HH:mm, such as 16:00.`);
  return minute;
};

const labelIdsFor = async (ctx: QueryCtx, names: readonly string[]) => {
  const found = await Promise.all(names.map((name) => labelNamed(ctx, name)));
  const missing = names.filter((_, index) => !found[index]);
  if (missing.length > 0) throw new ConvexError(`No Label is named ${missing.map((name) => `"${name}"`).join(", ")}. list_areas shows the Labels.`);
  return found.flatMap((label) => (label ? [label._id] : []));
};

const vFilterOut = v.object({ areaIds: v.array(v.string()), projectIds: v.array(v.string()), labelIds: v.array(v.string()) });

const vOccurrence = v.object({
  blockId: v.string(),
  date: v.string(),
  title: v.string(),
  start: v.string(),
  end: v.string(),
  repeats: v.optional(v.string()),
  filter: vFilterOut,
  filledWorkBlocks: v.number(),
});

export const listSmartBlocks = agentQuery({
  args: { date: v.optional(v.string()), days: v.optional(v.number()), timeZone: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireOn(ctx);
    const timeZone = await agentTimeZone(ctx, args.timeZone);
    const from = agentDate(args.date, timeZone);
    const days = Math.min(Math.max(Math.trunc(args.days ?? 1), 1), MAX_LIST_DAYS);
    const found = await occurrencesIn(ctx, from, days);
    const fills = await Promise.all(
      found.map(async ({ block, date, window }) =>
        (
          await ctx.db
            .query("workBlocks")
            .withIndex("by_removed_start", (q) => q.eq("removedAt", undefined).gte("start", window.start).lt("start", window.end))
            .take(100)
        ).filter((fill) => fill.smartBlock?.blockId === block._id && fill.smartBlock.date === date).length,
      ),
    );
    return {
      smartBlocks: found.map(({ block, date, window }, index) => ({
        blockId: block._id as string,
        date,
        title: block.title,
        start: zonedIso(window.start, timeZone),
        end: zonedIso(window.end, timeZone),
        ...(block.repeat ? { repeats: describeSchedule(block.repeat.schedule, block.until === FOREVER ? { kind: "never" } : { kind: "on", date: block.until }) } : {}),
        filter: block.filter,
        filledWorkBlocks: fills[index] ?? 0,
      })),
    };
  },
});

const sized = (candidate: FillCandidate) =>
  candidate.source === "estimate" ? "Estimate" : candidate.source === "guess" ? "Smart Estimate (a guess)" : "default 30 minutes";

const vEdits = { exclude: v.optional(v.array(v.string())), prefer: v.optional(v.array(v.string())) };

const vPlanned = v.object({ taskId: v.string(), title: v.string(), start: v.string(), end: v.string(), minutes: v.number(), sizedBy: v.string(), reason: v.string() });

const vFillPlan = v.object({
  blockId: v.string(),
  date: v.string(),
  window: v.object({ start: v.string(), end: v.string() }),
  add: v.array(vPlanned),
  keep: v.array(v.object({ workBlockId: v.string(), taskId: v.string(), start: v.string() })),
  release: v.array(v.object({ workBlockId: v.string(), taskId: v.string() })),
  skipped: v.array(v.object({ taskId: v.string(), title: v.string(), minutes: v.number(), why: v.string() })),
  freeMinutes: v.number(),
  filledMinutes: v.number(),
});

const planFill = async (ctx: QueryCtx, args: { blockId: string; date?: string | undefined; exclude?: string[] | undefined; prefer?: string[] | undefined; timeZone?: string | undefined }) => {
  await requireOn(ctx);
  const blockId = agentId(ctx, "smartBlocks", args.blockId, "Smart Block");
  const block = await ctx.db.get("smartBlocks", blockId);
  if (!block || block.removedAt !== undefined) throw new ConvexError(`No Smart Block has the id "${args.blockId}". Find Smart Block ids with list_smart_blocks.`);
  const timeZone = await agentTimeZone(ctx, args.timeZone ?? block.timeZone);
  const date = agentDate(args.date, timeZone);
  if (!occursOnDate(block, date)) throw new ConvexError(`"${block.title}" does not happen on ${date}. list_smart_blocks shows its dates.`);
  const window = windowOf(block, date);
  const snapshot = await loadSnapshot(ctx, date, block.timeZone);
  const result = fillSmartBlock({
    snapshot,
    blockId,
    window: { start: window.start / MINUTE_MS, end: window.end / MINUTE_MS },
    filter: block.filter,
    now: Math.floor(Date.now() / MINUTE_MS),
    edits: { exclude: args.exclude ?? [], prefer: args.prefer ?? [] },
  });
  const at = (minute: number) => zonedIso(minute * MINUTE_MS, timeZone);
  return {
    plan: {
      blockId: blockId as string,
      date,
      window: { start: zonedIso(window.start, timeZone), end: zonedIso(window.end, timeZone) },
      add: result.picks.map((pick) => ({
        taskId: pick.task._id,
        title: pick.task.title,
        start: at(pick.start),
        end: at(pick.start + pick.minutes),
        minutes: pick.minutes,
        sizedBy: sized(pick),
        reason: pick.reason,
      })),
      keep: result.kept.map((kept) => ({ workBlockId: kept.blockId, taskId: kept.taskId, start: at(kept.start) })),
      release: result.released.map((released) => ({ workBlockId: released.blockId, taskId: released.taskId })),
      skipped: result.skipped.map((skip) => ({
        taskId: skip.task._id,
        title: skip.task.title,
        minutes: skip.minutes,
        why: skip.why === "too_long" ? "Too long for this block" : "No room left",
      })),
      freeMinutes: result.freeMinutes,
      filledMinutes: result.filledMinutes,
    },
    result,
    blockId,
    date,
  };
};

export const previewFill = agentQuery({
  args: { blockId: v.string(), date: v.optional(v.string()), ...vEdits, timeZone: v.optional(v.string()) },
  handler: async (ctx, args) => (await planFill(ctx, args)).plan,
});

export const acceptFill = agentMutation({
  args: { blockId: v.string(), date: v.optional(v.string()), ...vEdits, timeZone: v.optional(v.string()) },
  handler: async (ctx, args, run) => {
    const { plan, result, blockId, date } = await planFill(ctx, args);
    if (result.picks.length === 0 && result.released.length === 0) throw new ConvexError("Nothing new fits in that Smart Block, so nothing changed.");
    const change = await writer(ctx, run);
    await change.change(smartBlocks.fill, {
      blockId,
      date,
      blocks: result.picks.map((pick) => ({ taskId: pick.task._id as Id<"tasks">, start: pick.start * MINUTE_MS, minutes: pick.minutes })),
      release: result.released.map((released) => released.blockId as Id<"workBlocks">),
    });
    return { ...change.receipt(), plan };
  },
});

export const createSmartBlock = agentMutation({
  args: {
    title: v.string(),
    date: v.optional(v.string()),
    start: v.string(),
    end: v.string(),
    repeat: v.optional(v.object({ schedule: vCalendarSchedule, until: v.optional(v.string()) })),
    areaIds: v.optional(v.array(v.string())),
    projectIds: v.optional(v.array(v.string())),
    labels: v.optional(v.array(v.string())),
    colour: v.optional(vColour),
    timeZone: v.optional(v.string()),
  },
  handler: async (ctx, args, run) => {
    await requireOn(ctx);
    const timeZone = await agentTimeZone(ctx, args.timeZone);
    const date = agentDate(args.date, timeZone);
    const filter = {
      areaIds: (args.areaIds ?? []).map((id) => agentId(ctx, "areas", id, "Area")),
      projectIds: (args.projectIds ?? []).map((id) => agentId(ctx, "projects", id, "Project")),
      labelIds: await labelIdsFor(ctx, args.labels ?? []),
    };
    const change = await writer(ctx, run);
    const { blockId } = await change.change(smartBlocks.create, {
      title: args.title,
      date,
      startMinute: clockMinute(args.start),
      endMinute: clockMinute(args.end),
      timeZone,
      filter,
      ...(args.colour ? { colour: args.colour } : {}),
      ...(args.repeat ? { repeat: args.repeat } : {}),
    });
    return { ...change.receipt(), blockId: blockId as string, date };
  },
});

const vEditArgs = {
  blockId: v.string(),
  date: v.optional(v.string()),
  ...vEdits,
  timeZone: v.optional(v.string()),
};

export const smartBlockTools: Record<string, ToolDefinition> = {
  list_smart_blocks: tool({
    title: "List Smart Blocks",
    description:
      "List the Smart Blocks (reserved windows such as Focus 16:00-18:00 that LifeOS fills with Tasks) on a date (default today) and the `days` after it (default 1, max 14). Each shows its window, how it repeats, which Area, Project and Label ids it takes (empty means every Task), and how many Work Blocks fill it.",
    args: { date: v.optional(v.string()), days: v.optional(v.number()), timeZone: v.optional(v.string()) },
    returns: v.object({ smartBlocks: v.array(vOccurrence) }),
    annotations: { readOnlyHint: true },
    scope: MCP_SCOPES.read,
    handler: (ctx, args, caller) => ctx.runQuery(internal.planner.agentSmartBlocks.listSmartBlocks, { ...args, caller }),
  }),
  preview_smart_block_fill: tool({
    title: "Preview Smart Block Fill",
    description:
      "Show which Tasks LifeOS would put in one Smart Block occurrence, without changing anything. It ranks eligible Tasks by Deadline, Area priority, the Day Plan and age, sizes each by its Estimate (else Smart Estimate, else 30 minutes) and packs them inside the window around busy time, five minutes apart. Work Blocks already accepted stay put (`keep`); those of done or no longer eligible Tasks are freed (`release`). `exclude` leaves Tasks out; `prefer` puts Tasks first. Show Avi the plan before accept_smart_block_fill.",
    args: vEditArgs,
    returns: vFillPlan,
    annotations: { readOnlyHint: true },
    scope: MCP_SCOPES.read,
    handler: (ctx, args, caller) => ctx.runQuery(internal.planner.agentSmartBlocks.previewFill, { ...args, caller }),
  }),
  accept_smart_block_fill: tool({
    title: "Accept Smart Block Fill",
    description:
      "Work out the same fill as preview_smart_block_fill (same arguments) and create its Work Blocks inside the Smart Block in one undoable change. Accepted Work Blocks stay put on later fills.",
    args: vEditArgs,
    returns: v.object({ ...vReceipt, plan: vFillPlan }),
    ...write(false),
    handler: (ctx, args, caller) => ctx.runMutation(internal.planner.agentSmartBlocks.acceptFill, { ...args, caller }),
  }),
  create_smart_block: tool({
    title: "Create Smart Block",
    description:
      "Reserve a window on a date (default today) for a kind of work, such as Focus from 16:00 to 18:00 (`start` and `end` are HH:mm in Avi's time zone). `areaIds`, `projectIds` (from list_areas) and `labels` (names) limit which Tasks fill it; leave them out for every Task. `repeat.schedule` is {kind:'days',every}, {kind:'weekdays'}, {kind:'weeks',every,days:[1-7, Monday is 1]} (every 2 for fortnightly), {kind:'months',every,on:{kind:'day',day}|{kind:'weekday',nth,weekday}} or {kind:'years',every,month,day}, with an optional `until` date. It starts empty: fill it with preview_smart_block_fill and accept_smart_block_fill. It is not written to any calendar.",
    args: {
      title: v.string(),
      date: v.optional(v.string()),
      start: v.string(),
      end: v.string(),
      repeat: v.optional(v.object({ schedule: vCalendarSchedule, until: v.optional(v.string()) })),
      areaIds: v.optional(v.array(v.string())),
      projectIds: v.optional(v.array(v.string())),
      labels: v.optional(v.array(v.string())),
      colour: v.optional(vColour),
      timeZone: v.optional(v.string()),
    },
    returns: v.object({ ...vReceipt, blockId: v.string(), date: v.string() }),
    ...write(false),
    handler: (ctx, args, caller) => ctx.runMutation(internal.planner.agentSmartBlocks.createSmartBlock, { ...args, caller }),
  }),
};
