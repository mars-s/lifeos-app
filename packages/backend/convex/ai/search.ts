import { tool, type ToolDefinition } from "@convex-dev/mcp";
import { v, type Infer } from "convex/values";
import { Effect, Layer, Option } from "effect";
import type { ModelId } from "../../shared/ai";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { MCP_SCOPES, requireOwnerConnection } from "../platform/access";
import { Acts, acting, internalAction, internalQuery, reading } from "../platform/effect";
import { capabilityChain } from "./capabilities";
import { embedTexts } from "./embeddings";
import { describe } from "./indexRows";
import { AiRouter } from "./routing";
import { vIndexKind } from "./tables";
import { AiProvider } from "./transport";

const RRF_K = 60;
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 25;

const vHit = v.object({ kind: vIndexKind, id: v.string(), title: v.string(), snippet: v.string() });

export type Hit = Infer<typeof vHit>;

type Words = { ids: Id<"aiIndex">[]; chain: ModelId[] };

export const byWords = internalQuery({
  args: { query: v.string(), limit: v.number() },
  handler: ({ query, limit }) =>
    reading(async (ctx) => {
      const rows = query.trim() === "" ? [] : await ctx.db.query("aiIndex").withSearchIndex("by_text", (q) => q.search("text", query)).take(limit);
      return { ids: rows.map((row) => row._id), chain: await capabilityChain(ctx, "searchIndex") } satisfies Words;
    }),
});

export const hydrate = internalQuery({
  args: { ids: v.array(v.id("aiIndex")) },
  handler: ({ ids }) =>
    reading(async (ctx) => {
      const hits = await Promise.all(
        ids.map(async (id) => {
          const row = await ctx.db.get("aiIndex", id);
          const alive = row ? await describe(ctx, row.entity) : null;
          return row && alive ? [{ kind: row.kind, id: row.entity.id as string, title: alive.text.split("\n")[0] ?? "", snippet: row.text } satisfies Hit] : [];
        }),
      );
      return hits.flat();
    }),
});

export const fuse = (lists: readonly (readonly string[])[]) => {
  const scores = new Map<string, number>();
  for (const list of lists) list.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank + 1)));
  return [...scores].toSorted((a, b) => b[1] - a[1]).map(([id]) => id);
};

const vectorOf = Effect.fn("search.vectorOf")(function* (chain: readonly ModelId[], query: string) {
  const [attempt] = yield* (yield* AiRouter).attemptsFor(chain);
  if (!attempt || query.trim() === "") return Option.none<number[]>();
  return Option.flatMap(yield* Effect.option(embedTexts(attempt, [query])), (vectors) => Option.fromNullishOr(vectors[0]));
});

export const hybrid = internalAction({
  args: { query: v.string(), limit: v.optional(v.number()), exclude: v.optional(v.string()) },
  returns: v.object({ hits: v.array(vHit) }),
  handler: Effect.fn("search.hybrid")(
    function* ({ query, limit = DEFAULT_LIMIT, exclude }) {
      const ctx = yield* Acts;
      const wanted = Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT);
      const words = yield* acting(() => {
        const found: Promise<Words> = ctx.runQuery(internal.ai.search.byWords, { query, limit: wanted * 2 });
        return found;
      });
      const vector = yield* vectorOf(words.chain, query);
      const near = Option.isSome(vector) ? yield* acting(() => ctx.vectorSearch("aiIndex", "by_embedding", { vector: vector.value, limit: wanted * 2 })) : [];
      const ids = fuse([words.ids, near.map((hit) => hit._id)]) as Id<"aiIndex">[];
      const hits = yield* acting(() => {
        const found: Promise<Hit[]> = ctx.runQuery(internal.ai.search.hydrate, { ids: ids.slice(0, wanted + 1) });
        return found;
      });
      return { hits: hits.filter((hit) => hit.id !== exclude).slice(0, wanted) };
    },
    Effect.provide(Layer.mergeAll(AiRouter.layer, AiProvider.layer)),
  ),
});

export const indexTools: Record<string, ToolDefinition> = {
  find_related: tool({
    title: "Find related",
    description:
      "Search everything in LifeOS by meaning and by words at once: Tasks, Projects and Areas, including ones that use different words for the same thing. Use it to find what relates to a Task or a question. Trashed things are left out.",
    args: { query: v.string(), limit: v.optional(v.number()) },
    returns: v.object({ hits: v.array(vHit) }),
    annotations: { readOnlyHint: true },
    scope: MCP_SCOPES.read,
    handler: (ctx, args, caller) => {
      requireOwnerConnection(caller);
      return ctx.runAction(internal.ai.search.hybrid, args);
    },
  }),
};
