import { v } from "convex/values";
import { Effect, Layer, Result } from "effect";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ModelId } from "../../shared/ai";
import { acting, internalAction, internalMutation, internalQuery, reading, writing } from "../platform/effect";
import { capabilityChain } from "./capabilities";
import { embedTexts } from "./embeddings";
import { describe, indexChanged } from "./indexRows";
import { AiRouter } from "./routing";
import type { IndexedRef } from "./tables";
import { AiProvider } from "./transport";

const EMBED_BATCH = 64;
const BACKFILL_PAGE = 100;

type Pending = { chain: ModelId[]; rows: { rowId: Id<"aiIndex">; hash: string; text: string }[] };

export const pending = internalQuery({
  args: {},
  handler: () =>
    reading(async (ctx) => {
      const rows = await ctx.db
        .query("aiIndex")
        .withIndex("by_embedded", (q) => q.eq("embedded", false))
        .take(EMBED_BATCH);
      const described = await Promise.all(rows.map(async (row) => ({ row, described: await describe(ctx, row.entity) })));
      return {
        chain: await capabilityChain(ctx, "searchIndex"),
        rows: described.flatMap(({ row, described: found }) => (found?.text.trim() ? [{ rowId: row._id, hash: row.hash, text: found.text }] : [])),
      } satisfies Pending;
    }),
});

export const storeEmbeddings = internalMutation({
  args: { vectors: v.array(v.object({ rowId: v.id("aiIndex"), hash: v.string(), embedding: v.array(v.float64()) })) },
  returns: v.null(),
  handler: ({ vectors }) =>
    writing(async (ctx) => {
      for (const { rowId, hash, embedding } of vectors) {
        const row = await ctx.db.get("aiIndex", rowId);
        if (row?.hash === hash) await ctx.db.patch("aiIndex", rowId, { embedding, embedded: true });
      }
      return null;
    }),
});

export const embedPending = internalAction({
  args: {},
  returns: v.null(),
  handler: Effect.fn("aiIndex.embedPending")(
    function* () {
      const { chain, rows } = yield* acting((ctx) => {
        const found: Promise<Pending> = ctx.runQuery(internal.ai.aiIndex.pending, {});
        return found;
      });
      const [attempt] = yield* (yield* AiRouter).attemptsFor(chain);
      if (!attempt || rows.length === 0) return null;
      const vectors = yield* Effect.result(embedTexts(attempt, rows.map((row) => row.text)));
      if (Result.isFailure(vectors)) {
        yield* Effect.logWarning("Embeddings failed", JSON.stringify(vectors.failure));
        return null;
      }
      yield* acting(async (ctx) => {
        await ctx.runMutation(internal.ai.aiIndex.storeEmbeddings, {
          vectors: rows.map((row, index) => ({ rowId: row.rowId, hash: row.hash, embedding: vectors.success[index] ?? [] })),
        });
        if (rows.length === EMBED_BATCH) await ctx.scheduler.runAfter(0, internal.ai.aiIndex.embedPending, {});
      });
      return null;
    },
    Effect.provide(Layer.mergeAll(AiRouter.layer, AiProvider.layer)),
  ),
});

const vBackfillTable = v.union(v.literal("tasks"), v.literal("projects"), v.literal("areas"));

export const backfillPage = internalMutation({
  args: { table: vBackfillTable, cursor: v.union(v.string(), v.null()) },
  handler: ({ table, cursor }) =>
    writing(async (ctx) => {
      const page = await ctx.db.query(table).paginate({ numItems: BACKFILL_PAGE, cursor });
      await indexChanged(
        ctx,
        page.page.map((doc) => ({ table, id: doc._id }) as IndexedRef),
      );
      return { cursor: page.isDone ? null : page.continueCursor };
    }),
});

export const backfill = internalAction({
  args: {},
  returns: v.null(),
  handler: () =>
    acting(async (ctx) => {
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
    }),
});
