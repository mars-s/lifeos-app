import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import type { ModelId } from "../../shared/ai";
import { attemptsFor, capabilityChain } from "./capabilities";
import { embedTexts } from "./embeddings";
import { describe, indexChanged } from "./indexRows";
import type { IndexedRef } from "./tables";

const EMBED_BATCH = 64;
const BACKFILL_PAGE = 100;

export const pending = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("aiIndex")
      .withIndex("by_embedded", (q) => q.eq("embedded", false))
      .take(EMBED_BATCH);
    const described = await Promise.all(rows.map(async (row) => ({ row, described: await describe(ctx, row.entity) })));
    return {
      chain: await capabilityChain(ctx, "searchIndex"),
      rows: described.flatMap(({ row, described: found }) => (found ? [{ rowId: row._id, hash: row.hash, text: found.text }] : [])),
    };
  },
});

export const storeEmbeddings = internalMutation({
  args: { vectors: v.array(v.object({ rowId: v.id("aiIndex"), hash: v.string(), embedding: v.array(v.float64()) })) },
  returns: v.null(),
  handler: async (ctx, { vectors }) => {
    for (const { rowId, hash, embedding } of vectors) {
      const row = await ctx.db.get("aiIndex", rowId);
      if (row?.hash === hash) await ctx.db.patch("aiIndex", rowId, { embedding, embedded: true });
    }
    return null;
  },
});

export const embedPending = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const { chain, rows }: { chain: ModelId[]; rows: { rowId: Id<"aiIndex">; hash: string; text: string }[] } = await ctx.runQuery(internal.ai.aiIndex.pending, {});
    const [attempt] = await attemptsFor(ctx, chain);
    if (!attempt || rows.length === 0) return null;
    const vectors = await embedTexts(attempt, rows.map((row) => row.text));
    if (vectors.isErr()) return null;
    await ctx.runMutation(internal.ai.aiIndex.storeEmbeddings, {
      vectors: rows.map((row, index) => ({ rowId: row.rowId, hash: row.hash, embedding: vectors.value[index] ?? [] })),
    });
    if (rows.length === EMBED_BATCH) await ctx.scheduler.runAfter(0, internal.ai.aiIndex.embedPending, {});
    return null;
  },
});

const vBackfillTable = v.union(v.literal("tasks"), v.literal("projects"), v.literal("areas"));

export const backfillPage = internalMutation({
  args: { table: vBackfillTable, cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { table, cursor }) => {
    const page = await ctx.db.query(table).paginate({ numItems: BACKFILL_PAGE, cursor });
    await indexChanged(
      ctx,
      page.page.map((doc) => ({ table, id: doc._id }) as IndexedRef),
    );
    return { cursor: page.isDone ? null : page.continueCursor };
  },
});

export const backfill = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    for (const table of ["areas", "projects", "tasks"] as const) {
      let cursor: string | null = null;
      do {
        const page: { cursor: string | null } = await ctx.runMutation(internal.ai.aiIndex.backfillPage, { table, cursor });
        cursor = page.cursor;
      }
      while (cursor !== null);
    }
    await ctx.runAction(internal.ai.aiIndex.embedPending, {});
    return null;
  },
});

